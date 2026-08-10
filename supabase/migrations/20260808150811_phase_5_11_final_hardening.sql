create extension if not exists pg_net with schema extensions;

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
      (coalesce((m.permissions->>p_permission)::boolean,false) or coalesce((r.permissions->>p_permission)::boolean,false))
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

create or replace function private.restaurant_group_validate_region()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.brand_id is not null and not exists(select 1 from public.restaurant_group_brands b where b.id=new.brand_id and b.group_id=new.group_id) then raise exception 'Brand does not belong to organisation'; end if;
  if new.parent_region_id is not null then
    if not exists(select 1 from public.restaurant_group_regions r where r.id=new.parent_region_id and r.group_id=new.group_id) then raise exception 'Parent region does not belong to organisation'; end if;
    if new.id is not null and private.restaurant_group_region_contains(new.id,new.parent_region_id) then raise exception 'Region hierarchy cannot contain a cycle'; end if;
  end if;
  return new;
end $$;

create or replace function private.restaurant_group_department_contains(p_ancestor uuid,p_descendant uuid)
returns boolean language sql stable security definer set search_path='' as $$
  with recursive lineage as (
    select d.id,d.parent_department_id from public.restaurant_group_departments d where d.id=p_descendant
    union all
    select parent.id,parent.parent_department_id from public.restaurant_group_departments parent join lineage child on child.parent_department_id=parent.id
  )
  select exists(select 1 from lineage where id=p_ancestor)
$$;

create or replace function private.restaurant_group_validate_department()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.restaurant_id is not null and not exists(select 1 from public.restaurant_group_locations l where l.restaurant_id=new.restaurant_id and l.group_id=new.group_id) then raise exception 'Restaurant does not belong to organisation'; end if;
  if new.parent_department_id is not null then
    if not exists(select 1 from public.restaurant_group_departments d where d.id=new.parent_department_id and d.group_id=new.group_id) then raise exception 'Parent department does not belong to organisation'; end if;
    if new.id is not null and private.restaurant_group_department_contains(new.id,new.parent_department_id) then raise exception 'Department hierarchy cannot contain a cycle'; end if;
  end if;
  return new;
end $$;
drop trigger if exists restaurant_group_departments_validate on public.restaurant_group_departments;
create trigger restaurant_group_departments_validate before insert or update on public.restaurant_group_departments for each row execute function private.restaurant_group_validate_department();

create or replace function private.restaurant_group_feature_restaurants(p_restaurant_id uuid,p_feature text)
returns table(restaurant_id uuid) language plpgsql stable security definer set search_path='' as $$
declare l public.restaurant_group_locations%rowtype; v_scope text;
begin
 select * into l from public.restaurant_group_locations where restaurant_id=p_restaurant_id and status='active';
 if not found then return query select p_restaurant_id; return; end if;
 if not exists(select 1 from public.restaurant_groups g where g.id=l.group_id and g.status='active') then return query select p_restaurant_id; return; end if;
 v_scope:=coalesce(private.restaurant_group_feature_scope(l.group_id,p_feature),'restaurant');
 if v_scope='group' then return query select x.restaurant_id from public.restaurant_group_locations x where x.group_id=l.group_id and x.status='active';
 elsif v_scope='brand' and l.brand_id is not null then return query select x.restaurant_id from public.restaurant_group_locations x where x.group_id=l.group_id and x.brand_id=l.brand_id and x.status='active';
 elsif v_scope='region' and l.region_id is not null then
   return query select x.restaurant_id from public.restaurant_group_locations x where x.group_id=l.group_id and x.status='active' and x.region_id is not null and private.restaurant_group_region_contains(l.region_id,x.region_id);
 else return query select p_restaurant_id; end if;
end $$;

create or replace function private.restaurant_group_template_targets(p_template_id uuid)
returns table(restaurant_id uuid) language plpgsql stable security definer set search_path='' as $$
declare t public.restaurant_group_menu_templates%rowtype;
begin
 select * into t from public.restaurant_group_menu_templates where id=p_template_id;
 if not found or not exists(select 1 from public.restaurant_groups g where g.id=t.group_id and g.status='active') then return; end if;
 if t.scope_type='group' then return query select l.restaurant_id from public.restaurant_group_locations l where l.group_id=t.group_id and l.status='active';
 elsif t.scope_type='brand' then return query select l.restaurant_id from public.restaurant_group_locations l where l.group_id=t.group_id and l.brand_id=t.brand_id and l.status='active';
 else return query select l.restaurant_id from public.restaurant_group_locations l where l.group_id=t.group_id and l.status='active' and l.region_id is not null and private.restaurant_group_region_contains(t.region_id,l.region_id); end if;
end $$;

create or replace function private.restaurant_group_campaign_restaurants(p_group_id uuid,p_campaign_id uuid)
returns table(restaurant_id uuid) language sql stable security definer set search_path='' as $$
 select distinct l.restaurant_id
 from public.restaurant_group_locations l
 join public.restaurant_group_campaign_targets t on t.group_id=l.group_id and t.campaign_id=p_campaign_id
 join public.restaurant_groups g on g.id=l.group_id and g.status='active'
 where l.group_id=p_group_id and l.status='active' and (
   t.target_type='group'
   or (t.target_type='brand' and l.brand_id=t.brand_id)
   or (t.target_type='region' and l.region_id is not null and private.restaurant_group_region_contains(t.region_id,l.region_id))
   or (t.target_type='restaurant' and l.restaurant_id=t.restaurant_id)
 )
$$;

create or replace function private.restaurant_group_template_permission(p_template_id uuid,p_permission text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare t public.restaurant_group_menu_templates%rowtype;
begin
 select * into t from public.restaurant_group_menu_templates where id=p_template_id;
 if not found then return false; end if;
 if t.scope_type='brand' then return private.restaurant_group_member_permission(t.group_id,p_permission,null,t.brand_id,null); end if;
 if t.scope_type='region' then return private.restaurant_group_member_permission(t.group_id,p_permission,null,null,t.region_id); end if;
 return private.restaurant_group_member_permission(t.group_id,p_permission);
end $$;

create or replace function public.save_restaurant_group_menu_category(p_template_id uuid,p_category_id uuid,p_name text,p_description text default null,p_sort_order integer default 0,p_is_active boolean default true)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if not private.restaurant_group_template_permission(p_template_id,'menu:manage') then raise exception 'Menu management permission required for this template scope' using errcode='42501'; end if;
 if p_category_id is null then insert into public.restaurant_group_menu_categories(template_id,name,description,sort_order,is_active) values(p_template_id,btrim(p_name),nullif(btrim(p_description),''),p_sort_order,p_is_active) returning id into v_id;
 else update public.restaurant_group_menu_categories set name=btrim(p_name),description=nullif(btrim(p_description),''),sort_order=p_sort_order,is_active=p_is_active,updated_at=now() where id=p_category_id and template_id=p_template_id returning id into v_id; end if;
 if v_id is null then raise exception 'Menu category not found'; end if; return v_id;
end $$;

create or replace function public.save_restaurant_group_menu_item(p_template_id uuid,p_item_id uuid,p_category_id uuid,p_name text,p_description text,p_base_price_pence integer,p_image_url text default null,p_is_available boolean default true,p_is_vegetarian boolean default false,p_is_vegan boolean default false,p_sort_order integer default 0)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if not private.restaurant_group_template_permission(p_template_id,'menu:manage') then raise exception 'Menu management permission required for this template scope' using errcode='42501'; end if;
 if not exists(select 1 from public.restaurant_group_menu_categories where id=p_category_id and template_id=p_template_id) then raise exception 'Category is outside this template'; end if;
 if p_item_id is null then insert into public.restaurant_group_menu_items(template_id,category_id,name,description,base_price_pence,image_url,is_available,is_vegetarian,is_vegan,sort_order) values(p_template_id,p_category_id,btrim(p_name),nullif(btrim(p_description),''),p_base_price_pence,nullif(btrim(p_image_url),''),p_is_available,p_is_vegetarian,p_is_vegan,p_sort_order) returning id into v_id;
 else update public.restaurant_group_menu_items set category_id=p_category_id,name=btrim(p_name),description=nullif(btrim(p_description),''),base_price_pence=p_base_price_pence,image_url=nullif(btrim(p_image_url),''),is_available=p_is_available,is_vegetarian=p_is_vegetarian,is_vegan=p_is_vegan,sort_order=p_sort_order,updated_at=now() where id=p_item_id and template_id=p_template_id returning id into v_id; end if;
 if v_id is null then raise exception 'Menu item not found'; end if; return v_id;
end $$;

create or replace function public.publish_restaurant_group_menu(p_template_id uuid,p_restaurant_ids uuid[] default null)
returns integer language plpgsql security definer set search_path='' as $$
declare v_group uuid; v_count integer;
begin
 select group_id into v_group from public.restaurant_group_menu_templates where id=p_template_id;
 if v_group is null then raise exception 'Menu template not found'; end if;
 if not private.restaurant_group_template_permission(p_template_id,'menu:manage') then raise exception 'Menu management permission required for this template scope' using errcode='42501'; end if;
 if p_restaurant_ids is not null and exists(select 1 from unnest(p_restaurant_ids)x where not exists(select 1 from private.restaurant_group_template_targets(p_template_id)t where t.restaurant_id=x)) then raise exception 'One or more restaurants are outside the template scope'; end if;
 v_count:=private.publish_restaurant_group_menu_template(p_template_id,auth.uid(),p_restaurant_ids);
 perform private.restaurant_group_log(v_group,'menu.published','menu_template',p_template_id,null,jsonb_build_object('restaurant_ids',p_restaurant_ids,'items_last_location',v_count)); return v_count;
end $$;

create or replace function public.save_restaurant_group_campaign_target(p_group_id uuid,p_campaign_id uuid,p_target_id uuid,p_target_type text,p_scope_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;v_source uuid;v_allowed boolean:=false;
begin
 select restaurant_id into v_source from public.restaurant_marketing_campaigns where id=p_campaign_id;
 if not exists(select 1 from public.restaurant_group_locations where group_id=p_group_id and restaurant_id=v_source) then raise exception 'Campaign source is outside this organisation'; end if;
 if p_target_type='group' then v_allowed:=private.restaurant_group_member_permission(p_group_id,'marketing:manage');
 elsif p_target_type='brand' then
   if not exists(select 1 from public.restaurant_group_brands where id=p_scope_id and group_id=p_group_id) then raise exception 'Brand is outside this organisation'; end if;
   v_allowed:=private.restaurant_group_member_permission(p_group_id,'marketing:manage',null,p_scope_id,null);
 elsif p_target_type='region' then
   if not exists(select 1 from public.restaurant_group_regions where id=p_scope_id and group_id=p_group_id) then raise exception 'Region is outside this organisation'; end if;
   v_allowed:=private.restaurant_group_member_permission(p_group_id,'marketing:manage',null,null,p_scope_id);
 elsif p_target_type='restaurant' then
   if not exists(select 1 from public.restaurant_group_locations where group_id=p_group_id and restaurant_id=p_scope_id) then raise exception 'Restaurant is outside this organisation'; end if;
   v_allowed:=private.restaurant_group_member_permission(p_group_id,'marketing:manage',p_scope_id,null,null);
 else raise exception 'Unsupported campaign target type'; end if;
 if not v_allowed then raise exception 'Marketing management permission required for this target scope' using errcode='42501'; end if;
 if p_target_id is null then insert into public.restaurant_group_campaign_targets(group_id,campaign_id,target_type,brand_id,region_id,restaurant_id,created_by) values(p_group_id,p_campaign_id,p_target_type,case when p_target_type='brand' then p_scope_id end,case when p_target_type='region' then p_scope_id end,case when p_target_type='restaurant' then p_scope_id end,auth.uid()) returning id into v_id;
 else update public.restaurant_group_campaign_targets set target_type=p_target_type,brand_id=case when p_target_type='brand' then p_scope_id end,region_id=case when p_target_type='region' then p_scope_id end,restaurant_id=case when p_target_type='restaurant' then p_scope_id end where id=p_target_id and group_id=p_group_id and campaign_id=p_campaign_id returning id into v_id; end if;
 if v_id is null then raise exception 'Campaign target not found'; end if; return v_id;
end $$;

create or replace function public.publish_restaurant_group_campaign(p_campaign_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare c public.restaurant_marketing_campaigns%rowtype; v_group uuid; target record; v_count integer:=0;
begin
 select * into c from public.restaurant_marketing_campaigns where id=p_campaign_id; if not found then raise exception 'Campaign not found'; end if;
 select group_id into v_group from public.restaurant_group_locations where restaurant_id=c.restaurant_id; if v_group is null then raise exception 'Campaign source restaurant is not in an organisation'; end if;
 if exists(select 1 from public.restaurant_group_campaign_targets t where t.campaign_id=p_campaign_id and t.group_id=v_group and (
   (t.target_type='group' and not private.restaurant_group_member_permission(v_group,'marketing:manage'))
   or (t.target_type='brand' and not private.restaurant_group_member_permission(v_group,'marketing:manage',null,t.brand_id,null))
   or (t.target_type='region' and not private.restaurant_group_member_permission(v_group,'marketing:manage',null,null,t.region_id))
   or (t.target_type='restaurant' and not private.restaurant_group_member_permission(v_group,'marketing:manage',t.restaurant_id,null,null))
 )) then raise exception 'Marketing management permission required for every target scope' using errcode='42501'; end if;
 for target in select * from private.restaurant_group_campaign_restaurants(v_group,p_campaign_id) loop
  if target.restaurant_id=c.restaurant_id then continue; end if;
  insert into public.restaurant_marketing_campaigns(restaurant_id,name,campaign_type,status,channels,segment_key,subject,preview_text,html_content,text_content,cta_label,cta_url,image_url,branding,timezone,scheduled_at,next_run_at,recurrence_unit,recurrence_interval,starts_at,ends_at,created_by,source_group_campaign_id)
  values(target.restaurant_id,c.name,c.campaign_type,c.status,c.channels,c.segment_key,c.subject,c.preview_text,c.html_content,c.text_content,c.cta_label,c.cta_url,c.image_url,c.branding,c.timezone,c.scheduled_at,c.next_run_at,c.recurrence_unit,c.recurrence_interval,c.starts_at,c.ends_at,auth.uid(),p_campaign_id)
  on conflict(restaurant_id,source_group_campaign_id) where source_group_campaign_id is not null do update set name=excluded.name,campaign_type=excluded.campaign_type,status=excluded.status,channels=excluded.channels,segment_key=excluded.segment_key,subject=excluded.subject,preview_text=excluded.preview_text,html_content=excluded.html_content,text_content=excluded.text_content,cta_label=excluded.cta_label,cta_url=excluded.cta_url,image_url=excluded.image_url,branding=excluded.branding,timezone=excluded.timezone,scheduled_at=excluded.scheduled_at,next_run_at=excluded.next_run_at,recurrence_unit=excluded.recurrence_unit,recurrence_interval=excluded.recurrence_interval,starts_at=excluded.starts_at,ends_at=excluded.ends_at,updated_at=now();
  v_count:=v_count+1;
 end loop;
 perform private.restaurant_group_log(v_group,'campaign.published','marketing_campaign',p_campaign_id,null,jsonb_build_object('target_locations',v_count)); return v_count;
end $$;

create or replace function public.redeem_loyalty_reward(p_reward_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); r public.restaurant_loyalty_rewards%rowtype; v public.customer_reward_vouchers%rowtype; a record; points integer:=0; remaining integer; take_points integer; c integer; v_code text;
begin
 if uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into r from public.restaurant_loyalty_rewards where id=p_reward_id and is_active and starts_at<=now() and (ends_at is null or ends_at>now()) for update;
 if not found then raise exception 'Reward is not currently available'; end if;
 if r.total_redemption_limit is not null and r.redemption_count>=r.total_redemption_limit then raise exception 'Reward redemption limit has been reached'; end if;
 if r.stock_remaining is not null and r.stock_remaining<=0 then raise exception 'Reward is out of stock'; end if;
 select coalesce(sum(x.points_balance),0) into points from public.customer_loyalty_accounts x where x.customer_user_id=uid and x.restaurant_id in(select s.restaurant_id from private.restaurant_group_feature_restaurants(r.restaurant_id,'loyalty') s);
 if points<r.points_cost then raise exception 'You do not have enough points'; end if;
 if r.per_customer_limit is not null then select count(*) into c from public.customer_reward_vouchers where reward_id=r.id and customer_user_id=uid and status<>'cancelled'; if c>=r.per_customer_limit then raise exception 'You have reached the redemption limit for this reward'; end if; end if;
 remaining:=r.points_cost;
 for a in select x.* from public.customer_loyalty_accounts x where x.customer_user_id=uid and x.restaurant_id in(select s.restaurant_id from private.restaurant_group_feature_restaurants(r.restaurant_id,'loyalty') s) and x.points_balance>0 order by (x.restaurant_id=r.restaurant_id) desc,x.updated_at for update loop
  exit when remaining<=0; take_points:=least(remaining,a.points_balance); update public.customer_loyalty_accounts set points_balance=points_balance-take_points,lifetime_points_redeemed=lifetime_points_redeemed+take_points,last_redeemed_at=now(),updated_at=now() where id=a.id;
  insert into public.customer_loyalty_ledger(loyalty_account_id,restaurant_id,customer_user_id,points_delta,entry_type,note) values(a.id,a.restaurant_id,uid,-take_points,'reward_redeemed','Shared loyalty redemption for '||r.name); remaining:=remaining-take_points;
 end loop;
 loop v_code:='RW-'||upper(substr(encode(gen_random_bytes(10),'hex'),1,14)); exit when not exists(select 1 from public.customer_reward_vouchers cv where cv.customer_user_id=uid and cv.code=v_code); end loop;
 insert into public.customer_reward_vouchers(reward_id,restaurant_id,customer_user_id,code,points_spent,expires_at) values(r.id,r.restaurant_id,uid,v_code,r.points_cost,coalesce(r.ends_at,now()+interval '90 days')) returning * into v;
 update public.restaurant_loyalty_rewards set redemption_count=redemption_count+1,stock_remaining=case when stock_remaining is null then null else greatest(stock_remaining-1,0) end,updated_at=now() where id=r.id;
 return jsonb_build_object('voucher_id',v.id,'code',v.code,'expires_at',v.expires_at,'points_spent',r.points_cost,'shared_points_balance',points-r.points_cost);
end $$;

create or replace function private.get_vip_order_benefits(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype; source_restaurant uuid; m public.customer_vip_memberships%rowtype; t public.restaurant_vip_tiers%rowtype; b record; pct integer:=0; fixed integer:=0; delivery integer:=0; item_discount integer:=0; candidate integer:=0; discount integer:=0; benefits jsonb:='[]'::jsonb; src_template uuid; mapped_item uuid; rid uuid;
begin
 select * into o from public.orders where id=p_order_id;
 if not found or o.customer_user_id is null then return jsonb_build_object('tier_id',null,'discount_pence',0,'delivery_discount_pence',0,'menu_item_discount_pence',0,'benefits','[]'::jsonb); end if;
 for rid in select x.restaurant_id from private.restaurant_group_feature_restaurants(o.restaurant_id,'vip') x loop
   perform private.evaluate_customer_vip_tier(rid,o.customer_user_id,'checkout','system',null);
 end loop;
 select cm.* into m
 from public.customer_vip_memberships cm
 join public.restaurant_vip_tiers ct on ct.id=cm.current_tier_id and ct.is_active and ct.archived_at is null
 where cm.customer_user_id=o.customer_user_id and cm.restaurant_id in(select x.restaurant_id from private.restaurant_group_feature_restaurants(o.restaurant_id,'vip') x)
 order by ct.priority desc,cm.tier_changed_at desc nulls last limit 1;
 if m.current_tier_id is null then return jsonb_build_object('tier_id',null,'discount_pence',0,'delivery_discount_pence',0,'menu_item_discount_pence',0,'benefits','[]'::jsonb); end if;
 select * into t from public.restaurant_vip_tiers where id=m.current_tier_id and is_active and archived_at is null;
 if not found then return jsonb_build_object('tier_id',null,'discount_pence',0,'delivery_discount_pence',0,'menu_item_discount_pence',0,'benefits','[]'::jsonb); end if;
 source_restaurant:=m.restaurant_id;
 for b in select * from public.restaurant_vip_tier_benefits where tier_id=t.id and is_active loop
   mapped_item:=b.menu_item_id;
   if b.benefit_type='free_menu_item' and source_restaurant<>o.restaurant_id and b.menu_item_id is not null then
     select mi.group_template_item_id into src_template from public.menu_items mi where mi.id=b.menu_item_id and mi.restaurant_id=source_restaurant;
     if src_template is not null then select mi.id into mapped_item from public.menu_items mi where mi.restaurant_id=o.restaurant_id and mi.group_template_item_id=src_template and mi.is_available limit 1; else mapped_item:=null; end if;
   end if;
   benefits:=benefits||jsonb_build_array(jsonb_build_object('id',b.id,'source_restaurant_id',source_restaurant,'type',b.benefit_type,'value',b.value,'menu_item_id',mapped_item));
   if b.benefit_type='percentage_discount' then pct:=greatest(pct,coalesce(b.value,0));
   elsif b.benefit_type='fixed_discount' then fixed:=greatest(fixed,coalesce(b.value,0));
   elsif b.benefit_type='free_delivery' and o.fulfilment_method='delivery' then delivery:=o.delivery_fee_pence;
   elsif b.benefit_type='free_menu_item' and mapped_item is not null then select coalesce(max(least(oi.unit_price_pence,mi.price_pence)),0) into candidate from public.order_items oi join public.menu_items mi on mi.id=oi.menu_item_id where oi.order_id=o.id and oi.menu_item_id=mapped_item; item_discount:=item_discount+candidate; end if;
 end loop;
 discount:=least(o.subtotal_pence+o.delivery_fee_pence,greatest(round(o.subtotal_pence*pct/10000.0)::integer,fixed)+delivery+item_discount);
 return jsonb_build_object('tier_id',t.id,'source_restaurant_id',source_restaurant,'tier_name',t.name,'tier_colour',t.colour,'tier_icon',t.icon,'discount_pence',discount,'delivery_discount_pence',delivery,'menu_item_discount_pence',item_discount,'benefits',benefits);
end $$;

create or replace function public.refresh_restaurant_group_timed_prices()
returns integer language plpgsql security definer set search_path='' as $$
declare rec record; v_count integer:=0;
begin
 if current_user not in ('postgres','service_role') and session_user not in ('postgres','service_role') then raise exception 'Service role required' using errcode='42501'; end if;
 for rec in
   select distinct i.template_id
   from public.restaurant_group_price_overrides o
   join public.restaurant_group_menu_items i on i.id=o.template_item_id
   join public.restaurant_group_menu_templates t on t.id=i.template_id
   join public.restaurant_groups g on g.id=t.group_id and g.status='active'
   where t.status='active' and (
     (o.starts_at is not null and o.starts_at between now()-interval '2 minutes' and now()+interval '1 minute')
     or (o.ends_at is not null and o.ends_at between now()-interval '2 minutes' and now()+interval '1 minute')
   )
 loop
   perform private.publish_restaurant_group_menu_template(rec.template_id,null,null); v_count:=v_count+1;
 end loop;
 return v_count;
end $$;
revoke all on function public.refresh_restaurant_group_timed_prices() from public,anon,authenticated;
grant execute on function public.refresh_restaurant_group_timed_prices() to service_role;

create or replace function public.platform_assign_restaurant_group_admin(p_group_id uuid,p_user_id uuid,p_reason text default 'Platform provisioning')
returns uuid language plpgsql security definer set search_path='' as $$
declare v_role uuid;v_id uuid;
begin
 if not private.platform_admin_has_permission('restaurants:manage') then raise exception 'Platform restaurant management permission required' using errcode='42501'; end if;
 if not exists(select 1 from public.restaurant_groups where id=p_group_id and status<>'archived') then raise exception 'Organisation not found'; end if;
 select id into v_role from public.restaurant_group_roles where group_id=p_group_id and key='corporate_admin';
 if v_role is null then perform private.restaurant_group_seed_roles(p_group_id); select id into v_role from public.restaurant_group_roles where group_id=p_group_id and key='corporate_admin'; end if;
 insert into public.restaurant_group_members(group_id,user_id,role_id,scope_type,status,invited_by)
 values(p_group_id,p_user_id,v_role,'group','active',auth.uid())
 on conflict do nothing;
 select id into v_id from public.restaurant_group_members where group_id=p_group_id and user_id=p_user_id and role_id=v_role and scope_type='group' and status='active' order by created_at limit 1;
 if v_id is null then raise exception 'Unable to provision corporate admin'; end if;
 perform private.restaurant_group_log(p_group_id,'staff.platform_admin_assigned','group_member',v_id,p_reason,jsonb_build_object('user_id',p_user_id),'platform_admin');
 return v_id;
end $$;
revoke all on function public.platform_assign_restaurant_group_admin(uuid,uuid,text) from public;
grant execute on function public.platform_assign_restaurant_group_admin(uuid,uuid,text) to authenticated;

do $$ begin
  if exists(select 1 from cron.job where jobname='ordered-group-price-refresh') then perform cron.unschedule('ordered-group-price-refresh'); end if;
  perform cron.schedule('ordered-group-price-refresh','* * * * *','select public.refresh_restaurant_group_timed_prices()');
  if exists(select 1 from cron.job where jobname='ordered-group-notifications') then perform cron.unschedule('ordered-group-notifications'); end if;
  perform cron.schedule('ordered-group-notifications','*/5 * * * *',format($cmd$select net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='phase_5_11_edge_anon_key' limit 1)), body := '{}'::jsonb)$cmd$,'https://uvlzxrsqylwksgwpsslp.supabase.co/functions/v1/process-group-notifications'));
end $$;
