begin;

create index if not exists orders_financial_reporting_idx
  on public.orders (restaurant_id, paid_at desc)
  where payment_status in ('paid','partially_refunded','refunded');

create or replace function public.get_restaurant_financial_overview(
  p_from date default (current_date - 29),
  p_to date default current_date,
  p_restaurant_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path=''
as $function$
declare result jsonb;
begin
  if not private.has_platform_admin_permission('finance:view') then
    raise exception 'You do not have permission to view restaurant financials' using errcode='42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 731 then
    raise exception 'Choose a valid reporting period of no more than two years';
  end if;
  if p_restaurant_id is not null and not exists(select 1 from public.restaurants where id=p_restaurant_id) then
    raise exception 'Restaurant not found';
  end if;

  with settled as (
    select o.restaurant_id, r.name restaurant_name, o.id,
      o.total_pence, greatest(o.total_pence-o.service_fee_pence,0) gross_sales_pence,
      o.refunded_pence, o.service_fee_pence, o.platform_commission_pence,
      o.platform_commission_vat_pence,
      greatest(o.restaurant_net_pence-least(o.refunded_pence,greatest(o.total_pence-o.service_fee_pence,0)),0) net_revenue_pence
    from public.orders o join public.restaurants r on r.id=o.restaurant_id
    where o.payment_status in ('paid','partially_refunded','refunded')
      and coalesce(o.paid_at,o.created_at) >= p_from::timestamptz
      and coalesce(o.paid_at,o.created_at) < (p_to+1)::timestamptz
      and (p_restaurant_id is null or o.restaurant_id=p_restaurant_id)
  ), grouped as (
    select restaurant_id,restaurant_name,count(*)::integer order_count,
      coalesce(sum(total_pence),0)::bigint captured_pence,
      coalesce(sum(gross_sales_pence),0)::bigint gross_sales_pence,
      coalesce(sum(refunded_pence),0)::bigint refunded_pence,
      coalesce(sum(service_fee_pence),0)::bigint service_fees_pence,
      coalesce(sum(platform_commission_pence),0)::bigint commission_pence,
      coalesce(sum(platform_commission_vat_pence),0)::bigint commission_vat_pence,
      coalesce(sum(net_revenue_pence),0)::bigint net_revenue_pence
    from settled group by restaurant_id,restaurant_name
  )
  select jsonb_build_object(
    'range',jsonb_build_object('from',p_from,'to',p_to),
    'restaurants',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name) order by r.name) from public.restaurants r where r.status in ('active','suspended')),'[]'::jsonb),
    'rows',coalesce((select jsonb_agg(to_jsonb(g)||jsonb_build_object('payout_status','not connected') order by g.gross_sales_pence desc) from grouped g),'[]'::jsonb),
    'summary',jsonb_build_object(
      'order_count',coalesce((select sum(order_count) from grouped),0),
      'captured_pence',coalesce((select sum(captured_pence) from grouped),0),
      'gross_sales_pence',coalesce((select sum(gross_sales_pence) from grouped),0),
      'refunded_pence',coalesce((select sum(refunded_pence) from grouped),0),
      'service_fees_pence',coalesce((select sum(service_fees_pence) from grouped),0),
      'commission_pence',coalesce((select sum(commission_pence) from grouped),0),
      'commission_vat_pence',coalesce((select sum(commission_vat_pence) from grouped),0),
      'net_revenue_pence',coalesce((select sum(net_revenue_pence) from grouped),0)
    )
  ) into result;
  return result;
end;
$function$;

revoke all on function public.get_restaurant_financial_overview(date,date,uuid) from public,anon,authenticated;
grant execute on function public.get_restaurant_financial_overview(date,date,uuid) to authenticated;

commit;
