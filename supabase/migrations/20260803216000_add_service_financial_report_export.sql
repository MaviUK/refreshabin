begin;

create or replace function public.get_service_financial_report_export(
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 731 then
    raise exception 'Choose a valid reporting period of no more than two years';
  end if;

  with settled as (
    select
      o.restaurant_id,
      r.name as restaurant_name,
      o.total_pence,
      greatest(o.total_pence - o.service_fee_pence, 0) as gross_sales_pence,
      o.refunded_pence,
      o.service_fee_pence,
      o.platform_commission_pence,
      o.platform_commission_vat_pence,
      greatest(
        o.restaurant_net_pence - least(
          o.refunded_pence,
          greatest(o.total_pence - o.service_fee_pence, 0)
        ),
        0
      ) as net_revenue_pence
    from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
    where o.payment_status in ('paid', 'partially_refunded', 'refunded')
      and coalesce(o.paid_at, o.created_at) >= p_from::timestamptz
      and coalesce(o.paid_at, o.created_at) < (p_to + 1)::timestamptz
  ), grouped as (
    select
      restaurant_id,
      restaurant_name,
      count(*)::integer as order_count,
      coalesce(sum(total_pence), 0)::bigint as captured_pence,
      coalesce(sum(gross_sales_pence), 0)::bigint as gross_sales_pence,
      coalesce(sum(refunded_pence), 0)::bigint as refunded_pence,
      coalesce(sum(service_fee_pence), 0)::bigint as service_fees_pence,
      coalesce(sum(platform_commission_pence), 0)::bigint as commission_pence,
      coalesce(sum(platform_commission_vat_pence), 0)::bigint as commission_vat_pence,
      coalesce(sum(net_revenue_pence), 0)::bigint as net_revenue_pence
    from settled
    group by restaurant_id, restaurant_name
  )
  select coalesce(jsonb_agg(to_jsonb(grouped) order by gross_sales_pence desc), '[]'::jsonb)
  into result
  from grouped;

  return result;
end;
$function$;

revoke all on function public.get_service_financial_report_export(date,date) from public, anon, authenticated;
grant execute on function public.get_service_financial_report_export(date,date) to service_role;

commit;
