create or replace function public.get_restaurant_group_analytics(p_group_id uuid,p_scope_type text default 'group',p_scope_id uuid default null,p_days integer default 90) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_days integer:=greatest(7,least(coalesce(p_days,90),366));v_result jsonb;
begin
 if not private.restaurant_group_scope_allowed(p_group_id,'analytics:view',p_scope_type,p_scope_id) and not private.platform_admin_has_permission('restaurants:view') then raise exception 'Analytics permission required' using errcode='42501';end if;
 with ids as(select restaurant_id from private.restaurant_group_scope_restaurants(p_group_id,p_scope_type,p_scope_id)),
 daily as(select date_trunc('day',o.created_at)::date trend_day,sum(o.total_pence) revenue_pence,count(*) orders,count(distinct coalesce(o.customer_user_id::text,lower(o.customer_email))) customers from public.orders o join ids on ids.restaurant_id=o.restaurant_id where o.created_at>=now()-make_interval(days=>v_days) and o.payment_status in('paid','succeeded') group by 1),
 locations as(select l.restaurant_id,r.name,coalesce(sum(o.total_pence),0) revenue_pence,count(o.id) orders from public.restaurant_group_locations l join ids on ids.restaurant_id=l.restaurant_id join public.restaurants r on r.id=l.restaurant_id left join public.orders o on o.restaurant_id=l.restaurant_id and o.created_at>=now()-make_interval(days=>v_days) and o.payment_status in('paid','succeeded') group by l.restaurant_id,r.name),
 bench as(select avg(revenue_pence)::numeric avg_revenue,percentile_cont(.5)within group(order by revenue_pence)::numeric median_revenue,avg(orders)::numeric avg_orders from locations)
 select jsonb_build_object(
  'trend',coalesce((select jsonb_agg(to_jsonb(d) order by d.trend_day) from daily d),'[]'::jsonb),
  'locations',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('revenue_vs_average_percent',case when b.avg_revenue=0 then 0 else round(100.0*(l.revenue_pence-b.avg_revenue)/b.avg_revenue,1) end) order by l.revenue_pence desc) from locations l cross join bench b),'[]'::jsonb),
  'benchmark',coalesce((select jsonb_build_object('average_revenue_pence',round(avg_revenue)::bigint,'median_revenue_pence',round(median_revenue)::bigint,'average_orders',round(avg_orders,1)) from bench),jsonb_build_object()),
  'ai_comparison',coalesce((select jsonb_agg(jsonb_build_object('restaurant_id',x.restaurant_id,'restaurant_name',r.name,'metric',x.metric,'horizon',x.horizon,'predicted_value',x.predicted_value,'confidence',x.confidence,'period_start',x.period_start,'period_end',x.period_end) order by x.generated_at desc) from (select distinct on(f.restaurant_id,f.metric,f.horizon) f.* from public.restaurant_ai_forecasts f join ids on ids.restaurant_id=f.restaurant_id order by f.restaurant_id,f.metric,f.horizon,f.generated_at desc)x join public.restaurants r on r.id=x.restaurant_id),'[]'::jsonb),
  'insights',coalesce((select jsonb_agg(jsonb_build_object('restaurant_id',ai.restaurant_id,'restaurant_name',r.name,'category',ai.category,'severity',ai.severity,'title',ai.title,'summary',ai.summary,'confidence',ai.confidence,'suggested_action',ai.suggested_action,'generated_at',ai.generated_at) order by ai.generated_at desc) from (select a.* from public.restaurant_ai_insights a join ids on ids.restaurant_id=a.restaurant_id where a.status<>'dismissed' order by a.generated_at desc limit 100) ai join public.restaurants r on r.id=ai.restaurant_id),'[]'::jsonb)
 ) into v_result;return v_result;end $$;

create or replace function public.get_restaurant_group_shared_program_status(p_group_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.restaurant_group_member_permission(p_group_id,'loyalty:view') and not private.platform_admin_has_permission('restaurants:view') then raise exception 'Loyalty permission required' using errcode='42501';end if;
 return jsonb_build_object(
  'settings',(select to_jsonb(s) from public.restaurant_group_sharing_settings s where s.group_id=p_group_id),
  'locations',coalesce((select jsonb_agg(jsonb_build_object('restaurant_id',l.restaurant_id,'restaurant_name',r.name,'loyalty_accounts',(select count(*) from public.customer_loyalty_accounts a where a.restaurant_id=l.restaurant_id),'credit_accounts',(select count(*) from public.customer_credit_accounts a where a.restaurant_id=l.restaurant_id),'gift_cards',(select count(*) from public.restaurant_gift_cards g where g.restaurant_id=l.restaurant_id and g.is_active),'rewards',(select count(*) from public.restaurant_loyalty_rewards rw where rw.restaurant_id=l.restaurant_id and rw.is_active),'stamp_programs',(select count(*) from public.restaurant_stamp_programs sp where sp.restaurant_id=l.restaurant_id and sp.is_active),'vip_enabled',coalesce((select v.is_enabled from public.restaurant_vip_programs v where v.restaurant_id=l.restaurant_id),false),'referrals_enabled',coalesce((select rp.is_enabled from public.restaurant_referral_programs rp where rp.restaurant_id=l.restaurant_id),false)) order by r.name) from public.restaurant_group_locations l join public.restaurants r on r.id=l.restaurant_id where l.group_id=p_group_id and l.status='active'),'[]'::jsonb));
end $$;

drop policy if exists menu_items_owner_manager_insert on public.menu_items;
drop policy if exists menu_items_owner_manager_update on public.menu_items;
create policy menu_items_owner_manager_insert on public.menu_items for insert to authenticated with check(
 has_restaurant_role(restaurant_id,array['owner'::restaurant_member_role,'manager'::restaurant_member_role]) and exists(select 1 from public.menu_categories c where c.id=menu_items.category_id and c.restaurant_id=menu_items.restaurant_id)
);
create policy menu_items_owner_manager_update on public.menu_items for update to authenticated using(
 has_restaurant_role(restaurant_id,array['owner'::restaurant_member_role,'manager'::restaurant_member_role])
) with check(
 has_restaurant_role(restaurant_id,array['owner'::restaurant_member_role,'manager'::restaurant_member_role]) and exists(select 1 from public.menu_categories c where c.id=menu_items.category_id and c.restaurant_id=menu_items.restaurant_id)
);

create index if not exists orders_group_reporting_idx on public.orders(restaurant_id,created_at desc,payment_status,customer_user_id);
create index if not exists loyalty_group_customer_idx on public.customer_loyalty_accounts(customer_user_id,restaurant_id);
create index if not exists credit_group_customer_idx on public.customer_credit_accounts(customer_user_id,restaurant_id);
create index if not exists reward_vouchers_group_customer_idx on public.customer_reward_vouchers(customer_user_id,restaurant_id,status,expires_at);
create index if not exists gift_cards_group_lookup_idx on public.restaurant_gift_cards(restaurant_id,is_active,expires_at) include(remaining_value_pence,recipient_email);
create index if not exists vip_group_customer_idx on public.customer_vip_memberships(customer_user_id,restaurant_id,current_tier_id);
create index if not exists referrals_group_customer_idx on public.customer_referrals(referred_user_id,restaurant_id,status,created_at desc);
create index if not exists marketing_conversions_group_idx on public.restaurant_marketing_conversions(restaurant_id,attributed_at desc);
create index if not exists ai_forecasts_group_idx on public.restaurant_ai_forecasts(restaurant_id,generated_at desc,metric,horizon);

revoke all on function public.get_restaurant_group_analytics(uuid,text,uuid,integer),public.get_restaurant_group_shared_program_status(uuid) from public;
grant execute on function public.get_restaurant_group_analytics(uuid,text,uuid,integer),public.get_restaurant_group_shared_program_status(uuid) to authenticated;
