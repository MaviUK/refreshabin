create or replace function public.retry_print_job(p_job_id uuid)
returns public.print_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.print_jobs;
begin
  select pj.*
  into v_job
  from public.print_jobs pj
  where pj.id = p_job_id
    and exists (
      select 1
      from public.restaurant_members rm
      where rm.restaurant