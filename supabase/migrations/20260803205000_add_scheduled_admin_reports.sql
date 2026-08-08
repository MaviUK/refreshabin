begin;

create table if not exists public.platform_report_schedules (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 3 and 120),
  report_type text not null check (report_type in ('financial_summary','order_operations','restaurant_performance','support_sla','risk_signals')),
  cadence text not null check (cadence in ('daily','weekly','monthly')),
  delivery_hour smallint not null default 8 check (delivery_hour between 0 and 23),
  delivery_weekday smallint check (delivery_weekday between 1 and 7),
  delivery_monthday smallint check (delivery_monthday between 1 and 28),
  recipients text[] not null default '{}',
  filters jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_by uuid references public.platform_admins(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_report_runs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid references public.platform_report_schedules(id) on delete set null,
  report_type text not null,
  status text not null default 'queued' check (status in ('queued','processing','completed','failed')),
  period_from date not null,
  period_to date not null,
  recipients text[] not null default '{}',
  row_count integer,
  file_name text,
  storage_path text,
  error_message text,
  requested_by uuid references public.platform_admins(user_id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists platform_report_schedules_due_idx on public.platform_report_schedules(is_active,next_run_at);
create index if not exists platform_report_runs_created_idx on public.platform_report_runs(created_at desc);

alter table public.platform_report_schedules enable row level security;
alter table public.platform_report_runs enable row level security;
revoke all on public.platform_report_schedules, public.platform_report_runs from public,anon,authenticated;

create or replace function private.next_platform_report_run(p_cadence text,p_hour integer,p_weekday integer,p_monthday integer,p_after timestamptz default now())
returns timestamptz language plpgsql stable set search_path='' as $f$
declare base date := (p_after at time zone 'Europe/London')::date; candidate timestamp;
begin
  if p_cadence='daily' then candidate:=base+p_hour*interval '1 hour'; if candidate<=p_after at time zone 'Europe/London' then candidate:=candidate+interval '1 day'; end if;
  elsif p_cadence='weekly' then candidate:=base+(((coalesce(p_weekday,1)-extract(isodow from base)::int+7)%7))*interval '1 day'+p_hour*interval '1 hour'; if candidate<=p_after at time zone 'Europe/London' then candidate:=candidate+interval '7 day'; end if;
  else candidate:=make_date(extract(year from base)::int,extract(month from base)::int,least(coalesce(p_monthday,1),28))+p_hour*interval '1 hour'; if candidate<=p_after at time zone 'Europe/London' then candidate:=(candidate+interval '1 month'); end if; end if;
  return candidate at time zone 'Europe/London';
end;$f$;

create or replace function public.get_platform_report_schedules()
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare result jsonb;
begin
 if not private.has_platform_admin_permission('finance:view') then raise exception 'You do not have permission to view scheduled reports' using errcode='42501'; end if;
 select jsonb_build_object(
  'schedules',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('created_by_name',coalesce(a.display_name,'Removed administrator')) order by s.created_at desc) from public.platform_report_schedules s left join public.platform_admins a on a.user_id=s.created_by),'[]'::jsonb),
  'runs',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('requested_by_name',coalesce(a.display_name,'System')) order by r.created_at desc) from (select * from public.platform_report_runs order by created_at desc limit 100) r left join public.platform_admins a on a.user_id=r.requested_by),'[]'::jsonb)
 ) into result; return result;
end;$f$;

create or replace function public.upsert_platform_report_schedule(p_id uuid,p_name text,p_report_type text,p_cadence text,p_delivery_hour integer,p_delivery_weekday integer,p_delivery_monthday integer,p_recipients text[],p_filters jsonb,p_is_active boolean,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $f$
declare sid uuid; recipient text;
begin
 if not private.has_platform_admin_permission('finance:manage') then raise exception 'You do not have permission to manage scheduled reports' using errcode='42501'; end if;
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'A reason is required'; end if;
 if p_report_type not in ('financial_summary','order_operations','restaurant_performance','support_sla','risk_signals') or p_cadence not in ('daily','weekly','monthly') then raise exception 'Unsupported report configuration'; end if;
 if coalesce(array_length(p_recipients,1),0)=0 then raise exception 'At least one recipient is required'; end if;
 foreach recipient in array p_recipients loop if recipient !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Invalid recipient email: %',recipient; end if; end loop;
 if p_id is null then
  insert into public.platform_report_schedules(name,report_type,cadence,delivery_hour,delivery_weekday,delivery_monthday,recipients,filters,is_active,next_run_at,created_by)
  values(trim(p_name),p_report_type,p_cadence,p_delivery_hour,p_delivery_weekday,p_delivery_monthday,p_recipients,coalesce(p_filters,'{}'),p_is_active,case when p_is_active then private.next_platform_report_run(p_cadence,p_delivery_hour,p_delivery_weekday,p_delivery_monthday) end,auth.uid()) returning id into sid;
 else
  update public.platform_report_schedules set name=trim(p_name),report_type=p_report_type,cadence=p_cadence,delivery_hour=p_delivery_hour,delivery_weekday=p_delivery_weekday,delivery_monthday=p_delivery_monthday,recipients=p_recipients,filters=coalesce(p_filters,'{}'),is_active=p_is_active,next_run_at=case when p_is_active then private.next_platform_report_run(p_cadence,p_delivery_hour,p_delivery_weekday,p_delivery_monthday) end,updated_at=now() where id=p_id returning id into sid;
  if sid is null then raise exception 'Report schedule not found'; end if;
 end if;
 insert into public.platform_admin_audit_log(actor_user_id,action,target_type,target_id,details) values(auth.uid(),'report_schedule_saved','report_schedule',sid,jsonb_build_object('reason',trim(p_reason),'report_type',p_report_type,'cadence',p_cadence));
 return sid;
end;$f$;

create or replace function public.queue_platform_report_run(p_schedule_id uuid default null,p_report_type text default null,p_period_from date default current_date-29,p_period_to date default current_date,p_recipients text[] default null)
returns uuid language plpgsql security definer set search_path='' as $f$
declare s public.platform_report_schedules%rowtype; rid uuid; rt text; rec text[];
begin
 if not private.has_platform_admin_permission('finance:manage') then raise exception 'You do not have permission to run reports' using errcode='42501'; end if;
 if p_period_from>p_period_to or p_period_to-p_period_from>731 then raise exception 'Choose a valid report period'; end if;
 if p_schedule_id is not null then select * into s from public.platform_report_schedules where id=p_schedule_id; if not found then raise exception 'Report schedule not found'; end if; rt:=s.report_type; rec:=s.recipients; else rt:=p_report_type; rec:=p_recipients; end if;
 if rt not in ('financial_summary','order_operations','restaurant_performance','support_sla','risk_signals') then raise exception 'Unsupported report type'; end if;
 if coalesce(array_length(rec,1),0)=0 then raise exception 'At least one recipient is required'; end if;
 insert into public.platform_report_runs(schedule_id,report_type,period_from,period_to,recipients,requested_by) values(p_schedule_id,rt,p_period_from,p_period_to,rec,auth.uid()) returning id into rid;
 insert into public.platform_admin_audit_log(actor_user_id,action,target_type,target_id,details) values(auth.uid(),'report_run_queued','report_run',rid,jsonb_build_object('report_type',rt,'period_from',p_period_from,'period_to',p_period_to));
 return rid;
end;$f$;

revoke all on function public.get_platform_report_schedules(),public.upsert_platform_report_schedule(uuid,text,text,text,integer,integer,integer,text[],jsonb,boolean,text),public.queue_platform_report_run(uuid,text,date,date,text[]) from public,anon,authenticated;
grant execute on function public.get_platform_report_schedules(),public.upsert_platform_report_schedule(uuid,text,text,text,integer,integer,integer,text[],jsonb,boolean,text),public.queue_platform_report_run(uuid,text,date,date,text[]) to authenticated;

commit;