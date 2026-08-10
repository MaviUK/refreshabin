begin;

create or replace function public.get_platform_customers(p_search text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '8s'
as $function$
declare
  result jsonb;
  clean_search text := nullif(trim(coalesce(p_search, '')), '');
begin
  if not private.has_platform_admin_permission('customers:view') then
    raise exception 'You do not have permission to view customers' using errcode = '42501';
  end if;

  with matched_users as materialized (
    select
      u.id,
      u.email,
      u.created_at,
      u.last_sign_in_at,
      u.banned_until,
      p.first_name,
      p.last_name,
      p.phone,
      p.town_city,
      p.postcode
    from auth.users u
    left join public.customer_profiles p on p.user_id = u.id
    where not exists (
      select 1 from public.platform_admins pa where pa.user_id = u.id
    )
      and (
        clean_search is null
        or u.email ilike '%' || clean_search || '%'
        or p.first_name ilike '%' || clean_search || '%'
        or p.last_name ilike '%' || clean_search || '%'
        or p.phone ilike '%' || clean_search || '%'
      )
    order by u.created_at desc
    limit 250
  ), order_totals as materialized (
    select
      o.customer_user_id,
      count(*)::integer as order_count,
      coalesce(sum(o.total_pence) filter (
        where o.payment_status in ('paid', 'partially_refunded', 'refunded')
      ), 0)::bigint as lifetime_spend_pence,
      max(o.created_at) as last_order_at
    from public.orders o
    join matched_users mu on mu.id = o.customer_user_id
    group by o.customer_user_id
  )
  select coalesce(jsonb_agg(customer_row order by customer_row.created_at desc), '[]'::jsonb)
  into result
  from (
    select
      mu.id as user_id,
      mu.email,
      coalesce(
        nullif(trim(concat_ws(' ', mu.first_name, mu.last_name)), ''),
        split_part(mu.email, '@', 1)
      ) as display_name,
      mu.phone,
      mu.town_city,
      mu.postcode,
      mu.created_at,
      mu.last_sign_in_at,
      (mu.banned_until is not null and mu.banned_until > now()) as is_suspended,
      coalesce(ot.order_count, 0) as order_count,
      coalesce(ot.lifetime_spend_pence, 0) as lifetime_spend_pence,
      ot.last_order_at
    from matched_users mu
    left join order_totals ot on ot.customer_user_id = mu.id
  ) customer_row;

  return result;
end;
$function$;

create or replace function public.get_platform_analytics(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '12s'
as $function$
declare
  result jsonb;
  safe_days integer := least(greatest(coalesce(p_days, 30), 7), 90);
  today_london date := (now() at time zone 'Europe/London')::date;
  from_date date;
  from_at timestamptz;
  to_at timestamptz;
begin
  if not private.has_platform_admin_permission('overview:view') then
    raise exception 'You do not have permission to view platform analytics' using errcode = '42501';
  end if;

  from_date := today_london - (safe_days - 1);
  from_at := from_date::timestamp at time zone 'Europe/London';
  to_at := (today_london + 1)::timestamp at time zone 'Europe/London';

  with ranged_orders as materialized (
    select
      o.id,
      o.restaurant_id,
      o.payment_status,
      o.order_status,
      o.total_pence,
      o.refunded_pence,
      o.created_at,
      o.paid_at,
      o.accepted_at,
      o.completed_at,
      coalesce(o.paid_at, o.created_at) as activity_at
    from public.orders o
    where coalesce(o.paid_at, o.created_at) >= from_at
      and coalesce(o.paid_at, o.created_at) < to_at
  ), daily_orders as materialized (
    select
      (ro.activity_at at time zone 'Europe/London')::date as day,
      count(*) filter (where ro.payment_status in ('paid','partially_refunded','refunded'))::integer as paid_orders,
      count(*) filter (where ro.payment_status = 'failed')::integer as failed_payments,
      coalesce(sum(ro.total_pence) filter (
        where ro.payment_status in ('paid','partially_refunded','refunded')
      ), 0)::bigint as gross_pence,
      coalesce(sum(ro.refunded_pence) filter (
        where ro.payment_status in ('partially_refunded','refunded')
      ), 0)::bigint as refunded_pence
    from ranged_orders ro
    group by (ro.activity_at at time zone 'Europe/London')::date
  ), days as (
    select generate_series(from_date, today_london, interval '1 day')::date as day
  ), daily as materialized (
    select
      d.day,
      coalesce(x.paid_orders, 0) as paid_orders,
      coalesce(x.failed_payments, 0) as failed_payments,
      coalesce(x.gross_pence, 0) as gross_pence,
      coalesce(x.refunded_pence, 0) as refunded_pence
    from days d
    left join daily_orders x on x.day = d.day
  ), daily_summary as materialized (
    select
      coalesce(sum(paid_orders), 0)::bigint as paid_orders,
      coalesce(sum(failed_payments), 0)::bigint as failed_payments,
      coalesce(sum(gross_pence), 0)::bigint as gross_pence,
      coalesce(sum(refunded_pence), 0)::bigint as refunded_pence
    from daily
  ), restaurant_perf as materialized (
    select
      r.id,
      r.name,
      count(ro.id) filter (
        where ro.payment_status in ('paid','partially_refunded','refunded')
      )::integer as order_count,
      coalesce(sum(ro.total_pence) filter (
        where ro.payment_status in ('paid','partially_refunded','refunded')
      ), 0)::bigint as gross_pence,
      round(avg(extract(epoch from (ro.accepted_at - ro.activity_at)) / 60)
        filter (where ro.accepted_at is not null and ro.accepted_at >= ro.activity_at), 1) as avg_accept_minutes,
      round(avg(extract(epoch from (
        ro.completed_at - coalesce(ro.accepted_at, ro.activity_at)
      )) / 60) filter (where ro.completed_at is not null), 1) as avg_fulfilment_minutes,
      count(ro.id) filter (where ro.order_status in ('cancelled','rejected'))::integer as cancelled_orders
    from public.restaurants r
    left join ranged_orders ro on ro.restaurant_id = r.id
    where r.status in ('active','suspended')
    group by r.id, r.name
  )
  select jsonb_build_object(
    'range', jsonb_build_object('days', safe_days, 'from', from_date, 'to', today_london),
    'summary', jsonb_build_object(
      'paid_orders', ds.paid_orders,
      'failed_payments', ds.failed_payments,
      'gross_pence', ds.gross_pence,
      'refunded_pence', ds.refunded_pence,
      'average_order_value_pence', coalesce(round(ds.gross_pence::numeric / nullif(ds.paid_orders, 0)), 0),
      'payment_failure_rate', coalesce(round(100.0 * ds.failed_payments / nullif(ds.failed_payments + ds.paid_orders, 0), 2), 0),
      'online_restaurants', (select count(*) from public.restaurants where status = 'active' and accepting_orders),
      'offline_active_restaurants', (select count(*) from public.restaurants where status = 'active' and not accepting_orders)
    ),
    'daily', coalesce((select jsonb_agg(to_jsonb(x) order by x.day) from daily x), '[]'::jsonb),
    'top_restaurants', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.gross_pence desc)
      from (select * from restaurant_perf order by gross_pence desc limit 10) x
    ), '[]'::jsonb),
    'slow_restaurants', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.avg_accept_minutes desc nulls last)
      from (
        select * from restaurant_perf
        where order_count > 0
        order by avg_accept_minutes desc nulls last
        limit 10
      ) x
    ), '[]'::jsonb),
    'alerts', jsonb_build_object(
      'orders_waiting_over_10_minutes', (
        select count(*) from public.orders
        where order_status = 'placed'
          and payment_status in ('paid','partially_refunded')
          and coalesce(paid_at, created_at) < now() - interval '10 minutes'
      ),
      'failed_payments_last_24h', (
        select count(*) from public.orders
        where payment_status = 'failed' and created_at > now() - interval '24 hours'
      ),
      'failed_print_jobs', (select count(*) from public.print_jobs where status = 'failed'),
      'overdue_support_cases', (
        select count(*) from public.platform_support_cases
        where status not in ('resolved','closed')
          and resolution_due_at is not null
          and resolution_due_at < now()
      ),
      'pending_restaurant_applications', (
        select count(*) from public.restaurants where status = 'pending_approval'
      ),
      'failed_payouts', (
        select count(*) from public.platform_restaurant_payouts where status = 'failed'
      )
    )
  ) into result
  from daily_summary ds;

  return result;
end;
$function$;

revoke all on function public.get_platform_customers(text), public.get_platform_analytics(integer)
  from public, anon, authenticated;
grant execute on function public.get_platform_customers(text), public.get_platform_analytics(integer)
  to authenticated;

commit;
