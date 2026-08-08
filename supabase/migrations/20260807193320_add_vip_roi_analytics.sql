alter function public.get_restaurant_vip_dashboard() rename to get_restaurant_vip_dashboard_base;
alter function public.get_platform_vip_dashboard() rename to get_platform_vip_dashboard_base;

create or replace function public.get_restaurant_vip_dashboard()
returns jsonb language plpgsql security definer set search_path='' as $$
declare base jsonb; rid uuid; revenue bigint:=0; cost bigint:=0; roi numeric:=0;
begin
  select restaurant_id into rid from public.restaurant_members where user_id=auth.uid() order by created_at limit 1;
  if rid is null then raise exception 'Restaurant membership not found' using errcode='42501'; end if;
  base:=public.get_restaurant_vip_dashboard_base();
  select coalesce(sum(o.total_pence+o.customer_credit_used_pence+o.gift_card_used_pence),0),coalesce(sum(o.vip_discount_pence),0)
    into revenue,cost from public.orders o
    where o.restaurant_id=rid and o.vip_tier_id is not null and o.order_status='completed' and o.payment_status in ('paid','partially_refunded') and o.completed_at>=now()-interval '90 days';
  if cost>0 then roi:=round(100.0*(revenue-cost)/cost,1); end if;
  return jsonb_set(base,'{summary}',coalesce(base->'summary','{}'::jsonb)||jsonb_build_object('vip_discount_cost_90d_pence',cost,'roi_percent',roi),true);
end $$;

create or replace function public.get_platform_vip_dashboard()
returns jsonb language plpgsql security definer set search_path='' as $$
declare base jsonb; revenue bigint:=0; cost bigint:=0; roi numeric:=0;
begin
  if not private.has_platform_admin_permission('overview:view') then raise exception 'Platform overview permission required' using errcode='42501'; end if;
  base:=public.get_platform_vip_dashboard_base();
  select coalesce(sum(o.total_pence+o.customer_credit_used_pence+o.gift_card_used_pence),0),coalesce(sum(o.vip_discount_pence),0)
    into revenue,cost from public.orders o
    where o.vip_tier_id is not null and o.order_status='completed' and o.payment_status in ('paid','partially_refunded') and o.completed_at>=now()-interval '90 days';
  if cost>0 then roi:=round(100.0*(revenue-cost)/cost,1); end if;
  return jsonb_set(base,'{summary}',coalesce(base->'summary','{}'::jsonb)||jsonb_build_object('vip_discount_cost_90d_pence',cost,'roi_percent',roi),true);
end $$;

revoke all on function public.get_restaurant_vip_dashboard(),public.get_platform_vip_dashboard(),public.get_restaurant_vip_dashboard_base(),public.get_platform_vip_dashboard_base() from public,anon;
grant execute on function public.get_restaurant_vip_dashboard(),public.get_restaurant_vip_dashboard_base() to authenticated,service_role;
grant execute on function public.get_platform_vip_dashboard(),public.get_platform_vip_dashboard_base() to authenticated,service_role;
