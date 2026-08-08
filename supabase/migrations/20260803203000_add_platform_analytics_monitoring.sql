begin;

create or replace function public.get_platform_analytics(
  p_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
  safe_days integer := least(greatest(coalesce(p_days, 30), 7), 90);
  from_date date := (now() at time zone 'Europe/London')::date - (safe_days - 1);
begin
  if not private.has_platform_admin_permission('overview:view') then
    raise exception 'You do not have permission to view platform analytics' using errcode = '42501';
  end if;

  with days as (
    select generate_series(from_date, (now() at time zone 'Europe/London')::date, interval '1 day')::date as day
  ), daily as (
    select
      d.day,
      count(o.id) filter (where o.payment_status in ('paid','partially_refunded','refunded'))::integer as paid_orders,
      count(o.id) filter (where o.payment_status = 'failed')::integer as failed_payments,
      coalesce(sum(o.total_pence) filter (where o.payment_status in ('paid','partially_refunded','refunded')), 0)::bigint as gross_pence,
      coalesce(sum(o.refunded_pence) filter (where o.payment_status in ('partially_refunded','refunded')), 0)::bigint as refunded_pence
    from days d
    left join public.orders o
      on (coalesce(o.paid_at, o.created_at) at time zone 'Europe/London')::date = d.day
    group by d.day
  ), restaurant_perf as (
    select
      r.id,
      r.name,
      count(o.id) filter (where o.payment_status in ('paid','partially_refunded','refunded'))::integer as order_count,
      coalesce(sum(o.total_pence) filter (where o.payment_status in ('paid','partially_refunded','refunded')),0)::bigint as gross_pence,
      round(avg(extract(epoch from (o.accepted_at - coalesce(o.paid_at,o.created_at))) / 60) filter (where o.accepted_at is not null and o.accepted_at >= coalesce(o.paid_at,o.created_at)),1) as avg_accept_minutes,
      round(avg(extract(epoch from (o.completed_at - coalesce(o.accepted_at,o.paid_at,o.created_at))) / 60) filter (where o.completed_at is not null),1) as avg_fulfilment_minutes,
      count(o.id) filter (where o.order_status in ('cancelled','rejected'))::integer as cancelled_orders
    from public.restaurants r
    left join public.orders o
      on o.restaurant_id = r.id
      and coalesce(o.paid_at,o.created_at) >= from_date::timestamptz
    where r.status in ('active','suspended')
    group by r.id,r.name
  )
  select jsonb_build_object(
    'range', jsonb_build_object('days', safe_days, 'from', from_date, 'to', (now() at time zone 'Europe/London')::date),
    'summary', jsonb_build_object(
      'paid_orders', coalesce((select sum(paid_orders) from daily),0),
      'failed_payments', coalesce((select sum(failed_payments) from daily),0),
      'gross_pence', coalesce((select sum(gross_pence) from daily),0),
      'refunded_pence', coalesce((select sum(refunded_pence) from daily),0),
      'average_order_value_pence', coalesce((select round(sum(gross_pence)::numeric / nullif(sum(paid_orders),0)) from daily),0),
      'payment_failure_rate', coalesce((select round(100.0 * sum(failed_payments) / nullif(sum(failed_payments)+sum(paid_orders),0),2) from daily),0),
      'online_restaurants', (select count(*) from public.restaurants where status='active' and accepting_orders),
      'offline_active_restaurants', (select count(*) from public.restaurants where status='active' and not accepting_orders)
    ),
    'daily', coalesce((select jsonb_agg(to_jsonb(x) order by x.day) from daily x),'[]'::jsonb),
    'top_restaurants', coalesce((select jsonb_agg(to_jsonb(x) order by x.gross_pence desc) from (select * from restaurant_perf order by gross_pence desc limit 10) x),'[]'::jsonb),
    'slow_restaurants', coalesce((select jsonb_agg(to_jsonb(x) order by x.avg_accept_minutes desc nulls last) from (select * from restaurant_perf where order_count > 0 order by avg_accept_minutes desc nulls last limit 10) x),'[]'::jsonb),
    'alerts', jsonb_build_object(
      'orders_waiting_over_10_minutes', (select count(*) from public.orders where order_status='placed' and payment_status in ('paid','partially_refunded') and coalesce(paid_at,created_at) < now()-interval '10 minutes'),
      'failed_payments_last_24h', (select count(*) from public.orders where payment_status='failed' and created_at > now()-interval '24 hours'),
      'failed_print_jobs', (select count(*) from public.print_jobs where status='failed'),
      'overdue_support_cases', (select count(*) from public.platform_support_cases where status not in ('resolved','closed') and resolution_due_at is not null and resolution_due_at < now()),
      'pending_restaurant_applications', (select count(*) from public.restaurants where status='pending_approval'),
      'failed_payouts', (select count(*) from public.platform_restaurant_payouts where status='failed')
    )
  ) into result;

  return result;
end;
$function$;

revoke all on function public.get_platform_analytics(integer) from public, anon, authenticated;
grant execute on function public.get_platform_analytics(integer) to authenticated;

comment on function public.get_platform_analytics(integer)
  is 'Platform KPI trends, restaurant performance and operational alerts for authorised administrators.';

commit;
