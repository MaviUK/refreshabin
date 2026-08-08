alter table public.print_jobs
  alter column order_id drop not null;

alter table public.print_jobs
  drop constraint if exists print_jobs_document_type_check;

alter table public.print_jobs
  add constraint print_jobs_document_type_check
  check (document_type in ('kitchen_ticket', 'customer_receipt', 'test_ticket'));

create or replace function public.queue_printer_test(p_printer_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_printer public.restaurant_printers%rowtype;
  v_job_id uuid;
begin
  select *
  into v_printer
  from public.restaurant_printers
  where id = p_printer_id;

  if not found then
    raise exception 'Printer not found';
  end if;

  if not exists (
    select 1
    from public.restaurant_members rm
    where rm.restaurant_id = v_printer.restaurant_id
      and rm.user_id = auth.uid()
  ) then
    raise exception 'Not authorised for this printer';
  end if;

  if v_printer.is_active is not true then
    raise exception 'Printer is inactive';
  end if;

  insert into public.print_jobs (
    restaurant_id,
    order_id,
    printer_id,
    document_type,
    payload
  ) values (
    v_printer.restaurant_id,
    null,
    v_printer.id,
    'test_ticket',
    jsonb_build_object(
      'is_test', true,
      'printer_name', v_printer.name,
      'queued_by', auth.uid(),
      'queued_at', now()
    )
  )
  returning id into v_job_id;

  return v_job_id;
end;
$$;

grant execute on function public.queue_printer_test(uuid) to authenticated;
