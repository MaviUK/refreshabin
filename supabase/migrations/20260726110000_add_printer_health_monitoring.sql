alter table public.restaurant_printers
  add column if not exists worker_status text not null default 'offline'
    check (worker_status in ('offline', 'online', 'printing', 'error')),
  add column if not exists last_seen_at timestamptz,
  add column if not exists last_printed_at timestamptz,
  add column if not exists last_error text,
  add column if not exists last_error_at timestamptz;

create index if not exists restaurant_printers_last_seen_at_idx
  on public.restaurant_printers (last_seen_at);

create or replace function public.update_printer_heartbeat(
  p_printer_id uuid,
  p_status text default 'online',
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('offline', 'online', 'printing', 'error') then
    raise exception 'Invalid printer status';
  end if;

  update public.restaurant_printers
  set
