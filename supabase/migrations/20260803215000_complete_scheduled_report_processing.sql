begin;

create or replace function public.queue_due_platform_report_runs()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  queued_count integer := 0;
  schedule_row public.platform_report_schedules%rowtype;
  period_to date;
  period_from date;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  for schedule_row in
    select *
    from public.platform_report_schedules
    where is_active = true
      and next_run_at is not null
      and next_run_at <= now()
    for update skip locked
  loop
    period_to := (now() at time zone 'Europe/London')::date - 1;
    period_from := case schedule_row.cadence
      when 'daily' then period_to
      when 'weekly' then period_to - 6
      else (date_trunc('month', period_to::timestamp) - interval '1 month')::date
    end;

    if schedule_row.cadence = 'monthly' then
      period_to := (date_trunc('month', (now() at time zone 'Europe/London')) - interval '1 day')::date;
    end if;

    insert into public.platform_report_runs (
      schedule_id, report_type, period_from, period_to, recipients, requested_by
    ) values (
      schedule_row.id, schedule_row.report_type, period_from, period_to,
      schedule_row.recipients, null
    );

    update public.platform_report_schedules
    set next_run_at = private.next_platform_report_run(
          cadence, delivery_hour, delivery_weekday, delivery_monthday, now()
        ),
        updated_at = now()
    where id = schedule_row.id;

    queued_count := queued_count + 1;
  end loop;

  return queued_count;
end;
$function$;

create or replace function public.complete_platform_report_run(
  p_run_id uuid,
  p_status text,
  p_row_count integer default null,
  p_file_name text default null,
  p_error_message text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  run_row public.platform_report_runs%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_status not in ('completed', 'failed') then
    raise exception 'Unsupported report completion status';
  end if;

  select * into run_row
  from public.platform_report_runs
  where id = p_run_id
  for update;

  if not found then
    raise exception 'Report run not found';
  end if;

  update public.platform_report_runs
  set status = p_status,
      row_count = case when p_status = 'completed' then p_row_count else row_count end,
      file_name = case when p_status = 'completed' then p_file_name else file_name end,
      error_message = case when p_status = 'failed' then p_error_message else null end,
      completed_at = now()
  where id = p_run_id;

  if run_row.schedule_id is not null then
    update public.platform_report_schedules
    set last_run_at = case when p_status = 'completed' then now() else last_run_at end,
        updated_at = now()
    where id = run_row.schedule_id;
  end if;
end;
$function$;

revoke all on function public.queue_due_platform_report_runs() from public, anon, authenticated;
revoke all on function public.complete_platform_report_run(uuid,text,integer,text,text) from public, anon, authenticated;
grant execute on function public.queue_due_platform_report_runs() to service_role;
grant execute on function public.complete_platform_report_run(uuid,text,integer,text,text) to service_role;

commit;
