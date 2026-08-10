create or replace function public.get_platform_stamp_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not private.has_platform_admin_permission('overview:view') then
    raise exception 'Platform overview permission required' using errcode='42501';
  end if;

  with restaurant_rows as (
    select
      r.id as restaurant_id,
      r.name as restaurant_name,
      count(distinct p.id)::integer as campaigns,
      count(distinct p.id) filter (where p.is_active and p.starts_at<=now() and (p.ends_at is null or p.ends_at>now()))::integer as active_campaigns,
      count(distinct c.customer_user_id)::integer as collectors,
      coalesce(sum(e.stamps_delta) filter (where e.event_type in ('earned','manual_adjustment','qr_claim')),0)::integer as stamps_issued,
      count(distinct e.id) filter (where e.event_type='completion')::integer as completions,
      count(distinct q.id)::integer as qr_claims,
      count(distinct e.id) filter (where e.event_type='manual_adjustment')::integer as manual_adjustments
    from public.restaurants r
    join public.restaurant_stamp_programs p on p.restaurant_id=r.id
    left join public.customer_stamp_cards c on c.restaurant_id=r.id
    left join public.customer_stamp_events e on e.restaurant_id=r.id
    left join public.stamp_qr_claims q on q.restaurant_id=r.id
    group by r.id,r.name
  ), fraud_rows as (
    select
      e.restaurant_id,
      e.created_by,
      date_trunc('day',e.created_at)::date as activity_date,
      count(*)::integer as adjustment_count
    from public.customer_stamp_events e
    where e.event_type='manual_adjustment'
      and e.created_at>=now()-interval '30 days'
    group by e.restaurant_id,e.created_by,date_trunc('day',e.created_at)
    having count(*)>=10
  ), recent_rows as (
    select e.* from public.customer_stamp_events e order by e.created_at desc limit 100
  )
  select jsonb_build_object(
    'summary',jsonb_build_object(
      'restaurants_using_stamps',(select count(distinct restaurant_id) from public.restaurant_stamp_programs),
      'campaign_count',(select count(*) from public.restaurant_stamp_programs),
      'active_campaigns',(select count(*) from public.restaurant_stamp_programs where is_active and starts_at<=now() and (ends_at is null or ends_at>now())),
      'active_collectors',(select count(distinct customer_user_id) from public.customer_stamp_cards where is_active),
      'stamps_issued',coalesce((select sum(stamps_delta) from public.customer_stamp_events where event_type in ('earned','manual_adjustment','qr_claim')),0),
      'cards_completed',(select count(*) from public.customer_stamp_events where event_type='completion'),
      'qr_claims',(select count(*) from public.stamp_qr_claims),
      'manual_adjustments',(select count(*) from public.customer_stamp_events where event_type='manual_adjustment'),
      'fraud_alerts',(select count(*) from fraud_rows)
    ),
    'restaurants',coalesce((
      select jsonb_agg(jsonb_build_object(
        'restaurant_id',restaurant_id,'restaurant_name',restaurant_name,'campaigns',campaigns,
        'active_campaigns',active_campaigns,'collectors',collectors,'stamps_issued',stamps_issued,
        'completions',completions,'qr_claims',qr_claims,'manual_adjustments',manual_adjustments
      ) order by completions desc,stamps_issued desc) from restaurant_rows
    ),'[]'::jsonb),
    'fraud_signals',coalesce((
      select jsonb_agg(jsonb_build_object(
        'restaurant_name',r.name,'staff_user_id',f.created_by,'activity_date',f.activity_date,'adjustment_count',f.adjustment_count
      ) order by f.adjustment_count desc,f.activity_date desc)
      from fraud_rows f join public.restaurants r on r.id=f.restaurant_id
    ),'[]'::jsonb),
    'recent_activity',coalesce((
      select jsonb_agg(jsonb_build_object(
        'event_id',e.id,'restaurant_name',r.name,'program_name',p.name,'event_type',e.event_type,
        'stamps_delta',e.stamps_delta,'customer_user_id',e.customer_user_id,'created_at',e.created_at
      ) order by e.created_at desc)
      from recent_rows e
      join public.restaurants r on r.id=e.restaurant_id
      join public.restaurant_stamp_programs p on p.id=e.program_id
    ),'[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_platform_stamp_dashboard() from public, anon;
grant execute on function public.get_platform_stamp_dashboard() to authenticated, service_role;
