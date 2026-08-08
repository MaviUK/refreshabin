create or replace function public.get_restaurant_group_dashboard(p_group_id uuid, p_scope_type text default 'group'::text, p_scope_id uuid default null::uuid, p_days integer default 30)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $$
declare
  v_from timestamptz:=now()-make_interval(days=>greatest(1,least(coalesce(p_days,30),366)));
  v_result jsonb;
begin
  if not private.restaurant_group_scope_allowed(p_group_id,'analytics:view',p_scope_type,p_scope_id)
     and not private.platform_admin_has_permission('restaurants:view') then
    raise exception 'Analytics permission required' using errcode='42501';
  end if;

  with ids as (
    select restaurant_id from private.restaurant_group_scope_restaurants(p_group_id,p_scope_type,p_scope_id)
  ),
  paid as (
    select o.* from public.orders o join ids on ids.restaurant_id=o.restaurant_id
    where o.created_at>=v_from and o.payment_status in('paid','succeeded')
  ),
  cust as (
    select coalesce(o.customer_user_id::text,lower(o.customer_email)) customer_key,count(*) orders,sum(o.total_pence) revenue
    from paid o group by 1
  ),
  loc as (
    select l.restaurant_id,r.name,r.accepting_orders,r.status,
      (select count(*) from public.menu_items mi where mi.restaurant_id=l.restaurant_id and mi.is_available) available_items,
      (select max(o.created_at) from public.orders o where o.restaurant_id=l.restaurant_id) last_order_at
    from public.restaurant_group_locations l
    join public.restaurants r on r.id=l.restaurant_id
    join ids on ids.restaurant_id=l.restaurant_id
  )
  select jsonb_build_object(
    'period',jsonb_build_object('from',v_from,'to',now(),'days',greatest(1,least(coalesce(p_days,30),366))),
    'scope',jsonb_build_object('group_id',p_group_id,'scope_type',p_scope_type,'scope_id',p_scope_id),
    'total_revenue_pence',coalesce((select sum(total_pence) from paid),0),
    'orders',coalesce((select count(*) from paid),0),
    'customers',coalesce((select count(*) from cust),0),
    'repeat_customers',coalesce((select count(*) from cust where orders>1),0),
    'average_order_value_pence',coalesce((select round(avg(total_pence))::bigint from paid),0),
    'loyalty_members',coalesce((select count(distinct a.customer_user_id) from public.customer_loyalty_accounts a join ids on ids.restaurant_id=a.restaurant_id),0),
    'vip_members',coalesce((select count(distinct v.customer_user_id) from public.customer_vip_memberships v join ids on ids.restaurant_id=v.restaurant_id where v.current_tier_id is not null),0),
    'campaign_performance',jsonb_build_object(
      'sent',coalesce((select count(*) from public.restaurant_marketing_deliveries d join ids on ids.restaurant_id=d.restaurant_id where d.created_at>=v_from and d.status in('sent','delivered')),0),
      'opened',coalesce((select count(*) from public.restaurant_marketing_deliveries d join ids on ids.restaurant_id=d.restaurant_id where d.created_at>=v_from and d.opened_at is not null),0),
      'clicked',coalesce((select count(*) from public.restaurant_marketing_deliveries d join ids on ids.restaurant_id=d.restaurant_id where d.created_at>=v_from and d.clicked_at is not null),0),
      'revenue_pence',coalesce((select sum(c.revenue_pence) from public.restaurant_marketing_conversions c join ids on ids.restaurant_id=c.restaurant_id where c.attributed_at>=v_from),0)
    ),
    'locations_online',coalesce((select count(*) from loc where accepting_orders and status='active'),0),
    'locations_total',coalesce((select count(*) from loc),0),
    'store_health',coalesce((
      select jsonb_build_object(
        'healthy',count(*) filter(where accepting_orders and status='active' and available_items>0),
        'attention',count(*) filter(where not accepting_orders or status<>'active' or available_items=0),
        'score',case when count(*)=0 then 100 else round(100.0*count(*) filter(where accepting_orders and status='active' and available_items>0)/count(*),1) end
      ) from loc
    ),jsonb_build_object('healthy',0,'attention',0,'score',100)),
    'locations',coalesce((select jsonb_agg(jsonb_build_object('restaurant_id',restaurant_id,'name',name,'status',status,'accepting_orders',accepting_orders,'available_items',available_items,'last_order_at',last_order_at) order by name) from loc),'[]'::jsonb)
  ) into v_result;

  return v_result;
end
$$;

revoke all on function public.get_restaurant_group_dashboard(uuid,text,uuid,integer) from public,anon;
grant execute on function public.get_restaurant_group_dashboard(uuid,text,uuid,integer) to authenticated,service_role;
