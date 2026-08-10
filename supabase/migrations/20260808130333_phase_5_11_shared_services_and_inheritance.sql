create or replace function private.restaurant_group_feature_scope(p_group_id uuid,p_feature text)
returns text language sql stable security definer set search_path='' as $$
 select case p_feature
  when 'loyalty' then loyalty_scope when 'wallet' then wallet_scope when 'rewards' then rewards_scope when 'gift_cards' then gift_cards_scope
  when 'referrals' then referrals_scope when 'vip' then vip_scope when 'stamp_cards' then stamp_cards_scope when 'crm' then crm_scope else 'restaurant' end
 from public.restaurant_group_sharing_settings where group_id=p_group_id
$$;
create or replace function private.restaurant_group_region_root(p_region_id uuid)
returns uuid language sql stable security definer set search_path='' as $$
 with recursive lineage as (
   select r.id,r.parent_region_id,0 depth from public.restaurant_group_regions r where r.id=p_region_id
   union all select p.id,p.parent_region_id,l.depth+1 from public.restaurant_group_regions p join lineage l on l.parent_region_id=p.id
 ) select id from lineage order by depth desc limit 1
$$;
create or replace function private.restaurant_group_feature_restaurants(p_restaurant_id uuid,p_feature text)
returns table(restaurant_id uuid) language plpgsql stable security definer set search_path='' as $$
declare l public.restaurant_group_locations%rowtype; v_scope text; v_root uuid;
begin
 select * into l from public.restaurant_group_locations where restaurant_id=p_restaurant_id and status='active';
 if not found then return query select p_restaurant_id; return; end if;
 v_scope:=coalesce(private.restaurant_group_feature_scope(l.group_id,p_feature),'restaurant');
 if v_scope='group' then return query select x.restaurant_id from public.restaurant_group_locations x where x.group_id=l.group_id and x.status='active';
 elsif v_scope='brand' and l.brand_id is not null then return query select x.restaurant_id from public.restaurant_group_locations x where x.group_id=l.group_id and x.brand_id=l.brand_id and x.status='active';
 elsif v_scope='region' and l.region_id is not null then
   v_root:=private.restaurant_group_region_root(l.region_id);
   return query select x.restaurant_id from public.restaurant_group_locations x where x.group_id=l.group_id and x.status='active' and x.region_id is not null and private.restaurant_group_region_root(x.region_id)=v_root;
 else return query select p_restaurant_id; end if;
end $$;
create or replace function public.get_restaurant_group_feature_scope(p_restaurant_id uuid,p_feature text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare l public.restaurant_group_locations%rowtype; v_scope text; v_ids jsonb;
begin
 select * into l from public.restaurant_group_locations where restaurant_id=p_restaurant_id;
 if not found then return jsonb_build_object('scope','restaurant','restaurant_ids',jsonb_build_array(p_restaurant_id)); end if;
 if not (private.restaurant_group_member_of(l.group_id) or private.restaurant_member_of(p_restaurant_id) or auth.uid() is not null) then raise exception 'Authentication required' using errcode='42501'; end if;
 v_scope:=coalesce(private.restaurant_group_feature_scope(l.group_id,p_feature),'restaurant');
 select coalesce(jsonb_agg(x.restaurant_id order by x.restaurant_id),'[]'::jsonb) into v_ids from private.restaurant_group_feature_restaurants(p_restaurant_id,p_feature) x;
 return jsonb_build_object('group_id',l.group_id,'scope',v_scope,'restaurant_ids',v_ids);
end $$;
create or replace function public.save_restaurant_group_sharing_settings(p_group_id uuid,p_settings jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not private.restaurant_group_member_permission(p_group_id,'loyalty:manage') then raise exception 'Organisation loyalty management permission required' using errcode='42501'; end if;
 update public.restaurant_group_sharing_settings set
 loyalty_scope=coalesce(p_settings->>'loyalty_scope',loyalty_scope),wallet_scope=coalesce(p_settings->>'wallet_scope',wallet_scope),rewards_scope=coalesce(p_settings->>'rewards_scope',rewards_scope),
 gift_cards_scope=coalesce(p_settings->>'gift_cards_scope',gift_cards_scope),referrals_scope=coalesce(p_settings->>'referrals_scope',referrals_scope),vip_scope=coalesce(p_settings->>'vip_scope',vip_scope),
 stamp_cards_scope=coalesce(p_settings->>'stamp_cards_scope',stamp_cards_scope),crm_scope=coalesce(p_settings->>'crm_scope',crm_scope),updated_by=auth.uid(),updated_at=now() where group_id=p_group_id;
 if not found then raise exception 'Organisation sharing settings not found'; end if;
 perform private.restaurant_group_log(p_group_id,'sharing.updated','sharing_settings',p_group_id,null,p_settings);
 return (select to_jsonb(s) from public.restaurant_group_sharing_settings s where s.group_id=p_group_id);
end $$;
create or replace function public.save_restaurant_group_brand(p_group_id uuid,p_brand_id uuid,p_name text,p_slug text,p_status text default 'active',p_logo_url text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if not private.restaurant_group_member_permission(p_group_id,'organisation:manage') then raise exception 'Organisation management permission required' using errcode='42501'; end if;
 if p_brand_id is null then insert into public.restaurant_group_brands(group_id,name,slug,status,logo_url) values(p_group_id,btrim(p_name),lower(btrim(p_slug)),p_status,p_logo_url) returning id into v_id;
 else update public.restaurant_group_brands set name=btrim(p_name),slug=lower(btrim(p_slug)),status=p_status,logo_url=p_logo_url,updated_at=now() where id=p_brand_id and group_id=p_group_id returning id into v_id; end if;
 if v_id is null then raise exception 'Brand not found'; end if; perform private.restaurant_group_log(p_group_id,'brand.saved','brand',v_id,null,jsonb_build_object('name',p_name,'status',p_status)); return v_id;
end $$;
create or replace function public.save_restaurant_group_region(p_group_id uuid,p_region_id uuid,p_brand_id uuid,p_parent_region_id uuid,p_name text,p_code text default null,p_country_code text default null,p_currency text default null,p_status text default 'active')
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if not private.restaurant_group_member_permission(p_group_id,'organisation:manage') then raise exception 'Organisation management permission required' using errcode='42501'; end if;
 if p_region_id is null then insert into public.restaurant_group_regions(group_id,brand_id,parent_region_id,name,code,country_code,default_currency,status) values(p_group_id,p_brand_id,p_parent_region_id,btrim(p_name),nullif(btrim(p_code),''),nullif(upper(btrim(p_country_code)),''),nullif(upper(btrim(p_currency)),''),p_status) returning id into v_id;
 else update public.restaurant_group_regions set brand_id=p_brand_id,parent_region_id=p_parent_region_id,name=btrim(p_name),code=nullif(btrim(p_code),''),country_code=nullif(upper(btrim(p_country_code)),''),default_currency=nullif(upper(btrim(p_currency)),''),status=p_status,updated_at=now() where id=p_region_id and group_id=p_group_id returning id into v_id; end if;
 if v_id is null then raise exception 'Region not found'; end if; perform private.restaurant_group_log(p_group_id,'region.saved','region',v_id,null,jsonb_build_object('name',p_name,'brand_id',p_brand_id,'parent_region_id',p_parent_region_id)); return v_id;
end $$;
create or replace function public.save_restaurant_group_role(p_group_id uuid,p_role_id uuid,p_key text,p_name text,p_permissions jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if not private.restaurant_group_member_permission(p_group_id,'staff:manage') then raise exception 'Staff management permission required' using errcode='42501'; end if;
 if jsonb_typeof(coalesce(p_permissions,'{}'::jsonb))<>'object' then raise exception 'Permissions must be an object'; end if;
 if p_role_id is null then insert into public.restaurant_group_roles(group_id,key,name,permissions,is_system) values(p_group_id,lower(btrim(p_key)),btrim(p_name),coalesce(p_permissions,'{}'::jsonb),false) returning id into v_id;
 else update public.restaurant_group_roles set key=case when is_system then key else lower(btrim(p_key)) end,name=btrim(p_name),permissions=coalesce(p_permissions,'{}'::jsonb),updated_at=now() where id=p_role_id and group_id=p_group_id returning id into v_id; end if;
 if v_id is null then raise exception 'Role not found'; end if; perform private.restaurant_group_log(p_group_id,'role.saved','role',v_id,null,jsonb_build_object('name',p_name)); return v_id;
end $$;
create or replace function public.save_restaurant_group_member(p_group_id uuid,p_member_id uuid,p_user_id uuid,p_role_id uuid,p_scope_type text,p_brand_id uuid default null,p_region_id uuid default null,p_restaurant_id uuid default null,p_department_id uuid default null,p_permissions jsonb default '{}'::jsonb,p_status text default 'active')
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if not private.restaurant_group_member_permission(p_group_id,'staff:manage',p_restaurant_id,p_brand_id,p_region_id) then raise exception 'Staff management permission required for this scope' using errcode='42501'; end if;
 if p_member_id is null then insert into public.restaurant_group_members(group_id,user_id,role_id,scope_type,brand_id,region_id,restaurant_id,department_id,permissions,status,invited_by) values(p_group_id,p_user_id,p_role_id,p_scope_type,p_brand_id,p_region_id,p_restaurant_id,p_department_id,coalesce(p_permissions,'{}'::jsonb),p_status,auth.uid()) returning id into v_id;
 else update public.restaurant_group_members set user_id=p_user_id,role_id=p_role_id,scope_type=p_scope_type,brand_id=p_brand_id,region_id=p_region_id,restaurant_id=p_restaurant_id,department_id=p_department_id,permissions=coalesce(p_permissions,'{}'::jsonb),status=p_status,updated_at=now() where id=p_member_id and group_id=p_group_id returning id into v_id; end if;
 if v_id is null then raise exception 'Staff membership not found'; end if; perform private.restaurant_group_log(p_group_id,'staff.saved','group_member',v_id,null,jsonb_build_object('user_id',p_user_id,'scope_type',p_scope_type,'status',p_status)); return v_id;
end $$;
create or replace function public.save_restaurant_group_enterprise_settings(p_group_id uuid,p_settings jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not private.restaurant_group_member_permission(p_group_id,'enterprise:manage') then raise exception 'Enterprise management permission required' using errcode='42501'; end if;
 update public.restaurant_group_enterprise_settings set corporate_brand_name=case when p_settings ? 'corporate_brand_name' then nullif(btrim(p_settings->>'corporate_brand_name'),'') else corporate_brand_name end,
 logo_url=case when p_settings ? 'logo_url' then nullif(btrim(p_settings->>'logo_url'),'') else logo_url end,primary_colour=case when p_settings ? 'primary_colour' then nullif(btrim(p_settings->>'primary_colour'),'') else primary_colour end,
 white_label_domain=case when p_settings ? 'white_label_domain' then nullif(lower(btrim(p_settings->>'white_label_domain')),'') else white_label_domain end,support_email=case when p_settings ? 'support_email' then nullif(lower(btrim(p_settings->>'support_email')),'') else support_email end,
 central_notifications_enabled=coalesce((p_settings->>'central_notifications_enabled')::boolean,central_notifications_enabled),shared_customer_support=coalesce((p_settings->>'shared_customer_support')::boolean,shared_customer_support),api_enabled=coalesce((p_settings->>'api_enabled')::boolean,api_enabled),
 branding=coalesce(p_settings->'branding',branding),support_config=coalesce(p_settings->'support_config',support_config),updated_by=auth.uid(),updated_at=now() where group_id=p_group_id;
 if not found then raise exception 'Enterprise settings not found'; end if; perform private.restaurant_group_log(p_group_id,'enterprise.updated','enterprise_settings',p_group_id,null,p_settings);
 return (select to_jsonb(e) from public.restaurant_group_enterprise_settings e where e.group_id=p_group_id);
end $$;

create or replace function public.get_customer_checkout_balances(p_restaurant_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; uid uuid:=auth.uid();
begin
 if uid is null then return jsonb_build_object('credit_balance_pence',0,'gift_cards','[]'::jsonb); end if;
 select jsonb_build_object(
  'credit_balance_pence',coalesce((select sum(a.balance_pence) from public.customer_credit_accounts a where a.customer_user_id=uid and a.restaurant_id in(select x.restaurant_id from private.restaurant_group_feature_restaurants(p_restaurant_id,'wallet') x)),0),
  'gift_cards',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'source_restaurant_id',g.restaurant_id,'code_suffix',right(g.code,4),'remaining_value_pence',g.remaining_value_pence,'expires_at',g.expires_at) order by g.created_at desc) from public.restaurant_gift_cards g where g.restaurant_id in(select x.restaurant_id from private.restaurant_group_feature_restaurants(p_restaurant_id,'gift_cards') x) and g.is_active and g.remaining_value_pence>0 and (g.expires_at is null or g.expires_at>now()) and lower(g.recipient_email)=lower(coalesce(auth.jwt()->>'email',''))),'[]'::jsonb)) into result;
 return result;
end $$;
create or replace function public.get_checkout_reward_vouchers(p_restaurant_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid(); result jsonb;
begin
 if uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('voucher_id',v.id,'source_restaurant_id',v.restaurant_id,'code',v.code,'reward_name',r.name,'reward_type',r.reward_type,'fixed_value_pence',coalesce(v.override_fixed_value_pence,r.fixed_value_pence),'percentage_basis_points',coalesce(v.override_percentage_basis_points,r.percentage_basis_points),'menu_item_id',r.menu_item_id,'minimum_order_pence',r.minimum_order_pence,'expires_at',v.expires_at,'benefit_source_type',v.benefit_source_type) order by v.created_at desc),'[]'::jsonb) into result
 from public.customer_reward_vouchers v join public.restaurant_loyalty_rewards r on r.id=v.reward_id
 where v.customer_user_id=uid and v.restaurant_id in(select x.restaurant_id from private.restaurant_group_feature_restaurants(p_restaurant_id,'rewards') x)
 and (v.status='available' or (v.status='reserved' and v.reservation_expires_at<=now())) and (v.expires_at is null or v.expires_at>now()); return result;
end $$;
create or replace function public.get_customer_reward_store(p_restaurant_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid(); points integer:=0; result jsonb;
begin
 if uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select coalesce(sum(a.points_balance),0) into points from public.customer_loyalty_accounts a where a.customer_user_id=uid and a.restaurant_id in(select x.restaurant_id from private.restaurant_group_feature_restaurants(p_restaurant_id,'loyalty') x);
 select jsonb_build_object('points_balance',points,
  'rewards',coalesce(jsonb_agg(jsonb_build_object('id',r.id,'source_restaurant_id',r.restaurant_id,'name',r.name,'description',r.description,'reward_type',r.reward_type,'points_cost',r.points_cost,'fixed_value_pence',r.fixed_value_pence,'percentage_basis_points',r.percentage_basis_points,'minimum_order_pence',r.minimum_order_pence,'ends_at',r.ends_at,'stock_remaining',r.stock_remaining,'can_afford',points>=r.points_cost) order by r.points_cost,r.name) filter(where r.id is not null),'[]'::jsonb),
  'vouchers',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'source_restaurant_id',v.restaurant_id,'reward_id',v.reward_id,'code',v.code,'status',v.status,'expires_at',v.expires_at,'created_at',v.created_at,'reward_name',rr.name,'reward_type',rr.reward_type,'fixed_value_pence',coalesce(v.override_fixed_value_pence,rr.fixed_value_pence),'percentage_basis_points',coalesce(v.override_percentage_basis_points,rr.percentage_basis_points),'minimum_order_pence',rr.minimum_order_pence) order by v.created_at desc) from public.customer_reward_vouchers v join public.restaurant_loyalty_rewards rr on rr.id=v.reward_id where v.restaurant_id in(select x.restaurant_id from private.restaurant_group_feature_restaurants(p_restaurant_id,'rewards') x) and v.customer_user_id=uid and v.status in('available','reserved') and (v.expires_at is null or v.expires_at>now())),'[]'::jsonb)) into result
 from public.restaurant_loyalty_rewards r where r.restaurant_id in(select x.restaurant_id from private.restaurant_group_feature_restaurants(p_restaurant_id,'rewards') x) and r.is_active and r.starts_at<=now() and (r.ends_at is null or r.ends_at>now()) and (r.total_redemption_limit is null or r.redemption_count<r.total_redemption_limit) and (r.stock_remaining is null or r.stock_remaining>0);
 return result;
end $$;
create or replace function public.redeem_loyalty_reward(p_reward_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); r public.restaurant_loyalty_rewards%rowtype; v public.customer_reward_vouchers%rowtype; a record; points integer:=0; remaining integer; take_points integer; c integer; code text;
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
 loop code:='RW-'||upper(substr(encode(gen_random_bytes(10),'hex'),1,14)); exit when not exists(select 1 from public.customer_reward_vouchers where customer_user_id=uid and code=code); end loop;
 insert into public.customer_reward_vouchers(reward_id,restaurant_id,customer_user_id,code,points_spent,expires_at) values(r.id,r.restaurant_id,uid,code,r.points_cost,coalesce(r.ends_at,now()+interval '90 days')) returning * into v;
 update public.restaurant_loyalty_rewards set redemption_count=redemption_count+1,stock_remaining=case when stock_remaining is null then null else greatest(stock_remaining-1,0) end,updated_at=now() where id=r.id;
 return jsonb_build_object('voucher_id',v.id,'code',v.code,'expires_at',v.expires_at,'points_spent',r.points_cost,'shared_points_balance',points-r.points_cost);
end $$;
create or replace function public.reserve_order_reward_voucher(p_order_id uuid,p_voucher_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); o public.orders%rowtype; v public.customer_reward_vouchers%rowtype; r public.restaurant_loyalty_rewards%rowtype; discount integer:=0; item_discount integer:=0; fixed_value integer; pct integer;
begin
 if uid is null then raise exception 'Authentication required' using errcode='42501'; end if; select * into o from public.orders where id=p_order_id and customer_user_id=uid for update;
 if not found then raise exception 'Order not found' using errcode='42501'; end if; if o.order_status<>'pending_payment' then raise exception 'Order is no longer awaiting payment'; end if; if o.reward_voucher_id is not null then raise exception 'A reward is already applied to this order'; end if;
 select * into v from public.customer_reward_vouchers where id=p_voucher_id and customer_user_id=uid and restaurant_id in(select s.restaurant_id from private.restaurant_group_feature_restaurants(o.restaurant_id,'rewards') s) for update;
 if not found then raise exception 'Reward voucher not found or not shared to this location'; end if; if v.expires_at is not null and v.expires_at<=now() then update public.customer_reward_vouchers set status='expired' where id=v.id; raise exception 'Reward voucher has expired'; end if;
 if v.status='reserved' and v.reservation_expires_at>now() then raise exception 'Reward voucher is already reserved'; end if; if v.status not in('available','reserved') then raise exception 'Reward voucher is not available'; end if;
 select * into r from public.restaurant_loyalty_rewards where id=v.reward_id; if not found then raise exception 'Reward is no longer available'; end if; if not(o.fulfilment_method=any(r.fulfilment_methods)) then raise exception 'This reward is not valid for this fulfilment method'; end if;
 if o.subtotal_pence<r.minimum_order_pence then raise exception 'Minimum order value has not been reached'; end if;
 fixed_value:=coalesce(v.override_fixed_value_pence,r.fixed_value_pence,0); pct:=coalesce(v.override_percentage_basis_points,r.percentage_basis_points,0);
 discount:=case r.reward_type when 'fixed_discount' then least(fixed_value,o.total_pence) when 'percentage_discount' then least(round(o.subtotal_pence*pct/10000.0)::integer,o.total_pence) when 'free_delivery' then least(o.delivery_fee_pence,o.total_pence) when 'wallet_credit' then least(fixed_value,o.total_pence) else 0 end;
 if r.reward_type='free_item' then if v.restaurant_id<>o.restaurant_id then raise exception 'Free item rewards remain location-specific unless menu item mapping is configured'; end if; select coalesce(max(unit_price_pence),0) into item_discount from public.order_items where order_id=o.id and menu_item_id=r.menu_item_id; if item_discount<=0 then raise exception 'The required reward item is not in this order'; end if; discount:=least(item_discount,o.total_pence); end if;
 if discount<=0 then raise exception 'This reward does not reduce the current order total'; end if;
 update public.customer_reward_vouchers set status='reserved',reserved_order_id=o.id,reserved_at=now(),reservation_expires_at=now()+interval '35 minutes' where id=v.id;
 update public.orders set reward_voucher_id=v.id,reward_discount_pence=discount,discount_pence=discount_pence+discount,total_pence=greatest(total_pence-discount,0),restaurant_net_pence=greatest(restaurant_net_pence-discount,0),updated_at=now() where id=o.id;
 return jsonb_build_object('voucher_id',v.id,'reward_name',r.name,'discount_pence',discount,'total_pence',greatest(o.total_pence-discount,0),'reservation_expires_at',now()+interval '35 minutes','source_restaurant_id',v.restaurant_id);
end $$;
create or replace function public.reserve_order_balances(p_order_id uuid,p_gift_card_code text default null,p_use_credit_pence integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype; card public.restaurant_gift_cards%rowtype; credit record; reserved integer; gift_use integer:=0; credit_use integer:=0; account_use integer; remaining integer; reward_id uuid; reward_result jsonb; raw_code text:=nullif(trim(p_gift_card_code),''); actual_gift_code text;
begin
 select * into o from public.orders where id=p_order_id and customer_user_id=auth.uid() and order_status='pending_payment' for update; if not found then raise exception 'Order is not available for balance redemption' using errcode='42501'; end if;
 if raw_code like 'REWARD:%|GIFT:%' then reward_id:=split_part(split_part(raw_code,'|',1),':',2)::uuid; actual_gift_code:=nullif(split_part(raw_code,'|GIFT:',2),''); reward_result:=public.reserve_order_reward_voucher(o.id,reward_id); select * into o from public.orders where id=p_order_id for update; else actual_gift_code:=raw_code; end if;
 delete from public.checkout_balance_reservations where order_id=o.id and status='reserved'; remaining:=o.total_pence;
 if actual_gift_code is not null then select * into card from public.restaurant_gift_cards where restaurant_id in(select s.restaurant_id from private.restaurant_group_feature_restaurants(o.restaurant_id,'gift_cards') s) and upper(code)=upper(trim(actual_gift_code)) and is_active and remaining_value_pence>0 and (expires_at is null or expires_at>now()) for update;
  if not found then raise exception 'Gift card is invalid, empty, expired or not shared to this location'; end if; select coalesce(sum(amount_pence),0) into reserved from public.checkout_balance_reservations where gift_card_id=card.id and status='reserved' and expires_at>now(); gift_use:=least(remaining,greatest(card.remaining_value_pence-reserved,0));
  if gift_use>0 then insert into public.checkout_balance_reservations(order_id,restaurant_id,reservation_type,gift_card_id,amount_pence) values(o.id,o.restaurant_id,'gift_card',card.id,gift_use); end if; remaining:=remaining-gift_use;
 end if;
 if p_use_credit_pence>0 and remaining>0 then
  for credit in select a.* from public.customer_credit_accounts a where a.customer_user_id=auth.uid() and a.restaurant_id in(select s.restaurant_id from private.restaurant_group_feature_restaurants(o.restaurant_id,'wallet') s) and a.balance_pence>0 order by (a.restaurant_id=o.restaurant_id) desc,a.updated_at for update loop
   exit when remaining<=0 or credit_use>=p_use_credit_pence; select coalesce(sum(amount_pence),0) into reserved from public.checkout_balance_reservations where credit_account_id=credit.id and status='reserved' and expires_at>now();
   account_use:=least(remaining,p_use_credit_pence-credit_use,greatest(credit.balance_pence-reserved,0)); if account_use>0 then insert into public.checkout_balance_reservations(order_id,restaurant_id,reservation_type,credit_account_id,amount_pence) values(o.id,o.restaurant_id,'customer_credit',credit.id,account_use); credit_use:=credit_use+account_use; remaining:=remaining-account_use; end if;
  end loop;
 end if;
 update public.orders set gift_card_used_pence=gift_use,customer_credit_used_pence=credit_use,total_pence=greatest(total_pence-gift_use-credit_use,0) where id=o.id;
 return jsonb_build_object('gift_card_used_pence',gift_use,'customer_credit_used_pence',credit_use,'reward_discount_pence',coalesce((reward_result->>'discount_pence')::integer,0),'reward_name',reward_result->>'reward_name','total_pence',greatest(o.total_pence-gift_use-credit_use,0));
end $$;

alter table public.menu_categories add column group_template_category_id uuid;
alter table public.menu_items add column group_template_item_id uuid;
create table public.restaurant_group_menu_templates (
 id uuid primary key default gen_random_uuid(),group_id uuid not null references public.restaurant_groups(id) on delete cascade,name text not null,
 scope_type text not null default 'group' check(scope_type in('group','brand','region')),brand_id uuid references public.restaurant_group_brands(id) on delete cascade,region_id uuid references public.restaurant_group_regions(id) on delete cascade,
 status text not null default 'draft' check(status in('draft','active','archived')),auto_publish boolean not null default false,created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check((scope_type='group' and brand_id is null and region_id is null) or (scope_type='brand' and brand_id is not null and region_id is null) or (scope_type='region' and region_id is not null))
);
create table public.restaurant_group_menu_categories (
 id uuid primary key default gen_random_uuid(),template_id uuid not null references public.restaurant_group_menu_templates(id) on delete cascade,name text not null,description text,sort_order integer not null default 0,is_active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.restaurant_group_menu_items (
 id uuid primary key default gen_random_uuid(),template_id uuid not null references public.restaurant_group_menu_templates(id) on delete cascade,category_id uuid not null references public.restaurant_group_menu_categories(id) on delete cascade,name text not null,description text,base_price_pence integer not null check(base_price_pence>=0),image_url text,is_available boolean not null default true,is_vegetarian boolean not null default false,is_vegan boolean not null default false,sort_order integer not null default 0,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.restaurant_group_menu_overrides (
 id uuid primary key default gen_random_uuid(),group_id uuid not null references public.restaurant_groups(id) on delete cascade,restaurant_id uuid not null references public.restaurants(id) on delete cascade,template_item_id uuid not null references public.restaurant_group_menu_items(id) on delete cascade,override_data jsonb not null default '{}'::jsonb check(jsonb_typeof(override_data)='object'),updated_by uuid references auth.users(id) on delete set null,updated_at timestamptz not null default now(),unique(restaurant_id,template_item_id)
);
create table public.restaurant_group_price_overrides (
 id uuid primary key default gen_random_uuid(),group_id uuid not null references public.restaurant_groups(id) on delete cascade,template_item_id uuid not null references public.restaurant_group_menu_items(id) on delete cascade,
 scope_type text not null check(scope_type in('group','brand','region','restaurant')),brand_id uuid references public.restaurant_group_brands(id) on delete cascade,region_id uuid references public.restaurant_group_regions(id) on delete cascade,restaurant_id uuid references public.restaurants(id) on delete cascade,
 price_pence integer not null check(price_pence>=0),starts_at timestamptz,ends_at timestamptz,priority integer not null default 0,created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(ends_at is null or starts_at is null or ends_at>starts_at),
 check((scope_type='group' and brand_id is null and region_id is null and restaurant_id is null) or(scope_type='brand' and brand_id is not null and region_id is null and restaurant_id is null) or(scope_type='region' and region_id is not null and restaurant_id is null) or(scope_type='restaurant' and restaurant_id is not null))
);
create table public.restaurant_group_menu_publications (
 id bigint generated always as identity primary key,group_id uuid not null references public.restaurant_groups(id) on delete cascade,template_id uuid not null references public.restaurant_group_menu_templates(id) on delete cascade,restaurant_id uuid not null references public.restaurants(id) on delete cascade,published_by uuid references auth.users(id) on delete set null,published_at timestamptz not null default now(),item_count integer not null default 0,status text not null default 'published',details jsonb not null default '{}'::jsonb
);
create unique index menu_categories_group_template_uniq on public.menu_categories(restaurant_id,group_template_category_id) where group_template_category_id is not null;
create unique index menu_items_group_template_uniq on public.menu_items(restaurant_id,group_template_item_id) where group_template_item_id is not null;
create index restaurant_group_menu_templates_scope_idx on public.restaurant_group_menu_templates(group_id,scope_type,brand_id,region_id,status);
create index restaurant_group_price_overrides_lookup_idx on public.restaurant_group_price_overrides(template_item_id,scope_type,starts_at,ends_at);
create index restaurant_group_menu_publications_lookup_idx on public.restaurant_group_menu_publications(group_id,restaurant_id,published_at desc);
create or replace function private.restaurant_group_template_targets(p_template_id uuid)
returns table(restaurant_id uuid) language plpgsql stable security definer set search_path='' as $$
declare t public.restaurant_group_menu_templates%rowtype; v_root uuid;
begin select * into t from public.restaurant_group_menu_templates where id=p_template_id; if not found then return; end if;
 if t.scope_type='group' then return query select l.restaurant_id from public.restaurant_group_locations l where l.group_id=t.group_id and l.status='active';
 elsif t.scope_type='brand' then return query select l.restaurant_id from public.restaurant_group_locations l where l.group_id=t.group_id and l.brand_id=t.brand_id and l.status='active';
 else v_root:=private.restaurant_group_region_root(t.region_id); return query select l.restaurant_id from public.restaurant_group_locations l where l.group_id=t.group_id and l.status='active' and l.region_id is not null and private.restaurant_group_region_root(l.region_id)=v_root; end if;
end $$;
create or replace function private.restaurant_group_effective_item_price(p_item_id uuid,p_restaurant_id uuid)
returns integer language plpgsql stable security definer set search_path='' as $$
declare l public.restaurant_group_locations%rowtype; v_base integer; v_price integer;
begin select * into l from public.restaurant_group_locations where restaurant_id=p_restaurant_id; select base_price_pence into v_base from public.restaurant_group_menu_items where id=p_item_id;
 select o.price_pence into v_price from public.restaurant_group_price_overrides o where o.template_item_id=p_item_id and o.group_id=l.group_id and (o.starts_at is null or o.starts_at<=now()) and(o.ends_at is null or o.ends_at>now())
 and ((o.scope_type='restaurant' and o.restaurant_id=p_restaurant_id) or(o.scope_type='region' and l.region_id is not null and o.region_id is not null and private.restaurant_group_region_root(o.region_id)=private.restaurant_group_region_root(l.region_id)) or(o.scope_type='brand' and o.brand_id=l.brand_id) or o.scope_type='group')
 order by case o.scope_type when 'restaurant' then 4 when 'region' then 3 when 'brand' then 2 else 1 end desc,o.priority desc,o.created_at desc limit 1;
 return coalesce(v_price,v_base,0); end $$;
create or replace function private.publish_restaurant_group_menu_template(p_template_id uuid,p_actor uuid,p_only_restaurants uuid[] default null)
returns integer language plpgsql security definer set search_path='' as $$
declare t public.restaurant_group_menu_templates%rowtype; target record; c record; i record; v_category uuid; v_count integer:=0; v_override jsonb;
begin select * into t from public.restaurant_group_menu_templates where id=p_template_id and status<>'archived'; if not found then raise exception 'Menu template not found'; end if;
 for target in select x.restaurant_id from private.restaurant_group_template_targets(p_template_id)x where p_only_restaurants is null or x.restaurant_id=any(p_only_restaurants) loop
  v_count:=0;
  for c in select * from public.restaurant_group_menu_categories where template_id=p_template_id order by sort_order,id loop
   insert into public.menu_categories(restaurant_id,name,description,sort_order,is_active,group_template_category_id) values(target.restaurant_id,c.name,c.description,c.sort_order,c.is_active,c.id)
   on conflict(restaurant_id,group_template_category_id) where group_template_category_id is not null do update set name=excluded.name,description=excluded.description,sort_order=excluded.sort_order,is_active=excluded.is_active,updated_at=now() returning id into v_category;
   for i in select * from public.restaurant_group_menu_items where category_id=c.id order by sort_order,id loop
    select override_data into v_override from public.restaurant_group_menu_overrides where restaurant_id=target.restaurant_id and template_item_id=i.id;
    insert into public.menu_items(category_id,restaurant_id,name,description,price_pence,image_url,is_available,is_vegetarian,is_vegan,sort_order,group_template_item_id)
    values(v_category,target.restaurant_id,coalesce(v_override->>'name',i.name),coalesce(v_override->>'description',i.description),private.restaurant_group_effective_item_price(i.id,target.restaurant_id),coalesce(v_override->>'image_url',i.image_url),coalesce((v_override->>'is_available')::boolean,i.is_available),coalesce((v_override->>'is_vegetarian')::boolean,i.is_vegetarian),coalesce((v_override->>'is_vegan')::boolean,i.is_vegan),coalesce((v_override->>'sort_order')::integer,i.sort_order),i.id)
    on conflict(restaurant_id,group_template_item_id) where group_template_item_id is not null do update set category_id=excluded.category_id,name=excluded.name,description=excluded.description,price_pence=excluded.price_pence,image_url=excluded.image_url,is_available=excluded.is_available,is_vegetarian=excluded.is_vegetarian,is_vegan=excluded.is_vegan,sort_order=excluded.sort_order,updated_at=now();
    v_count:=v_count+1;
   end loop;
  end loop;
  insert into public.restaurant_group_menu_publications(group_id,template_id,restaurant_id,published_by,item_count) values(t.group_id,p_template_id,target.restaurant_id,p_actor,v_count);
 end loop; return v_count;
end $$;
create or replace function public.publish_restaurant_group_menu(p_template_id uuid,p_restaurant_ids uuid[] default null)
returns integer language plpgsql security definer set search_path='' as $$
declare v_group uuid; v_count integer;
begin select group_id into v_group from public.restaurant_group_menu_templates where id=p_template_id; if v_group is null then raise exception 'Menu template not found'; end if;
 if not private.restaurant_group_member_permission(v_group,'menu:manage') then raise exception 'Menu management permission required' using errcode='42501'; end if;
 if p_restaurant_ids is not null and exists(select 1 from unnest(p_restaurant_ids)x where not exists(select 1 from private.restaurant_group_template_targets(p_template_id)t where t.restaurant_id=x)) then raise exception 'One or more restaurants are outside the template scope'; end if;
 v_count:=private.publish_restaurant_group_menu_template(p_template_id,auth.uid(),p_restaurant_ids); perform private.restaurant_group_log(v_group,'menu.published','menu_template',p_template_id,null,jsonb_build_object('restaurant_ids',p_restaurant_ids,'items_last_location',v_count)); return v_count; end $$;
create or replace function private.restaurant_group_menu_autopublish() returns trigger language plpgsql security definer set search_path='' as $$
declare v_template uuid;
begin v_template:=case when tg_table_name='restaurant_group_menu_templates' then new.id when tg_table_name='restaurant_group_menu_categories' then new.template_id when tg_table_name='restaurant_group_menu_items' then new.template_id else null end;
 if v_template is not null and exists(select 1 from public.restaurant_group_menu_templates where id=v_template and auto_publish and status='active') then perform private.publish_restaurant_group_menu_template(v_template,auth.uid(),null); end if; return new; end $$;
create trigger group_menu_template_autopublish after update on public.restaurant_group_menu_templates for each row execute function private.restaurant_group_menu_autopublish();
create trigger group_menu_category_autopublish after insert or update on public.restaurant_group_menu_categories for each row execute function private.restaurant_group_menu_autopublish();
create trigger group_menu_item_autopublish after insert or update on public.restaurant_group_menu_items for each row execute function private.restaurant_group_menu_autopublish();
create or replace function private.restaurant_group_price_autopublish() returns trigger language plpgsql security definer set search_path='' as $$
declare v_template uuid;
begin select template_id into v_template from public.restaurant_group_menu_items where id=new.template_item_id; if exists(select 1 from public.restaurant_group_menu_templates where id=v_template and auto_publish and status='active') then perform private.publish_restaurant_group_menu_template(v_template,auth.uid(),null); end if; return new; end $$;
create trigger group_price_override_autopublish after insert or update on public.restaurant_group_price_overrides for each row execute function private.restaurant_group_price_autopublish();

alter table public.restaurant_marketing_campaigns add column source_group_campaign_id uuid references public.restaurant_marketing_campaigns(id) on delete set null;
create unique index restaurant_marketing_campaign_group_clone_uniq on public.restaurant_marketing_campaigns(restaurant_id,source_group_campaign_id) where source_group_campaign_id is not null;
create table public.restaurant_group_campaign_targets (
 id uuid primary key default gen_random_uuid(),group_id uuid not null references public.restaurant_groups(id) on delete cascade,campaign_id uuid not null references public.restaurant_marketing_campaigns(id) on delete cascade,
 target_type text not null check(target_type in('group','brand','region','restaurant')),brand_id uuid references public.restaurant_group_brands(id) on delete cascade,region_id uuid references public.restaurant_group_regions(id) on delete cascade,restaurant_id uuid references public.restaurants(id) on delete cascade,
 created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),check((target_type='group' and brand_id is null and region_id is null and restaurant_id is null) or(target_type='brand' and brand_id is not null and region_id is null and restaurant_id is null) or(target_type='region' and region_id is not null and restaurant_id is null) or(target_type='restaurant' and restaurant_id is not null))
);
create index restaurant_group_campaign_targets_idx on public.restaurant_group_campaign_targets(group_id,campaign_id,target_type);
create or replace function private.restaurant_group_campaign_restaurants(p_group_id uuid,p_campaign_id uuid)
returns table(restaurant_id uuid) language sql stable security definer set search_path='' as $$
 select distinct l.restaurant_id from public.restaurant_group_locations l join public.restaurant_group_campaign_targets t on t.group_id=l.group_id and t.campaign_id=p_campaign_id
 where l.group_id=p_group_id and l.status='active' and (t.target_type='group' or(t.target_type='brand' and l.brand_id=t.brand_id) or(t.target_type='region' and l.region_id is not null and private.restaurant_group_region_root(l.region_id)=private.restaurant_group_region_root(t.region_id)) or(t.target_type='restaurant' and l.restaurant_id=t.restaurant_id))
$$;
create or replace function public.publish_restaurant_group_campaign(p_campaign_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare c public.restaurant_marketing_campaigns%rowtype; v_group uuid; target record; v_count integer:=0;
begin select * into c from public.restaurant_marketing_campaigns where id=p_campaign_id; if not found then raise exception 'Campaign not found'; end if;
 select group_id into v_group from public.restaurant_group_locations where restaurant_id=c.restaurant_id; if v_group is null then raise exception 'Campaign source restaurant is not in an organisation'; end if;
 if not private.restaurant_group_member_permission(v_group,'marketing:manage') then raise exception 'Marketing management permission required' using errcode='42501'; end if;
 for target in select * from private.restaurant_group_campaign_restaurants(v_group,p_campaign_id) loop
  if target.restaurant_id=c.restaurant_id then continue; end if;
  insert into public.restaurant_marketing_campaigns(restaurant_id,name,campaign_type,status,channels,segment_key,subject,preview_text,html_content,text_content,cta_label,cta_url,image_url,branding,timezone,scheduled_at,next_run_at,recurrence_unit,recurrence_interval,starts_at,ends_at,created_by,source_group_campaign_id)
  values(target.restaurant_id,c.name,c.campaign_type,c.status,c.channels,c.segment_key,c.subject,c.preview_text,c.html_content,c.text_content,c.cta_label,c.cta_url,c.image_url,c.branding,c.timezone,c.scheduled_at,c.next_run_at,c.recurrence_unit,c.recurrence_interval,c.starts_at,c.ends_at,auth.uid(),p_campaign_id)
  on conflict(restaurant_id,source_group_campaign_id) where source_group_campaign_id is not null do update set name=excluded.name,campaign_type=excluded.campaign_type,status=excluded.status,channels=excluded.channels,segment_key=excluded.segment_key,subject=excluded.subject,preview_text=excluded.preview_text,html_content=excluded.html_content,text_content=excluded.text_content,cta_label=excluded.cta_label,cta_url=excluded.cta_url,image_url=excluded.image_url,branding=excluded.branding,timezone=excluded.timezone,scheduled_at=excluded.scheduled_at,next_run_at=excluded.next_run_at,recurrence_unit=excluded.recurrence_unit,recurrence_interval=excluded.recurrence_interval,starts_at=excluded.starts_at,ends_at=excluded.ends_at,updated_at=now();
  v_count:=v_count+1;
 end loop; perform private.restaurant_group_log(v_group,'campaign.published','marketing_campaign',p_campaign_id,null,jsonb_build_object('target_locations',v_count)); return v_count;
end $$;

alter table public.restaurant_group_menu_templates enable row level security; alter table public.restaurant_group_menu_categories enable row level security; alter table public.restaurant_group_menu_items enable row level security; alter table public.restaurant_group_menu_overrides enable row level security; alter table public.restaurant_group_price_overrides enable row level security; alter table public.restaurant_group_menu_publications enable row level security; alter table public.restaurant_group_campaign_targets enable row level security;
create policy group_menu_templates_read on public.restaurant_group_menu_templates for select to authenticated using(private.restaurant_group_member_permission(group_id,'menu:view') or private.platform_admin_has_permission('restaurants:view'));
create policy group_menu_categories_read on public.restaurant_group_menu_categories for select to authenticated using(exists(select 1 from public.restaurant_group_menu_templates t where t.id=template_id and(private.restaurant_group_member_permission(t.group_id,'menu:view') or private.platform_admin_has_permission('restaurants:view'))));
create policy group_menu_items_read on public.restaurant_group_menu_items for select to authenticated using(exists(select 1 from public.restaurant_group_menu_templates t where t.id=template_id and(private.restaurant_group_member_permission(t.group_id,'menu:view') or private.platform_admin_has_permission('restaurants:view'))));
create policy group_menu_overrides_read on public.restaurant_group_menu_overrides for select to authenticated using(private.restaurant_group_member_permission(group_id,'menu:view',restaurant_id) or private.platform_admin_has_permission('restaurants:view'));
create policy group_price_overrides_read on public.restaurant_group_price_overrides for select to authenticated using(private.restaurant_group_member_permission(group_id,'pricing:view',restaurant_id,brand_id,region_id) or private.platform_admin_has_permission('restaurants:view'));
create policy group_menu_publications_read on public.restaurant_group_menu_publications for select to authenticated using(private.restaurant_group_member_permission(group_id,'menu:view',restaurant_id) or private.platform_admin_has_permission('restaurants:view'));
create policy group_campaign_targets_read on public.restaurant_group_campaign_targets for select to authenticated using(private.restaurant_group_member_permission(group_id,'marketing:view',restaurant_id,brand_id,region_id) or private.platform_admin_has_permission('restaurants:view'));
grant select on public.restaurant_group_menu_templates,public.restaurant_group_menu_categories,public.restaurant_group_menu_items,public.restaurant_group_menu_overrides,public.restaurant_group_price_overrides,public.restaurant_group_menu_publications,public.restaurant_group_campaign_targets to authenticated;
revoke all on function public.save_restaurant_group_sharing_settings(uuid,jsonb),public.save_restaurant_group_brand(uuid,uuid,text,text,text,text),public.save_restaurant_group_region(uuid,uuid,uuid,uuid,text,text,text,text,text),public.save_restaurant_group_role(uuid,uuid,text,text,jsonb),public.save_restaurant_group_member(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,uuid,jsonb,text),public.save_restaurant_group_enterprise_settings(uuid,jsonb),public.publish_restaurant_group_menu(uuid,uuid[]),public.publish_restaurant_group_campaign(uuid) from public;
grant execute on function public.get_restaurant_group_feature_scope(uuid,text),public.save_restaurant_group_sharing_settings(uuid,jsonb),public.save_restaurant_group_brand(uuid,uuid,text,text,text,text),public.save_restaurant_group_region(uuid,uuid,uuid,uuid,text,text,text,text,text),public.save_restaurant_group_role(uuid,uuid,text,text,jsonb),public.save_restaurant_group_member(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,uuid,jsonb,text),public.save_restaurant_group_enterprise_settings(uuid,jsonb),public.publish_restaurant_group_menu(uuid,uuid[]),public.publish_restaurant_group_campaign(uuid) to authenticated;
