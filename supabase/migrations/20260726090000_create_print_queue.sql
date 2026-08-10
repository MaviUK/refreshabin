create table if not exists public.restaurant_printers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  printer_type text not null default 'escpos' check (printer_type in ('escpos', 'epson', 'star', 'sunmi', 'browser')),
  connection_type text not null default 'network' check (connection_type in ('network', 'usb', 'bluetooth', 'cloud', 'browser')),
  connection_config jsonb not null default '{}'::jsonb,
  print_kitchen_tickets boolean not null default true,
  print_customer_receipts boolean not null default false,
  copies integer not null default 1 check (copies between 1 and 5),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists restaurant_printers_restaurant_id_idx
  on public.restaurant_printers (restaurant_id);

create table if not exists public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  printer_id uuid references public.restaurant_printers(id) on delete set null,
  document_type text not null default 'kitchen_ticket' check (document_type in ('kitchen_ticket', 'customer_receipt')),
  status text not null default 'queued' check (status in ('queued', 'processing', 'printed', 'failed', 'cancelled')),
  attempts integer not null default 0,
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  payload jsonb not null default '{}'::jsonb,
  last_error text,
  queued_at timestamptz not null default now(),
  processing_at timestamptz,
  printed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, printer_id, document_type)
);

create index if not exists print_jobs_restaurant_status_idx
  on public.print_jobs (restaurant_id, status, queued_at);

create index if not exists print_jobs_order_id_idx
  on public.print_jobs (order_id);

alter table public.restaurant_printers enable row level security;
alter table public.print_jobs enable row level security;

create policy "Restaurant members can view printers"
  on public.restaurant_printers
  for select
  using (
    exists (
      select 1
      from public.restaurant_members rm
      where rm.restaurant_id = restaurant_printers.restaurant_id
        and rm.user_id = auth.uid()
    )
  );

create policy "Restaurant members can manage printers"
  on public.restaurant_printers
  for all
  using (
    exists (
      select 1
      from public.restaurant_members rm
      where rm.restaurant_id = restaurant_printers.restaurant_id
        and rm.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.restaurant_members rm
      where rm.restaurant_id = restaurant_printers.restaurant_id
        and rm.user_id = auth.uid()
    )
  );

create policy "Restaurant members can view print jobs"
  on public.print_jobs
  for select
  using (
    exists (
      select 1
      from public.restaurant_members rm
      where rm.restaurant_id = print_jobs.restaurant_id
        and rm.user_id = auth.uid()
    )
  );

create policy "Restaurant members can update print jobs"
  on public.print_jobs
  for update
  using (
    exists (
      select 1
      from public.restaurant_members rm
      where rm.restaurant_id = print_jobs.restaurant_id
        and rm.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.restaurant_members rm
      where rm.restaurant_id = print_jobs.restaurant_id
        and rm.user_id = auth.uid()
    )
  );

create or replace function public.queue_order_print_jobs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.payment_status = 'paid'
     and coalesce(old.payment_status, '') <> 'paid' then

    insert into public.print_jobs (
      restaurant_id,
      order_id,
      printer_id,
      document_type,
      payload
    )
    select
      new.restaurant_id,
      new.id,
      rp.id,
      'kitchen_ticket',
      jsonb_build_object(
        'order_id', new.id,
        'restaurant_id', new.restaurant_id,
        'queued_from', 'payment_status_trigger'
      )
    from public.restaurant_printers rp
    where rp.restaurant_id = new.restaurant_id
      and rp.is_active = true
      and rp.print_kitchen_tickets = true
    on conflict (order_id, printer_id, document_type) do nothing;

    if not exists (
      select 1
      from public.restaurant_printers rp
      where rp.restaurant_id = new.restaurant_id
        and rp.is_active = true
        and rp.print_kitchen_tickets = true
    ) then
      insert into public.print_jobs (
        restaurant_id,
        order_id,
        printer_id,
        document_type,
        payload
      ) values (
        new.restaurant_id,
        new.id,
        null,
        'kitchen_ticket',
        jsonb_build_object(
          'order_id', new.id,
          'restaurant_id', new.restaurant_id,
          'queued_from', 'payment_status_trigger',
          'awaiting_printer_assignment', true
        )
      )
      on conflict (order_id, printer_id, document_type) do nothing;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists queue_print_jobs_when_order_paid on public.orders;

create trigger queue_print_jobs_when_order_paid
after update of payment_status on public.orders
for each row
execute function public.queue_order_print_jobs();
