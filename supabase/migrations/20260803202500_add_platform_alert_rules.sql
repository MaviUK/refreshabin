begin;

create table if not exists public.platform_alert_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null unique check (rule_key in (
    'pending_restaurant_applications','failed_payments','high_value_refunds',
    'restaurants_offline','orders_waiting','failed_print_jobs','overdue_support_cases','failed_payouts'
  )),
  name text not null,
  description text not null,
  is_enabled boolean not null default true,
  severity text not null default 'high' check (severity in ('normal','high','urgent')),
  threshold integer not null default 1 check (threshold >= 0),
  window_minutes integer not null default 60 check (window_minutes between 5 and 10080),
  cooldown_minutes integer not null default 60 check (cooldown_minutes between 5 and 10080),
  email_recipients text[] not null default '{}',
  updated_by uuid references public.platform_admins(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_alert_events (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.platform_alert_rules(id) on delete cascade,
  fingerprint text not null,
  title text not null,
  message text not null,
  severity text not null check (severity in ('normal','high','urgent')),
  metric_value integer,
  context jsonb not null default '{}',
  status text not null default 'open' check (status in ('open','acknowledged','resolved')),
  acknowledged_by uuid references public.platform_admins(user_id) on delete set null,
  acknowledged_at timestamptz,
  resolved_by uuid references public.platform_admins(user_id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rule_id, fingerprint)
);

create index if not exists platform_alert_events_status_idx on public.platform_alert_events(status, severity, created_at desc);
create index if not exists platform_alert_events_rule_idx on public.platform_alert_events(rule_id, created_at desc);

alter table public.platform_alert_rules enable row level security;
alter table public.platform_alert_events enable row level security;
revoke all on public.platform_alert_rules, public.platform_alert_events from public, anon, authenticated;

insert into public.platform_alert_rules(rule_key,name,description,severity,threshold,window_minutes,cooldown_minutes)
values
 ('pending_restaurant_applications','Pending restaurant applications','Applications waiting for platform approval.','normal',1,1440,240),
 ('failed_payments','Failed payments','Payment failures within the configured time window.','high',3,60,60),
 ('high_value_refunds','High-value refunds','Refunds at or above the configured value in pence.','high',10000,1440,60),
 ('restaurants_offline','Restaurants offline','Active restaurants that are not accepting orders.','normal',1,60,120),
 ('orders_waiting','Orders waiting','Paid orders awaiting restaurant response beyond the threshold in minutes.','urgent',10,60,15),
 ('failed_print_jobs','Failed print jobs','Printer jobs currently in a failed state.','high',1,60,30),
 ('overdue_support_cases','Overdue support cases','Open support cases past their response or resolution deadline.','high',1,60,30),
 ('failed_payouts','Failed payouts','Restaurant payouts currently marked failed.','urgent',1,1440,60)
on conflict (rule_key) do nothing;

create or replace function public.get_platform_alert_centre()
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare result jsonb;
begin
 if not private.has_platform_admin_permission('settings:view') then raise exception 'You do not have permission to view alert rules' using errcode='42501'; end if;
 select jsonb_build_object(
  'rules',coalesce((select jsonb_agg(jsonb_build_object(
    'id',r.id,'rule_key',r.rule_key,'name',r.name,'description',r.description,'is_enabled',r.is_enabled,
    'severity',r.severity,'threshold',r.threshold,'window_minutes',r.window_minutes,'cooldown_minutes',r.cooldown_minutes,
    'email_recipients',r.email_recipients,'updated_at',r.updated_at,'updated_by_name',coalesce(a.display_name,'System')
  ) order by r.name) from public.platform_alert_rules r left join public.platform_admins a on a.user_id=r.updated_by),'[]'::jsonb),
  'events',coalesce((select jsonb_agg(jsonb_build_object(
    'id',e.id,'rule_key',r.rule_key,'rule_name',r.name,'title',e.title,'message',e.message,'severity',e.severity,
    'metric_value',e.metric_value,'context',e.context,'status',e.status,'created_at',e.created_at,
    'acknowledged_at',e.acknowledged_at,'acknowledged_by_name',aa.display_name,'resolved_at',e.resolved_at,'resolved_by_name',ra.display_name
  ) order by case e.status when 'open' then 0 when 'acknowledged' then 1 else 2 end, case e.severity when 'urgent' then 0 when 'high' then 1 else 2 end, e.created_at desc)
  from public.platform_alert_events e join public.platform_alert_rules r on r.id=e.rule_id
  left join public.platform_admins aa on aa.user_id=e.acknowledged_by left join public.platform_admins ra on ra.user_id=e.resolved_by
  where e.created_at>=now()-interval '30 days'),'[]'::jsonb),
  'summary',jsonb_build_object(
    'open',(select count(*) from public.platform_alert_events where status='open'),
    'urgent',(select count(*) from public.platform_alert_events where status='open' and severity='urgent'),
    'acknowledged',(select count(*) from public.platform_alert_events where status='acknowledged'),
    'enabled_rules',(select count(*) from public.platform_alert_rules where is_enabled)
  )
 ) into result;
 return result;
end;$f$;

create or replace function public.update_platform_alert_rule(p_rule_id uuid,p_payload jsonb,p_reason text)
returns void language plpgsql security definer set search_path='' as $f$
declare old public.platform_alert_rules%rowtype; recipients text[];
begin
 if not private.has_platform_admin_permission('settings:manage') then raise exception 'You do not have permission to manage alert rules' using errcode='42501'; end if;
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'A reason of at least 5 characters is required'; end if;
 select * into old from public.platform_alert_rules where id=p_rule_id for update; if not found then raise exception 'Alert rule not found'; end if;
 select coalesce(array_agg(lower(trim(x))) filter(where trim(x)<>''),'{}') into recipients from jsonb_array_elements_text(coalesce(p_payload->'email_recipients','[]'::jsonb)) x;
 if exists(select 1 from unnest(recipients) x where x !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then raise exception 'One or more email recipients are invalid'; end if;
 update public.platform_alert_rules set
  is_enabled=coalesce((p_payload->>'is_enabled')::boolean,is_enabled),
  severity=coalesce(nullif(p_payload->>'severity',''),severity),
  threshold=coalesce((p_payload->>'threshold')::integer,threshold),
  window_minutes=coalesce((p_payload->>'window_minutes')::integer,window_minutes),
  cooldown_minutes=coalesce((p_payload->>'cooldown_minutes')::integer,cooldown_minutes),
  email_recipients=recipients,updated_by=auth.uid(),updated_at=now()
 where id=p_rule_id;
 insert into public.platform_admin_audit_log(actor_user_id,action,target_type,target_id,details)
 values(auth.uid(),'alert_rule_updated','alert_rule',p_rule_id,jsonb_build_object('reason',trim(p_reason),'rule_key',old.rule_key));
end;$f$;

create or replace function public.manage_platform_alert_event(p_event_id uuid,p_action text,p_reason text default null)
returns void language plpgsql security definer set search_path='' as $f$
declare e public.platform_alert_events%rowtype;
begin
 if not private.has_platform_admin_permission('settings:manage') then raise exception 'You do not have permission to manage alerts' using errcode='42501'; end if;
 if p_action not in('acknowledge','resolve','reopen') then raise exception 'Unsupported alert action'; end if;
 if p_action in('resolve','reopen') and length(trim(coalesce(p_reason,'')))<3 then raise exception 'A reason is required'; end if;
 select * into e from public.platform_alert_events where id=p_event_id for update; if not found then raise exception 'Alert not found'; end if;
 update public.platform_alert_events set
  status=case p_action when 'acknowledge' then 'acknowledged' when 'resolve' then 'resolved' else 'open' end,
  acknowledged_by=case when p_action='acknowledge' then auth.uid() when p_action='reopen' then null else acknowledged_by end,
  acknowledged_at=case when p_action='acknowledge' then now() when p_action='reopen' then null else acknowledged_at end,
  resolved_by=case when p_action='resolve' then auth.uid() when p_action='reopen' then null else resolved_by end,
  resolved_at=case when p_action='resolve' then now() when p_action='reopen' then null else resolved_at end,updated_at=now()
 where id=p_event_id;
 insert into public.platform_admin_audit_log(actor_user_id,action,target_type,target_id,details)
 values(auth.uid(),'alert_'||p_action,'alert_event',p_event_id,jsonb_build_object('reason',nullif(trim(coalesce(p_reason,'')),'')));
end;$f$;

revoke all on function public.get_platform_alert_centre(),public.update_platform_alert_rule(uuid,jsonb,text),public.manage_platform_alert_event(uuid,text,text) from public,anon,authenticated;
grant execute on function public.get_platform_alert_centre(),public.update_platform_alert_rule(uuid,jsonb,text),public.manage_platform_alert_event(uuid,text,text) to authenticated;

commit;
