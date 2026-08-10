create or replace function public.retry_print_job(p_job_id uuid)
returns public.print_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.print_jobs%rowtype;
begin
  select pj.*
  into v_job
  from public.print_jobs pj
  where pj.id = p_job_id
    and exists (
      select 1
      from public.restaurant_members rm
      where rm.restaurant_id = pj.restaurant_id
        and rm.user_id = auth.uid()
    )
  for update;

  if v_job.id is null then
    raise exception 'Print job not found or access denied'
      using errcode = 'P0002';
  end if;

  if v_job.printer_id is null then
    raise exception 'Print job has no printer assigned'
      using errcode = 'P0001';
  end if;

  update public.print_jobs
  set status = 'queued',
      attempts = 0,
      queued_at = now(),
      processing_at = null,
      printed_at = null,
      failed_at = null,
      last_error = null,
      updated_at = now()
  where id = v_job.id
  returning * into v_job;

  return v_job;
end;
$$;

comment on function public.retry_print_job(uuid) is
  'Requeues a print job for an authenticated restaurant member. Supports retrying failed jobs and reprinting completed jobs.';

revoke all on function public.retry_print_job(uuid) from public, anon;
grant execute on function public.retry_print_job(uuid) to authenticated;
