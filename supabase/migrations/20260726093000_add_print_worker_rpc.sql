create or replace function public.claim_next_print_job(p_printer_id uuid)
returns table (
  job_id uuid,
  restaurant_id uuid,
  order_id uuid,
  printer_id uuid,
  document_type text,
  attempts integer,
  payload jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.print_jobs%rowtype;
begin
  select pj.*
  into claimed
  from public.print_jobs pj
  where pj.printer_id = p_printer_id
    and pj.status in ('queued', 'failed')
    and pj.attempts < pj.max_attempts
    and (
      pj.status = 'queued'
      or pj.failed_at is null
      or pj.failed_at <= now() - make_interval(secs => least(300, greatest(15, power(2, pj.attempts)::integer * 5)))
    )
  order by pj.queued_at asc
  for update skip locked
  limit 1;

  if claimed.id is null then
    return;
  end if;

  update public.print_jobs
  set status = 'processing',
      processing_at = now(),
      attempts = attempts + 1,
      last_error = null,
      updated_at = now()
  where id = claimed.id;

  return query
  select
    claimed.id,
    claimed.restaurant_id,
    claimed.order_id,
    claimed.printer_id,
    claimed.document_type,
    claimed.attempts + 1,
    claimed.payload;
end;
$$;

create or replace function public.complete_print_job(
  p_job_id uuid,
  p_success boolean,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.print_jobs
  set status = case when p_success then 'printed' else 'failed' end,
      printed_at = case when p_success then now() else printed_at end,
      failed_at = case when p_success then null else now() end,
      processing_at = null,
      last_error = case when p_success then null else left(coalesce(p_error, 'Unknown printing error'), 2000) end,
      updated_at = now()
  where id = p_job_id
    and status = 'processing';
end;
$$;

revoke all on function public.claim_next_print_job(uuid) from public, anon, authenticated;
revoke all on function public.complete_print_job(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.claim_next_print_job(uuid) to service_role;
grant execute on function public.complete_print_job(uuid, boolean, text) to service_role;
