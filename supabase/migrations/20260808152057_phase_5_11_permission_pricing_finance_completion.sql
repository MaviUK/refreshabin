create or replace function private.restaurant_group_member_permission(
  p_group_id uuid,
  p_permission text,
  p_restaurant_id uuid default null,
  p_brand_id uuid default null,
  p_region_id uuid default null
) returns boolean language sql stable security definer set search_path='' as $$
  with target as (
    select p_group_id group_id,
      coalesce(p_brand_id,l.brand_id) brand_id,
      coalesce(p_region_id,l.region_id) region_id,
      p_restaurant_id restaurant_id
    from (values(1)) v(x)
    left join public.restaurant_group_locations l on l.restaurant_id=p_restaurant_id and l.group_id=p_group_id
  )
  select exists(select 1 from public.restaurant_groups g where g.id=p_group_id and g.status='active')
    and coalesce(bool_or(
      (case
        when m.permissions ? p_permission then coalesce((m.permissions->>p_permission)::boolean,false)
        else coalesce((r.permissions->>p_permission)::boolean,false)
      end)
      and (
        m.scope_type='group'
        or (m.scope_type='brand' and m.brand_id=t.brand_id)
        or (m.scope_type='region' and t.region_id is not null and private.restaurant_group_region_contains(m.region_id,t.region_id))
        or (m.scope_type='restaurant' and m.restaurant_id=t.restaurant_id)
        or (m.scope_type='department' and exists(
          select 1 from public.restaurant_group_departments d
          where d.id=m.department_id and d.group_id=p_group_id
            and (t.restaurant_id is null or d.restaurant_id=t.restaurant_id)
        ))
      )
    ),false)
  from public.restaurant_group_members m
  join public.restaurant_group_roles r on r.id=m.role_id and r.group_id=m.group_id
  cross join target t
  where m.group_id=p_group_id and m.user_id=(select auth.uid()) and m.status='active'
$$;

create or replace function public.refresh_restaurant_group_timed_prices()
returns integer language plpgsql security definer set search_path='' as $$
declare rec record; v_count integer:=0;
begin
 if current_user not in ('postgres','service_role') and session_user not in ('postgres','service_role') then raise exception 'Service role required' using errcode='42501'; end if;
 for rec in
   select distinct t.id as template_id
   from public.restaurant_group_menu_templates t
   join public.restaurant_groups g on g.id=t.group_id and g.status='active'
   where t.status='active'
     and exists (
       select 1
       from public.restaurant_group_menu_items gi
       join public.restaurant_group_price_overrides po on po.template_item_id=gi.id and (po.starts_at is not null or po.ends_at is not null)
       where gi.template_id=t.id
         and exists (
           select 1
           from private.restaurant_group_template_targets(t.id) tr
           join public.menu_items mi on mi.restaurant_id=tr.restaurant_id and mi.group_template_item_id=gi.id
           where mi.price_pence is distinct from private.restaurant_group_effective_item_price(gi.id,tr.restaurant_id)
         )
     )
 loop
   perform private.publish_restaurant_group_menu_template(rec.template_id,null,null);
   v_count:=v_count+1;
 end loop;
 return v_count;
end $$;
revoke all on function public.refresh_restaurant_group_timed_prices() from public,anon,authenticated;
grant execute on function public.refresh_restaurant_group_timed_prices() to service_role;

create or replace function public.get_restaurant_group_financial_reporting(p_group_id uuid,p_scope_type text default 'group',p_scope_id uuid default null,p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 v_days integer:=greatest(1,least(coalesce(p_days,30),366));
 v_from timestamptz:=now()-make_interval(days=>v_days);
 v_result jsonb;
begin
 if not private.restaurant_group_scope_allowed(p_group_id,'finance:view',p_scope_type,p_scope_id)
    and not private.platform_admin_has_permission('finance:view') then
   raise exception 'Finance permission required' using errcode='42501';
 end if;
 with ids as (
   select restaurant_id from private.restaurant_group_scope_restaurants(p_group_id,p_scope_type,p_scope_id)
 ), paid as (
   select o.* from public.orders o join ids on ids.restaurant_id=o.restaurant_id
   where o.created_at>=v_from and o.payment_status in('paid','succeeded')
 ), order_days as (
   select date_trunc('day',created_at)::date trend_day,
     coalesce(sum(total_pence),0)::bigint revenue_pence,
     coalesce(sum(platform_commission_pence+platform_commission_vat_pence),0)::bigint commission_pence,
     coalesce(sum(service_fee_pence),0)::bigint service_fee_pence,
     coalesce(sum(restaurant_net_pence),0)::bigint restaurant_net_pence,
     count(*)::bigint orders
   from paid group by 1
 ), subscription_days as (
   select date_trunc('day',i.paid_at)::date trend_day,coalesce(sum(i.amount_paid_pence),0)::bigint subscription_revenue_pence
   from public.restaurant_subscription_invoices i join ids on ids.restaurant_id=i.restaurant_id
   where i.paid_at>=v_from group by 1
 ), day_keys as (
   select trend_day from order_days union select trend_day from subscription_days
 ), trends as (
   select d.trend_day,
     coalesce(o.revenue_pence,0)::bigint revenue_pence,
     coalesce(o.commission_pence,0)::bigint commission_pence,
     coalesce(o.service_fee_pence,0)::bigint service_fee_pence,
     coalesce(s.subscription_revenue_pence,0)::bigint subscription_revenue_pence,
     coalesce(o.restaurant_net_pence,0)::bigint restaurant_net_pence,
     coalesce(o.orders,0)::bigint orders,
     (coalesce(o.commission_pence,0)+coalesce(o.service_fee_pence,0)+coalesce(s.subscription_revenue_pence,0))::bigint platform_profit_proxy_pence
   from day_keys d left join order_days o on o.trend_day=d.trend_day left join subscription_days s on s.trend_day=d.trend_day
 )
 select jsonb_build_object(
   'period_from',v_from,'period_to',now(),'days',v_days,
   'revenue_pence',coalesce((select sum(total_pence) from paid),0),
   'commission_pence',coalesce((select sum(platform_commission_pence+platform_commission_vat_pence) from paid),0),
   'subscription_revenue_pence',coalesce((select sum(i.amount_paid_pence) from public.restaurant_subscription_invoices i join ids on ids.restaurant_id=i.restaurant_id where i.paid_at>=v_from),0),
   'marketing_spend_pence',coalesce((select sum(c.reward_cost_pence) from public.restaurant_marketing_conversions c join ids on ids.restaurant_id=c.restaurant_id where c.attributed_at>=v_from),0),
   'marketing_spend_basis','tracked_reward_incentives',
   'reward_costs_pence',coalesce((select sum(c.reward_cost_pence) from public.restaurant_marketing_conversions c join ids on ids.restaurant_id=c.restaurant_id where c.attributed_at>=v_from),0),
   'average_spend_pence',coalesce((select round(avg(total_pence))::bigint from paid),0),
   'refunds_pence',coalesce((select sum(i.refunded_pence) from public.restaurant_subscription_invoices i join ids on ids.restaurant_id=i.restaurant_id where i.updated_at>=v_from),0)+coalesce((select sum(w.refunded_pence) from public.restaurant_weekly_invoices w join ids on ids.restaurant_id=w.restaurant_id where w.updated_at>=v_from),0),
   'restaurant_net_pence',coalesce((select sum(restaurant_net_pence) from paid),0),
   'profit_proxy_pence',coalesce((select sum(platform_commission_pence+platform_commission_vat_pence+service_fee_pence) from paid),0)+coalesce((select sum(i.amount_paid_pence) from public.restaurant_subscription_invoices i join ids on ids.restaurant_id=i.restaurant_id where i.paid_at>=v_from),0),
   'profit_trends',coalesce((select jsonb_agg(to_jsonb(t) order by t.trend_day) from trends t),'[]'::jsonb)
 ) into v_result;
 return v_result;
end $$;
