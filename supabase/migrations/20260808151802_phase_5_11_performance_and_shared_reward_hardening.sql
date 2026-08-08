-- Phase 5.11 foreign-key coverage identified by the Supabase performance advisor.
create index if not exists restaurant_group_api_keys_group_fk_idx on public.restaurant_group_api_keys(group_id);
create index if not exists restaurant_group_api_keys_created_by_fk_idx on public.restaurant_group_api_keys(created_by) where created_by is not null;
create index if not exists restaurant_group_audit_actor_fk_idx on public.restaurant_group_audit_log(actor_user_id) where actor_user_id is not null;
create index if not exists restaurant_group_campaign_campaign_fk_idx on public.restaurant_group_campaign_targets(campaign_id);
create index if not exists restaurant_group_campaign_brand_fk_idx on public.restaurant_group_campaign_targets(brand_id) where brand_id is not null;
create index if not exists restaurant_group_campaign_region_fk_idx on public.restaurant_group_campaign_targets(region_id) where region_id is not null;
create index if not exists restaurant_group_campaign_restaurant_fk_idx on public.restaurant_group_campaign_targets(restaurant_id) where restaurant_id is not null;
create index if not exists restaurant_group_campaign_created_by_fk_idx on public.restaurant_group_campaign_targets(created_by) where created_by is not null;
create index if not exists restaurant_group_departments_parent_fk_idx on public.restaurant_group_departments(parent_department_id) where parent_department_id is not null;
create index if not exists restaurant_group_departments_restaurant_fk_idx on public.restaurant_group_departments(restaurant_id) where restaurant_id is not null;
create index if not exists restaurant_group_enterprise_updated_by_fk_idx on public.restaurant_group_enterprise_settings(updated_by) where updated_by is not null;
create index if not exists restaurant_group_impersonation_admin_fk_idx on public.restaurant_group_impersonation_sessions(admin_user_id);
create index if not exists restaurant_group_impersonation_target_user_fk_idx on public.restaurant_group_impersonation_sessions(target_user_id) where target_user_id is not null;
create index if not exists restaurant_group_impersonation_restaurant_fk_idx on public.restaurant_group_impersonation_sessions(target_restaurant_id) where target_restaurant_id is not null;
create index if not exists restaurant_group_integrations_group_fk_idx on public.restaurant_group_integrations(group_id);
create index if not exists restaurant_group_integrations_created_by_fk_idx on public.restaurant_group_integrations(created_by) where created_by is not null;
create index if not exists restaurant_group_locations_brand_fk_idx on public.restaurant_group_locations(brand_id) where brand_id is not null;
create index if not exists restaurant_group_locations_region_fk_idx on public.restaurant_group_locations(region_id) where region_id is not null;
create index if not exists restaurant_group_locations_merged_fk_idx on public.restaurant_group_locations(merged_into_restaurant_id) where merged_into_restaurant_id is not null;
create index if not exists restaurant_group_members_role_fk_idx on public.restaurant_group_members(role_id);
create index if not exists restaurant_group_members_brand_fk_idx on public.restaurant_group_members(brand_id) where brand_id is not null;
create index if not exists restaurant_group_members_region_fk_idx on public.restaurant_group_members(region_id) where region_id is not null;
create index if not exists restaurant_group_members_restaurant_fk_idx on public.restaurant_group_members(restaurant_id) where restaurant_id is not null;
create index if not exists restaurant_group_members_department_fk_idx on public.restaurant_group_members(department_id) where department_id is not null;
create index if not exists restaurant_group_members_invited_by_fk_idx on public.restaurant_group_members(invited_by) where invited_by is not null;
create index if not exists restaurant_group_menu_categories_template_fk_idx on public.restaurant_group_menu_categories(template_id);
create index if not exists restaurant_group_menu_items_template_fk_idx on public.restaurant_group_menu_items(template_id);
create index if not exists restaurant_group_menu_items_category_fk_idx on public.restaurant_group_menu_items(category_id);
create index if not exists restaurant_group_menu_overrides_group_fk_idx on public.restaurant_group_menu_overrides(group_id);
create index if not exists restaurant_group_menu_overrides_item_fk_idx on public.restaurant_group_menu_overrides(template_item_id);
create index if not exists restaurant_group_menu_overrides_updated_by_fk_idx on public.restaurant_group_menu_overrides(updated_by) where updated_by is not null;
create index if not exists restaurant_group_menu_publications_template_fk_idx on public.restaurant_group_menu_publications(template_id);
create index if not exists restaurant_group_menu_publications_restaurant_fk_idx on public.restaurant_group_menu_publications(restaurant_id);
create index if not exists restaurant_group_menu_publications_published_by_fk_idx on public.restaurant_group_menu_publications(published_by) where published_by is not null;
create index if not exists restaurant_group_menu_templates_brand_fk_idx on public.restaurant_group_menu_templates(brand_id) where brand_id is not null;
create index if not exists restaurant_group_menu_templates_region_fk_idx on public.restaurant_group_menu_templates(region_id) where region_id is not null;
create index if not exists restaurant_group_menu_templates_created_by_fk_idx on public.restaurant_group_menu_templates(created_by) where created_by is not null;
create index if not exists restaurant_group_notification_deliveries_group_fk_idx on public.restaurant_group_notification_deliveries(group_id);
create index if not exists restaurant_group_notifications_restaurant_fk_idx on public.restaurant_group_notifications(restaurant_id) where restaurant_id is not null;
create index if not exists restaurant_group_notifications_created_by_fk_idx on public.restaurant_group_notifications(created_by) where created_by is not null;
create index if not exists restaurant_group_price_group_fk_idx on public.restaurant_group_price_overrides(group_id);
create index if not exists restaurant_group_price_brand_fk_idx on public.restaurant_group_price_overrides(brand_id) where brand_id is not null;
create index if not exists restaurant_group_price_region_fk_idx on public.restaurant_group_price_overrides(region_id) where region_id is not null;
create index if not exists restaurant_group_price_restaurant_fk_idx on public.restaurant_group_price_overrides(restaurant_id) where restaurant_id is not null;
create index if not exists restaurant_group_price_created_by_fk_idx on public.restaurant_group_price_overrides(created_by) where created_by is not null;
create index if not exists restaurant_group_regions_brand_fk_idx on public.restaurant_group_regions(brand_id) where brand_id is not null;
create index if not exists restaurant_group_sharing_updated_by_fk_idx on public.restaurant_group_sharing_settings(updated_by) where updated_by is not null;
create index if not exists restaurant_groups_created_by_fk_idx on public.restaurant_groups(created_by) where created_by is not null;
create index if not exists restaurant_marketing_campaigns_source_group_fk_idx on public.restaurant_marketing_campaigns(source_group_campaign_id) where source_group_campaign_id is not null;

drop index if exists public.reward_vouchers_group_customer_idx;

drop policy if exists restaurant_group_members_read on public.restaurant_group_members;
create policy restaurant_group_members_read on public.restaurant_group_members for select to authenticated using (
  user_id=(select auth.uid())
  or private.restaurant_group_member_permission(group_id,'staff:view')
  or private.platform_admin_has_permission('restaurants:view')
);
drop policy if exists group_notification_deliveries_read on public.restaurant_group_notification_deliveries;
create policy group_notification_deliveries_read on public.restaurant_group_notification_deliveries for select to authenticated using (
  user_id=(select auth.uid())
  or private.restaurant_group_member_permission(group_id,'notifications:manage')
  or private.platform_admin_has_permission('restaurants:view')
);

create or replace function public.reserve_order_reward_voucher(p_order_id uuid,p_voucher_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid();
 o public.orders%rowtype;
 v public.customer_reward_vouchers%rowtype;
 r public.restaurant_loyalty_rewards%rowtype;
 discount integer:=0;
 item_discount integer:=0;
 fixed_value integer;
 pct integer;
 mapped_item_id uuid;
 template_item_id uuid;
begin
 if uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into o from public.orders where id=p_order_id and customer_user_id=uid for update;
 if not found then raise exception 'Order not found' using errcode='42501'; end if;
 if o.order_status<>'pending_payment' then raise exception 'Order is no longer awaiting payment'; end if;
 if o.reward_voucher_id is not null then raise exception 'A reward is already applied to this order'; end if;
 select * into v from public.customer_reward_vouchers
 where id=p_voucher_id and customer_user_id=uid
   and restaurant_id in(select s.restaurant_id from private.restaurant_group_feature_restaurants(o.restaurant_id,'rewards') s)
 for update;
 if not found then raise exception 'Reward voucher not found or not shared to this location'; end if;
 if v.expires_at is not null and v.expires_at<=now() then update public.customer_reward_vouchers set status='expired' where id=v.id; raise exception 'Reward voucher has expired'; end if;
 if v.status='reserved' and v.reservation_expires_at>now() then raise exception 'Reward voucher is already reserved'; end if;
 if v.status not in('available','reserved') then raise exception 'Reward voucher is not available'; end if;
 select * into r from public.restaurant_loyalty_rewards where id=v.reward_id;
 if not found then raise exception 'Reward is no longer available'; end if;
 if not(o.fulfilment_method=any(r.fulfilment_methods)) then raise exception 'This reward is not valid for this fulfilment method'; end if;
 if o.subtotal_pence<r.minimum_order_pence then raise exception 'Minimum order value has not been reached'; end if;
 fixed_value:=coalesce(v.override_fixed_value_pence,r.fixed_value_pence,0);
 pct:=coalesce(v.override_percentage_basis_points,r.percentage_basis_points,0);
 discount:=case r.reward_type
   when 'fixed_discount' then least(fixed_value,o.total_pence)
   when 'percentage_discount' then least(round(o.subtotal_pence*pct/10000.0)::integer,o.total_pence)
   when 'free_delivery' then least(o.delivery_fee_pence,o.total_pence)
   when 'wallet_credit' then least(fixed_value,o.total_pence)
   else 0 end;
 if r.reward_type='free_item' then
   mapped_item_id:=r.menu_item_id;
   if v.restaurant_id<>o.restaurant_id then
     select mi.group_template_item_id into template_item_id from public.menu_items mi where mi.id=r.menu_item_id and mi.restaurant_id=v.restaurant_id;
     if template_item_id is null then raise exception 'This free-item reward has no inherited menu mapping at this location'; end if;
     select mi.id into mapped_item_id from public.menu_items mi where mi.restaurant_id=o.restaurant_id and mi.group_template_item_id=template_item_id and mi.is_available limit 1;
     if mapped_item_id is null then raise exception 'The matching reward item is not available at this location'; end if;
   end if;
   select coalesce(max(unit_price_pence),0) into item_discount from public.order_items where order_id=o.id and menu_item_id=mapped_item_id;
   if item_discount<=0 then raise exception 'The required reward item is not in this order'; end if;
   discount:=least(item_discount,o.total_pence);
 end if;
 if discount<=0 then raise exception 'This reward does not reduce the current order total'; end if;
 update public.customer_reward_vouchers set status='reserved',reserved_order_id=o.id,reserved_at=now(),reservation_expires_at=now()+interval '35 minutes' where id=v.id;
 update public.orders set reward_voucher_id=v.id,reward_discount_pence=discount,discount_pence=discount_pence+discount,total_pence=greatest(total_pence-discount,0),restaurant_net_pence=greatest(restaurant_net_pence-discount,0),updated_at=now() where id=o.id;
 return jsonb_build_object('voucher_id',v.id,'reward_name',r.name,'discount_pence',discount,'total_pence',greatest(o.total_pence-discount,0),'reservation_expires_at',now()+interval '35 minutes','source_restaurant_id',v.restaurant_id,'mapped_menu_item_id',mapped_item_id);
end $$;
revoke execute on function public.reserve_order_reward_voucher(uuid,uuid) from public,anon;
grant execute on function public.reserve_order_reward_voucher(uuid,uuid) to authenticated;
