begin;

create table if not exists public.platform_risk_reviews (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('customer','restaurant','admin','payment_pattern')),
  subject_id uuid,
  subject_key text,
  risk_type text not null,
  severity text not null check (severity in ('low','normal','high','urgent')),
  status text not null default 'open' check (status in ('open','in_review','resolved','dismissed')),
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  assigned_to uuid references public.platform_admins(user_id) on delete set null,
  resolution text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists platform_risk_reviews_queue_idx
  on public.platform_risk_reviews (status, severity, updated_at desc);
create index if not exists platform_risk_reviews_subject_idx
  on public.platform_risk_reviews (subject_type, subject_id, subject_key);

alter table public.platform_risk_reviews enable row level security;
revoke all on public.platform_risk_reviews from public, anon, authenticated;

create or replace function public.get_platform_risk_dashboard(
  p_status text default 'open',
  p_severity text default 'all',
  p_search text default null
) returns jsonb
language plpgsql stable security definer set search_path=''
as $function$
declare
  result jsonb;
  clean text := nullif(trim(coalesce(p_search,'')),'');
begin
  if not private.has_platform_admin_permission('moderation:view') then
    raise exception 'You do not have permission to view platform risk' using errcode='42501';
  end if;
  if p_status not in ('all','open','in_review','resolved','dismissed') then raise exception 'Unsupported status'; end if;
  if p_severity not in ('all','low','normal','high','urgent') then raise exception 'Unsupported severity'; end if;

  with failed_payments as (
    select lower(o.customer_email) subject_key,
      count(*)::integer failed_count,
      max(o.created_at) last_failed_at,
      coalesce(sum(o.total_pence),0)::bigint attempted_pence
    from public.orders o
    where o.payment_status='failed'
      and o.created_at >= now()-interval '7 days'
      and o.customer_email is not null
    group by lower(o.customer_email)
    having count(*) >= 3
  ), refund_risk as (
    select o.customer_user_id subject_id,
      lower(max(o.customer_email)) subject_key,
      count(*) filter (where o.payment_status in ('paid','partially_refunded','refunded'))::integer paid_orders,
      count(*) filter (where coalesce(o.refunded_pence,0)>0)::integer refunded_orders,
      coalesce(sum(o.refunded_pence),0)::bigint refunded_pence,
      coalesce(sum(o.total_pence),0)::bigint captured_pence
    from public.orders o
    where o.created_at >= now()-interval '90 days'
      and (o.customer_user_id is not null or o.customer_email is not null)
    group by o.customer_user_id, lower(o.customer_email)
    having count(*) filter (where coalesce(o.refunded_pence,0)>0) >= 2
      and count(*) filter (where coalesce(o.refunded_pence,0)>0)::numeric / greatest(count(*) filter (where o.payment_status in ('paid','partially_refunded','refunded')),1) >= 0.5
  ), restaurant_refunds as (
    select o.restaurant_id subject_id,
      r.name subject_key,
      count(*)::integer order_count,
      count(*) filter (where coalesce(o.refunded_pence,0)>0)::integer refunded_orders,
      coalesce(sum(o.refunded_pence),0)::bigint refunded_pence,
      coalesce(sum(o.total_pence),0)::bigint captured_pence
    from public.orders o join public.restaurants r on r.id=o.restaurant_id
    where o.created_at >= now()-interval '30 days'
      and o.payment_status in ('paid','partially_refunded','refunded')
    group by o.restaurant_id,r.name
    having count(*) >= 5
      and count(*) filter (where coalesce(o.refunded_pence,0)>0)::numeric / count(*) >= 0.25
  ), admin_events as (
    select a.actor_user_id subject_id,
      coalesce(pa.display_name,u.email,'Administrator') subject_key,
      count(*)::integer event_count,
      max(a.created_at) last_event_at
    from public.platform_admin_audit_log a
    left join public.platform_admins pa on pa.user_id=a.actor_user_id
    left join auth.users u on u.id=a.actor_user_id
    where a.created_at >= now()-interval '24 hours'
      and a.action in ('customer_suspended','restaurant_suspended','payment_refund_created','payout_status_changed','admin_deactivated','admin_role_changed')
    group by a.actor_user_id,pa.display_name,u.email
    having count(*) >= 10
  ), generated as (
    select 'payment_pattern'::text subject_type,null::uuid subject_id,f.subject_key,
      'repeated_failed_payments'::text risk_type,
      case when f.failed_count>=8 then 'urgent' when f.failed_count>=5 then 'high' else 'normal' end severity,
      'Repeated failed payments'::text summary,
      jsonb_build_object('failed_count',f.failed_count,'attempted_pence',f.attempted_pence,'last_failed_at',f.last_failed_at) details
    from failed_payments f
    union all
    select 'customer',r.subject_id,r.subject_key,'high_refund_ratio',
      case when r.refunded_orders>=4 then 'urgent' else 'high' end,
      'Customer refund pattern',
      jsonb_build_object('paid_orders',r.paid_orders,'refunded_orders',r.refunded_orders,'refunded_pence',r.refunded_pence,'captured_pence',r.captured_pence)
    from refund_risk r
    union all
    select 'restaurant',r.subject_id,r.subject_key,'restaurant_refund_rate',
      case when r.refunded_orders::numeric/greatest(r.order_count,1)>=0.4 then 'urgent' else 'high' end,
      'Restaurant refund rate elevated',
      jsonb_build_object('order_count',r.order_count,'refunded_orders',r.refunded_orders,'refunded_pence',r.refunded_pence,'captured_pence',r.captured_pence)
    from restaurant_refunds r
    union all
    select 'admin',a.subject_id,a.subject_key,'high_volume_sensitive_actions','high',
      'High volume of sensitive admin actions',
      jsonb_build_object('event_count',a.event_count,'last_event_at',a.last_event_at)
    from admin_events a
  ), persisted as (
    select r.subject_type,r.subject_id,r.subject_key,r.risk_type,r.severity,r.summary,r.details,r.status,r.id,r.assigned_to,r.created_at,r.updated_at
    from public.platform_risk_reviews r
  ), combined as (
    select g.subject_type,g.subject_id,g.subject_key,g.risk_type,g.severity,g.summary,g.details,'open'::text status,null::uuid id,null::uuid assigned_to,now() created_at,now() updated_at
    from generated g
    where not exists (
      select 1 from public.platform_risk_reviews r
      where r.status in ('open','in_review') and r.risk_type=g.risk_type
        and coalesce(r.subject_id::text,r.subject_key)=coalesce(g.subject_id::text,g.subject_key)
    )
    union all select * from persisted
  ), filtered as (
    select * from combined
    where (p_status='all' or status=p_status)
      and (p_severity='all' or severity=p_severity)
      and (clean is null or coalesce(subject_key,'') ilike '%'||clean||'%' or summary ilike '%'||clean||'%' or risk_type ilike '%'||clean||'%')
  )
  select jsonb_build_object(
    'metrics',jsonb_build_object(
      'open',(select count(*) from combined where status='open'),
      'urgent',(select count(*) from combined where status='open' and severity='urgent'),
      'in_review',(select count(*) from combined where status='in_review'),
      'admin_events_24h',(select coalesce(sum(event_count),0) from admin_events)
    ),
    'risks',coalesce((select jsonb_agg(to_jsonb(f) order by case f.severity when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,f.updated_at desc) from filtered f),'[]'::jsonb),
    'recent_admin_events',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'action',a.action,'actor_name',coalesce(pa.display_name,u.email,'Administrator'),'target_type',a.target_type,'target_id',a.target_id,'created_at',a.created_at) order by a.created_at desc) from (select * from public.platform_admin_audit_log order by created_at desc limit 25) a left join public.platform_admins pa on pa.user_id=a.actor_user_id left join auth.users u on u.id=a.actor_user_id),'[]'::jsonb)
  ) into result;
  return result;
end;
$function$;

create or replace function public.create_platform_risk_review(
  p_subject_type text,p_subject_id uuid,p_subject_key text,p_risk_type text,p_severity text,p_summary text,p_details jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path=''
as $function$
declare rid uuid;
begin
  if not private.has_platform_admin_permission('moderation:manage') then raise exception 'You do not have permission to create risk reviews' using errcode='42501'; end if;
  insert into public.platform_risk_reviews(subject_type,subject_id,subject_key,risk_type,severity,summary,details,assigned_to)
  values(p_subject_type,p_subject_id,nullif(trim(p_subject_key),''),p_risk_type,p_severity,trim(p_summary),coalesce(p_details,'{}'::jsonb),auth.uid())
  returning id into rid;
  insert into public.platform_admin_audit_log(actor_user_id,action,target_type,target_id,details)
  values(auth.uid(),'risk_review_created','risk_review',rid,jsonb_build_object('risk_type',p_risk_type,'severity',p_severity));
  return rid;
end;
$function$;

create or replace function public.manage_platform_risk_review(p_review_id uuid,p_action text,p_resolution text default null)
returns void language plpgsql security definer set search_path=''
as $function$
declare current public.platform_risk_reviews%rowtype;
begin
  if not private.has_platform_admin_permission('moderation:manage') then raise exception 'You do not have permission to manage risk reviews' using errcode='42501'; end if;
  select * into current from public.platform_risk_reviews where id=p_review_id for update;
  if not found then raise exception 'Risk review not found'; end if;
  if p_action='claim' then update public.platform_risk_reviews set assigned_to=auth.uid(),status='in_review',updated_at=now() where id=p_review_id;
  elsif p_action in ('resolve','dismiss') then
    if length(trim(coalesce(p_resolution,'')))<5 then raise exception 'A resolution of at least 5 characters is required'; end if;
    update public.platform_risk_reviews set status=case when p_action='resolve' then 'resolved' else 'dismissed' end,resolution=trim(p_resolution),resolved_at=now(),updated_at=now() where id=p_review_id;
  else raise exception 'Unsupported risk action'; end if;
  insert into public.platform_admin_audit_log(actor_user_id,action,target_type,target_id,details)
  values(auth.uid(),'risk_review_'||p_action,'risk_review',p_review_id,jsonb_build_object('resolution',p_resolution));
end;
$function$;

revoke all on function public.get_platform_risk_dashboard(text,text,text),public.create_platform_risk_review(text,uuid,text,text,text,text,jsonb),public.manage_platform_risk_review(uuid,text,text) from public,anon,authenticated;
grant execute on function public.get_platform_risk_dashboard(text,text,text),public.create_platform_risk_review(text,uuid,text,text,text,text,jsonb),public.manage_platform_risk_review(uuid,text,text) to authenticated;

commit;
