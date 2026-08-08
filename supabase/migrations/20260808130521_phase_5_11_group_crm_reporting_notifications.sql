create or replace function private.restaurant_group_scope_restaurants(p_group_id uuid,p_scope_type text default 'group',p_scope_id uuid default null)
returns table(restaurant_id uuid) language plpgsql stable security definer set search_path='' as $$
begin
 if p_scope_type='group' then return query select l.restaurant_id from public.restaurant_group_locations l where l.group_id=p_group_id and l.status='active';
 elsif p_scope_type='brand' then return query select l.restaurant_id from public.restaurant_group_locations l where l.group_id=p_group_id and l.brand_id=p_scope_id and l.status='active';
 elsif p_scope_type='region' then return query select l.restaurant_id from public.restaurant_group_locations l where l.group_id=p_group_id and l.region_id is not null and private.restaurant_group_region_contains(p_scope_id,l.region_id) and l.status='active';
 elsif p_scope_type='restaurant' then return query select l.restaurant_id from public.restaurant_group_locations l where l.group_id=p_group_id and l.restaurant_id=p_scope_id and l.status='active';
 else raise exception 'Unsupported scope type'; end if;
end $$;
create or replace function private.restaurant_group_scope_allowed(p_group_id uuid,p_permission text,p_scope_type text,p_scope_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare r uuid; b uuid; g uuid;
begin
 if p_scope_type='group' then return private.restaurant_group_member_permission(p_group_id,p_permission);
 elsif p_scope_type='brand' then return private.restaurant_group_member_permission(p_group_id,p_permission,null,p_scope_id,null);
 elsif p_scope_type='region' then return private.restaurant_group_member_permission(p_group_id,p_permission,null,null,p_scope_id);
 elsif p_scope_type='restaurant' then return private.restaurant_group_member_permission(p_group_id,p_permission,p_scope_id,null,null);
 end if; return false;
end $$;
create or replace function public.get_restaurant_group_dashboard(p_group_id uuid,p_scope_type text default 'group',p_scope_id uuid default null,p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_from timestamptz:=now()-make_interval(days=>greatest(1,least(coalesce(p_days,30),366))); v_result jsonb;
begin
 if not private.restaurant_group_scope_allowed(p_group_id,'analytics:view',p_scope_type,p_scope_id) and not private.platform_admin_has_permission('restaurants:view') then raise exception 'Analytics permission required' using errcode='42501'; end if;
 with ids as (select restaurant_id from private.restaurant_group_scope_restaurants(p_group_id,p_scope_type,p_scope_id)),
 paid as (select o.* from public.orders o join ids on ids.restaurant_id=o.restaurant_id where o.created_at>=v_from and o.payment_status in('paid','succeeded')),
 cust as (select coalesce(o.customer_user_id::text,lower(o.customer_email)) customer_key,count(*) orders,sum(o.total_pence) revenue from paid o group by 1),
 loc as (select l.restaurant_id,r.name,r.accepting_orders,r.status,
   (select count(*) from public.menu_items mi where mi.restaurant_id=l.restaurant_id and mi.is_available) available_items,
   (select max(o.created_at) from public.orders o where o.restaurant_id=l.restaurant_id) last_order_at from public.restaurant_group_locations l join public.restaurants r on r.id=l.restaurant_id join ids on ids.restaurant_id=l.restaurant_id)
 select jsonb_build_object(
  'period',jsonb_build_object('from',v_from,'to',now(),'days',greatest(1,least(coalesce(p_days,30),366))),
  'scope',jsonb_build_object('group_id',p_group_id,'scope_type',p_scope_type,'scope_id',p_scope_id),
  'total_revenue_pence',coalesce((select sum(total_pence) from paid),0),'orders',coalesce((select count(*) from paid),0),
  'customers',coalesce((select count(*) from cust),0),'repeat_customers',coalesce((select count(*) from cust where orders>1),0),
  'average_order_value_pence',coalesce((select round(avg(total_pence))::bigint from paid),0),
  'loyalty_members',coalesce((select count(distinct a.customer_user_id) from public.customer_loyalty_accounts a join ids on ids.restaurant_id=a.restaurant_id),0),
  'vip_members',coalesce((select count(distinct v.customer_user_id) from public.customer_vip_memberships v join ids on ids.restaurant_id=v.restaurant_id where v.current_tier_id is not null),0),
  'campaign_performance',jsonb_build_object(
    'sent',coalesce((select count(*) from public.restaurant_marketing_deliveries d join ids on ids.restaurant_id=d.restaurant_id where d.created_at>=v_from and d.status in('sent','delivered')),0),
    'opened',coalesce((select count(*) from public.restaurant_marketing_deliveries d join ids on ids.restaurant_id=d.restaurant_id where d.created_at>=v_from and d.opened_at is not null),0),
    'clicked',coalesce((select count(*) from public.restaurant_marketing_deliveries d join ids on ids.restaurant_id=d.restaurant_id where d.created_at>=v_from and d.clicked_at is not null),0),
    'revenue_pence',coalesce((select sum(c.revenue_pence) from public.restaurant_marketing_conversions c join ids on ids.restaurant_id=c.restaurant_id where c.attributed_at>=v_from),0)),
  'locations_online',coalesce((select count(*) from loc where accepting_orders and status in('approved','active')),0),
  'locations_total',coalesce((select count(*) from loc),0),
  'store_health',coalesce((select jsonb_build_object('healthy',count(*) filter(where accepting_orders and status in('approved','active') and available_items>0),'attention',count(*) filter(where not accepting_orders or status not in('approved','active') or available_items=0),'score',case when count(*)=0 then 100 else round(100.0*count(*) filter(where accepting_orders and status in('approved','active') and available_items>0)/count(*),1) end) from loc),jsonb_build_object('healthy',0,'attention',0,'score',100)),
  'locations',coalesce((select jsonb_agg(jsonb_build_object('restaurant_id',restaurant_id,'name',name,'status',status,'accepting_orders',accepting_orders,'available_items',available_items,'last_order_at',last_order_at) order by name) from loc),'[]'::jsonb)
 ) into v_result; return v_result;
end $$;
create or replace function public.get_restaurant_group_crm(p_group_id uuid,p_scope_type text default 'group',p_scope_id uuid default null,p_search text default null,p_page integer default 1,p_page_size integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_page integer:=greatest(coalesce(p_page,1),1); v_size integer:=least(greatest(coalesce(p_page_size,50),1),100); v_result jsonb;
begin
 if not private.restaurant_group_scope_allowed(p_group_id,'crm:view',p_scope_type,p_scope_id) then raise exception 'CRM permission required' using errcode='42501'; end if;
 with ids as (select restaurant_id from private.restaurant_group_scope_restaurants(p_group_id,p_scope_type,p_scope_id)),
 base as (select o.*,coalesce(o.customer_user_id::text,lower(o.customer_email)) customer_key from public.orders o join ids on ids.restaurant_id=o.restaurant_id where o.payment_status in('paid','succeeded')),
 agg as (select customer_key,max(customer_user_id::text)::uuid customer_user_id,max(customer_first_name) first_name,max(customer_last_name) last_name,max(customer_email) email,max(customer_phone) phone,
   count(*) orders,sum(total_pence) lifetime_value_pence,count(distinct restaurant_id) locations_visited,max(created_at) last_visit_at,min(created_at) first_visit_at,
   (array_agg(restaurant_id order by location_count desc))[1] favourite_location_id
  from (select b.*,count(*) over(partition by customer_key,restaurant_id) location_count from base b) q group by customer_key),
 filtered as (select a.*,r.name favourite_location_name from agg a left join public.restaurants r on r.id=a.favourite_location_id where nullif(btrim(coalesce(p_search,'')),'') is null or concat_ws(' ',a.first_name,a.last_name,a.email,a.phone) ilike '%'||btrim(p_search)||'%'),
 paged as (select * from filtered order by lifetime_value_pence desc,last_visit_at desc offset (v_page-1)*v_size limit v_size)
 select jsonb_build_object('page',v_page,'page_size',v_size,'total',coalesce((select count(*) from filtered),0),'customers',coalesce((select jsonb_agg(jsonb_build_object('customer_key',customer_key,'customer_user_id',customer_user_id,'name',btrim(concat_ws(' ',first_name,last_name)),'email',email,'phone',phone,'lifetime_value_pence',lifetime_value_pence,'visit_frequency',orders,'locations_visited',locations_visited,'cross_location_customer',locations_visited>1,'favourite_location_id',favourite_location_id,'favourite_location_name',favourite_location_name,'first_visit_at',first_visit_at,'last_visit_at',last_visit_at) order by lifetime_value_pence desc,last_visit_at desc) from paged),'[]'::jsonb)) into v_result;
 return v_result;
end $$;
create or replace function public.get_restaurant_group_customer_profile(p_group_id uuid,p_customer_key text,p_scope_type text default 'group',p_scope_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
 if not private.restaurant_group_scope_allowed(p_group_id,'crm:view',p_scope_type,p_scope_id) then raise exception 'CRM permission required' using errcode='42501'; end if;
 with ids as (select restaurant_id from private.restaurant_group_scope_restaurants(p_group_id,p_scope_type,p_scope_id)), base as (select o.*,coalesce(o.customer_user_id::text,lower(o.customer_email)) customer_key from public.orders o join ids on ids.restaurant_id=o.restaurant_id where o.payment_status in('paid','succeeded') and coalesce(o.customer_user_id::text,lower(o.customer_email))=p_customer_key), by_location as (select restaurant_id,count(*) visits,sum(total_pence) spend_pence,max(created_at) last_visit_at from base group by restaurant_id)
 select jsonb_build_object('customer_key',p_customer_key,'name',(select btrim(concat_ws(' ',customer_first_name,customer_last_name)) from base order by created_at desc limit 1),'email',(select customer_email from base order by created_at desc limit 1),'phone',(select customer_phone from base order by created_at desc limit 1),'lifetime_value_pence',coalesce((select sum(total_pence) from base),0),'visits',coalesce((select count(*) from base),0),'first_visit_at',(select min(created_at) from base),'last_visit_at',(select max(created_at) from base),'locations',coalesce((select jsonb_agg(jsonb_build_object('restaurant_id',b.restaurant_id,'restaurant_name',r.name,'visits',b.visits,'spend_pence',b.spend_pence,'last_visit_at',b.last_visit_at) order by b.spend_pence desc) from by_location b join public.restaurants r on r.id=b.restaurant_id),'[]'::jsonb),'orders',coalesce((select jsonb_agg(jsonb_build_object('id',id,'restaurant_id',restaurant_id,'order_number',order_number,'total_pence',total_pence,'created_at',created_at,'order_status',order_status) order by created_at desc) from (select * from base order by created_at desc limit 100)x),'[]'::jsonb)) into v_result;
 return v_result;
end $$;
create or replace function public.get_restaurant_group_reporting(p_group_id uuid,p_scope_type text default 'group',p_scope_id uuid default null,p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_from timestamptz:=now()-make_interval(days=>greatest(1,least(coalesce(p_days,30),366))); v_result jsonb;
begin
 if not private.restaurant_group_scope_allowed(p_group_id,'analytics:view',p_scope_type,p_scope_id) and not private.platform_admin_has_permission('restaurants:view') then raise exception 'Analytics permission required' using errcode='42501'; end if;
 with ids as (select restaurant_id from private.restaurant_group_scope_restaurants(p_group_id,p_scope_type,p_scope_id)), rows as (
 select l.restaurant_id,r.name,b.name brand_name,rg.name region_name,
  coalesce((select sum(o.total_pence) from public.orders o where o.restaurant_id=l.restaurant_id and o.created_at>=v_from and o.payment_status in('paid','succeeded')),0) revenue_pence,
  coalesce((select count(*) from public.orders o where o.restaurant_id=l.restaurant_id and o.created_at>=v_from and o.payment_status in('paid','succeeded')),0) orders,
  coalesce((select count(distinct coalesce(o.customer_user_id::text,lower(o.customer_email))) from public.orders o where o.restaurant_id=l.restaurant_id and o.created_at>=v_from and o.payment_status in('paid','succeeded')),0) customers,
  coalesce((select count(distinct a.customer_user_id) from public.customer_loyalty_accounts a where a.restaurant_id=l.restaurant_id),0) loyalty_members,
  coalesce((select count(*) from public.customer_vip_memberships v where v.restaurant_id=l.restaurant_id and v.current_tier_id is not null),0) vip_members,
  coalesce((select count(*) from public.restaurant_marketing_conversions c where c.restaurant_id=l.restaurant_id and c.attributed_at>=v_from),0) campaign_conversions,
  coalesce((select sum(c.revenue_pence) from public.restaurant_marketing_conversions c where c.restaurant_id=l.restaurant_id and c.attributed_at>=v_from),0) campaign_revenue_pence,
  coalesce((select count(*) from public.customer_challenge_progress cp where cp.restaurant_id=l.restaurant_id and cp.completed_at>=v_from),0) challenges_completed,
  coalesce((select count(*) from public.customer_referrals rf where rf.restaurant_id=l.restaurant_id and rf.created_at>=v_from),0) referrals,
  coalesce((select count(*) from public.customer_reward_issuances ri where ri.restaurant_id=l.restaurant_id and ri.created_at>=v_from and ri.source_type in('birthday','milestone')),0) birthday_milestone_rewards,
  coalesce((select count(*) from public.restaurant_ai_insights ai where ai.restaurant_id=l.restaurant_id and ai.generated_at>=v_from),0) ai_insights,
  coalesce((select avg(f.predicted_value) from public.restaurant_ai_forecasts f where f.restaurant_id=l.restaurant_id and f.generated_at>=v_from and f.metric='revenue'),0) revenue_forecast
 from public.restaurant_group_locations l join ids on ids.restaurant_id=l.restaurant_id join public.restaurants r on r.id=l.restaurant_id left join public.restaurant_group_brands b on b.id=l.brand_id left join public.restaurant_group_regions rg on rg.id=l.region_id)
 select jsonb_build_object('period_from',v_from,'period_to',now(),'scope_type',p_scope_type,'scope_id',p_scope_id,'locations',coalesce(jsonb_agg(to_jsonb(rows) order by revenue_pence desc),'[]'::jsonb),'growth',jsonb_build_object('current_revenue_pence',coalesce(sum(revenue_pence),0),'current_orders',coalesce(sum(orders),0),'locations',count(*))) into v_result from rows; return v_result;
end $$;
create or replace function public.get_restaurant_group_financial_reporting(p_group_id uuid,p_scope_type text default 'group',p_scope_id uuid default null,p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_from timestamptz:=now()-make_interval(days=>greatest(1,least(coalesce(p_days,30),366))); v_result jsonb;
begin
 if not private.restaurant_group_scope_allowed(p_group_id,'finance:view',p_scope_type,p_scope_id) and not private.platform_admin_has_permission('finance:view') then raise exception 'Finance permission required' using errcode='42501'; end if;
 with ids as (select restaurant_id from private.restaurant_group_scope_restaurants(p_group_id,p_scope_type,p_scope_id)), paid as(select o.* from public.orders o join ids on ids.restaurant_id=o.restaurant_id where o.created_at>=v_from and o.payment_status in('paid','succeeded'))
 select jsonb_build_object('period_from',v_from,'period_to',now(),'revenue_pence',coalesce((select sum(total_pence) from paid),0),'commission_pence',coalesce((select sum(platform_commission_pence+platform_commission_vat_pence) from paid),0),'subscription_revenue_pence',coalesce((select sum(i.amount_paid_pence) from public.restaurant_subscription_invoices i join ids on ids.restaurant_id=i.restaurant_id where i.paid_at>=v_from),0),'marketing_spend_pence',coalesce((select sum(c.reward_cost_pence) from public.restaurant_marketing_conversions c join ids on ids.restaurant_id=c.restaurant_id where c.attributed_at>=v_from),0),'reward_costs_pence',coalesce((select sum(c.reward_cost_pence) from public.restaurant_marketing_conversions c join ids on ids.restaurant_id=c.restaurant_id where c.attributed_at>=v_from),0),'average_spend_pence',coalesce((select round(avg(total_pence))::bigint from paid),0),'refunds_pence',coalesce((select sum(i.refunded_pence) from public.restaurant_subscription_invoices i join ids on ids.restaurant_id=i.restaurant_id where i.updated_at>=v_from),0)+coalesce((select sum(w.refunded_pence) from public.restaurant_weekly_invoices w join ids on ids.restaurant_id=w.restaurant_id where w.updated_at>=v_from),0),'restaurant_net_pence',coalesce((select sum(restaurant_net_pence) from paid),0),'profit_proxy_pence',coalesce((select sum(platform_commission_pence+platform_commission_vat_pence+service_fee_pence) from paid),0)+coalesce((select sum(i.amount_paid_pence) from public.restaurant_subscription_invoices i join ids on ids.restaurant_id=i.restaurant_id where i.paid_at>=v_from),0)) into v_result;
 return v_result;
end $$;

create table public.restaurant_group_notifications (
 id uuid primary key default gen_random_uuid(),group_id uuid not null references public.restaurant_groups(id) on delete cascade,
 restaurant_id uuid references public.restaurants(id) on delete cascade,notification_type text not null,title text not null,body text not null,action_url text,priority text not null default 'normal' check(priority in('low','normal','high','critical')),
 audience_roles text[] not null default array[]::text[],audience_scope_type text not null default 'group' check(audience_scope_type in('group','brand','region','restaurant')),audience_scope_id uuid,
 metadata jsonb not null default '{}'::jsonb,dedupe_key text,created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),unique(group_id,dedupe_key)
);
create table public.restaurant_group_notification_deliveries (
 id bigint generated always as identity primary key,notification_id uuid not null references public.restaurant_group_notifications(id) on delete cascade,group_id uuid not null references public.restaurant_groups(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,channel text not null default 'in_app' check(channel in('in_app','email')),status text not null default 'pending' check(status in('pending','sent','failed','read')),read_at timestamptz,provider_message_id text,last_error text,attempts integer not null default 0,sent_at timestamptz,created_at timestamptz not null default now(),unique(notification_id,user_id,channel)
);
create index group_notifications_time_idx on public.restaurant_group_notifications(group_id,created_at desc);
create index group_notification_deliveries_user_idx on public.restaurant_group_notification_deliveries(user_id,status,created_at desc);
create index group_notification_deliveries_pending_idx on public.restaurant_group_notification_deliveries(status,created_at) where status='pending';
create or replace function private.restaurant_group_notification_recipients(p_notification_id uuid) returns table(user_id uuid) language sql stable security definer set search_path='' as $$
 select distinct m.user_id from public.restaurant_group_notifications n join public.restaurant_group_members m on m.group_id=n.group_id and m.status='active' join public.restaurant_group_roles r on r.id=m.role_id
 where n.id=p_notification_id and (cardinality(n.audience_roles)=0 or r.key=any(n.audience_roles)) and (
  n.audience_scope_type='group' or(n.audience_scope_type='brand' and m.scope_type in('group','brand') and(m.scope_type='group' or m.brand_id=n.audience_scope_id)) or
  (n.audience_scope_type='region' and(m.scope_type='group' or(m.scope_type='region' and private.restaurant_group_region_contains(m.region_id,n.audience_scope_id)))) or
  (n.audience_scope_type='restaurant' and(m.scope_type='group' or m.restaurant_id=n.audience_scope_id or(m.scope_type='region' and exists(select 1 from public.restaurant_group_locations l where l.restaurant_id=n.audience_scope_id and private.restaurant_group_region_contains(m.region_id,l.region_id))) or(m.scope_type='brand' and exists(select 1 from public.restaurant_group_locations l where l.restaurant_id=n.audience_scope_id and l.brand_id=m.brand_id)))) )
$$;
create or replace function public.create_restaurant_group_notification(p_group_id uuid,p_title text,p_body text,p_notification_type text,p_audience_roles text[] default array[]::text[],p_scope_type text default 'group',p_scope_id uuid default null,p_action_url text default null,p_priority text default 'normal',p_metadata jsonb default '{}'::jsonb,p_dedupe_key text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; u record;
begin
 if not private.restaurant_group_member_permission(p_group_id,'notifications:manage') then raise exception 'Notification management permission required' using errcode='42501'; end if;
 insert into public.restaurant_group_notifications(group_id,notification_type,title,body,action_url,priority,audience_roles,audience_scope_type,audience_scope_id,metadata,dedupe_key,created_by) values(p_group_id,p_notification_type,btrim(p_title),btrim(p_body),p_action_url,p_priority,coalesce(p_audience_roles,array[]::text[]),p_scope_type,p_scope_id,coalesce(p_metadata,'{}'::jsonb),p_dedupe_key,auth.uid()) on conflict(group_id,dedupe_key) do update set title=excluded.title returning id into v_id;
 for u in select * from private.restaurant_group_notification_recipients(v_id) loop insert into public.restaurant_group_notification_deliveries(notification_id,group_id,user_id,channel) values(v_id,p_group_id,u.user_id,'in_app') on conflict do nothing; if (select central_notifications_enabled from public.restaurant_group_enterprise_settings where group_id=p_group_id) then insert into public.restaurant_group_notification_deliveries(notification_id,group_id,user_id,channel) values(v_id,p_group_id,u.user_id,'email') on conflict do nothing; end if; end loop;
 perform private.restaurant_group_log(p_group_id,'notification.created','group_notification',v_id,null,jsonb_build_object('scope_type',p_scope_type,'scope_id',p_scope_id,'roles',p_audience_roles)); return v_id;
end $$;
create or replace function public.get_my_restaurant_group_notifications(p_limit integer default 50) returns jsonb language plpgsql security definer set search_path='' as $$
begin if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if; return coalesce((select jsonb_agg(jsonb_build_object('delivery_id',d.id,'notification_id',n.id,'group_id',n.group_id,'group_name',g.name,'type',n.notification_type,'title',n.title,'body',n.body,'action_url',n.action_url,'priority',n.priority,'metadata',n.metadata,'read_at',d.read_at,'created_at',n.created_at) order by n.created_at desc) from (select * from public.restaurant_group_notification_deliveries where user_id=auth.uid() and channel='in_app' order by created_at desc limit least(greatest(coalesce(p_limit,50),1),100)) d join public.restaurant_group_notifications n on n.id=d.notification_id join public.restaurant_groups g on g.id=n.group_id),'[]'::jsonb); end $$;
create or replace function public.mark_restaurant_group_notification_read(p_delivery_id bigint) returns void language sql security definer set search_path='' as $$ update public.restaurant_group_notification_deliveries set status='read',read_at=coalesce(read_at,now()) where id=p_delivery_id and user_id=auth.uid() and channel='in_app' $$;

create or replace function public.get_platform_restaurant_groups(p_search text default null,p_page integer default 1,p_page_size integer default 50) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_page integer:=greatest(coalesce(p_page,1),1); v_size integer:=least(greatest(coalesce(p_page_size,50),1),100); v_result jsonb;
begin if not private.platform_admin_has_permission('restaurants:view') then raise exception 'Platform restaurant view permission required' using errcode='42501'; end if;
 with filtered as(select g.* from public.restaurant_groups g where nullif(btrim(coalesce(p_search,'')),'') is null or g.name ilike '%'||btrim(p_search)||'%' or g.slug ilike '%'||btrim(p_search)||'%'), paged as(select * from filtered order by created_at desc offset(v_page-1)*v_size limit v_size)
 select jsonb_build_object('page',v_page,'page_size',v_size,'total',(select count(*) from filtered),'groups',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('locations',(select count(*) from public.restaurant_group_locations l where l.group_id=p.id and l.status<>'merged'),'brands',(select count(*) from public.restaurant_group_brands b where b.group_id=p.id and b.status='active'),'members',(select count(*) from public.restaurant_group_members m where m.group_id=p.id and m.status='active')) order by p.created_at desc) from paged p),'[]'::jsonb)) into v_result; return v_result; end $$;
create or replace function public.get_platform_restaurant_group(p_group_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin if not private.platform_admin_has_permission('restaurants:view') then raise exception 'Platform restaurant view permission required' using errcode='42501'; end if; return jsonb_build_object('group',(select to_jsonb(g) from public.restaurant_groups g where g.id=p_group_id),'sharing',(select to_jsonb(s) from public.restaurant_group_sharing_settings s where s.group_id=p_group_id),'enterprise',(select to_jsonb(e) from public.restaurant_group_enterprise_settings e where e.group_id=p_group_id),'brands',coalesce((select jsonb_agg(to_jsonb(b) order by b.name) from public.restaurant_group_brands b where b.group_id=p_group_id),'[]'::jsonb),'regions',coalesce((select jsonb_agg(to_jsonb(r) order by r.name) from public.restaurant_group_regions r where r.group_id=p_group_id),'[]'::jsonb),'locations',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('name',r.name,'slug',r.slug,'accepting_orders',r.accepting_orders) order by r.name) from public.restaurant_group_locations l join public.restaurants r on r.id=l.restaurant_id where l.group_id=p_group_id),'[]'::jsonb),'members',coalesce((select jsonb_agg(to_jsonb(m)||jsonb_build_object('role_key',ro.key,'role_name',ro.name) order by m.created_at) from public.restaurant_group_members m join public.restaurant_group_roles ro on ro.id=m.role_id where m.group_id=p_group_id),'[]'::jsonb),'audit',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from(select * from public.restaurant_group_audit_log where group_id=p_group_id order by created_at desc limit 100)a),'[]'::jsonb)); end $$;

alter table public.restaurant_group_notifications enable row level security; alter table public.restaurant_group_notification_deliveries enable row level security;
create policy group_notifications_read on public.restaurant_group_notifications for select to authenticated using(private.restaurant_group_member_permission(group_id,'notifications:view') or private.platform_admin_has_permission('restaurants:view'));
create policy group_notification_deliveries_read on public.restaurant_group_notification_deliveries for select to authenticated using(user_id=auth.uid() or private.restaurant_group_member_permission(group_id,'notifications:manage') or private.platform_admin_has_permission('restaurants:view'));
grant select on public.restaurant_group_notifications,public.restaurant_group_notification_deliveries to authenticated;
revoke all on function public.get_restaurant_group_dashboard(uuid,text,uuid,integer),public.get_restaurant_group_crm(uuid,text,uuid,text,integer,integer),public.get_restaurant_group_customer_profile(uuid,text,text,uuid),public.get_restaurant_group_reporting(uuid,text,uuid,integer),public.get_restaurant_group_financial_reporting(uuid,text,uuid,integer),public.create_restaurant_group_notification(uuid,text,text,text,text[],text,uuid,text,text,jsonb,text),public.get_platform_restaurant_groups(text,integer,integer),public.get_platform_restaurant_group(uuid) from public;
grant execute on function public.get_restaurant_group_dashboard(uuid,text,uuid,integer),public.get_restaurant_group_crm(uuid,text,uuid,text,integer,integer),public.get_restaurant_group_customer_profile(uuid,text,text,uuid),public.get_restaurant_group_reporting(uuid,text,uuid,integer),public.get_restaurant_group_financial_reporting(uuid,text,uuid,integer),public.create_restaurant_group_notification(uuid,text,text,text,text[],text,uuid,text,text,jsonb,text),public.get_my_restaurant_group_notifications(integer),public.mark_restaurant_group_notification_read(bigint),public.get_platform_restaurant_groups(text,integer,integer),public.get_platform_restaurant_group(uuid) to authenticated;
