begin;

create or replace function public.is_restaurant_member(target_restaurant_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$select exists(select 1 from public.restaurant_members rm where rm.restaurant_id=target_restaurant_id and rm.user_id=(select auth.uid()) and rm.status='active')$$;

create or replace function public.has_restaurant_role(target_restaurant_id uuid,allowed_roles public.restaurant_member_role[])
returns boolean language sql stable security definer set search_path=''
as $$select exists(select 1 from public.restaurant_members rm where rm.restaurant_id=target_restaurant_id and rm.user_id=(select auth.uid()) and rm.status='active' and rm.role=any(allowed_roles))$$;

create or replace function private.restaurant_permission_for(p_restaurant_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path=''
as $$select coalesce(bool_or(rm.role='owner' or rm.permissions?p_permission or coalesce(custom_role.permissions?p_permission,false) or coalesce(system_role.permissions?p_permission,false)),false) from public.restaurant_members rm left join public.restaurant_team_roles custom_role on custom_role.id=rm.custom_role_id and custom_role.restaurant_id=rm.restaurant_id left join public.restaurant_team_roles system_role on system_role.restaurant_id=rm.restaurant_id and system_role.is_system and system_role.key=rm.role::text where rm.restaurant_id=p_restaurant_id and rm.user_id=(select auth.uid()) and rm.status='active'$$;

create or replace function public.restaurant_member_has_permission(p_permission text)
returns boolean language plpgsql stable security definer set search_path=''
as $$declare rid uuid;begin select restaurant_id into rid from public.restaurant_members where user_id=(select auth.uid()) and status='active' order by created_at limit 1;if rid is null then return false;end if;return private.restaurant_permission_for(rid,p_permission);end$$;

drop policy if exists restaurant_members_owner_insert on public.restaurant_members;
drop policy if exists restaurant_members_owner_delete on public.restaurant_members;
drop policy if exists restaurant_members_owner_manager_update on public.restaurant_members;
create policy restaurant_members_first_owner_insert on public.restaurant_members for insert to authenticated with check(user_id=(select auth.uid()) and role='owner' and status='active' and not exists(select 1 from public.restaurant_members existing where existing.restaurant_id=restaurant_members.restaurant_id));

drop policy if exists "Restaurant members can view orders" on public.orders;
create policy "Restaurant members can view orders" on public.orders for select to authenticated using(customer_user_id=(select auth.uid()) or private.restaurant_permission_for(restaurant_id,'orders:view'));
drop policy if exists "Restaurant members can update orders" on public.orders;
create policy "Restaurant members can update orders" on public.orders for update to authenticated using(private.restaurant_permission_for(restaurant_id,'orders:manage')) with check(private.restaurant_permission_for(restaurant_id,'orders:manage'));
drop policy if exists "Customers and restaurant members can view order items" on public.order_items;
create policy "Customers and restaurant members can view order items" on public.order_items for select to authenticated using(exists(select 1 from public.orders o where o.id=order_items.order_id and(o.customer_user_id=(select auth.uid()) or private.restaurant_permission_for(o.restaurant_id,'orders:view'))));
drop policy if exists "Customers and restaurant members can view order history" on public.order_status_history;
create policy "Customers and restaurant members can view order history" on public.order_status_history for select to authenticated using(exists(select 1 from public.orders o where o.id=order_status_history.order_id and(o.customer_user_id=(select auth.uid()) or private.restaurant_permission_for(o.restaurant_id,'orders:view'))));

drop policy if exists "restaurant members can create menu imports" on public.menu_imports;
create policy "restaurant members can create menu imports" on public.menu_imports for insert to authenticated with check(uploaded_by=(select auth.uid()) and private.restaurant_permission_for(restaurant_id,'menu:manage'));
drop policy if exists "restaurant members can update menu imports" on public.menu_imports;
create policy "restaurant members can update menu imports" on public.menu_imports for update to authenticated using(private.restaurant_permission_for(restaurant_id,'menu:manage')) with check(private.restaurant_permission_for(restaurant_id,'menu:manage'));
drop policy if exists "restaurant members can view menu imports" on public.menu_imports;
create policy "restaurant members can view menu imports" on public.menu_imports for select to authenticated using(private.restaurant_permission_for(restaurant_id,'menu:view'));
drop policy if exists "Restaurant members manage menu item extras" on public.menu_item_extras;
create policy "Restaurant members manage menu item extras" on public.menu_item_extras for all to authenticated using(private.restaurant_permission_for(restaurant_id,'menu:manage')) with check(private.restaurant_permission_for(restaurant_id,'menu:manage'));
drop policy if exists "Restaurant members manage menu item ingredients" on public.menu_item_ingredients;
create policy "Restaurant members manage menu item ingredients" on public.menu_item_ingredients for all to authenticated using(private.restaurant_permission_for(restaurant_id,'menu:manage')) with check(private.restaurant_permission_for(restaurant_id,'menu:manage'));
drop policy if exists "Restaurant members manage menu modifier assignments" on public.menu_item_modifier_groups;
create policy "Restaurant members manage menu modifier assignments" on public.menu_item_modifier_groups for all to authenticated using(private.restaurant_permission_for(restaurant_id,'menu:manage')) with check(private.restaurant_permission_for(restaurant_id,'menu:manage'));
drop policy if exists "Restaurant members manage modifier groups" on public.modifier_groups;
create policy "Restaurant members manage modifier groups" on public.modifier_groups for all to authenticated using(private.restaurant_permission_for(restaurant_id,'menu:manage')) with check(private.restaurant_permission_for(restaurant_id,'menu:manage'));
drop policy if exists "Restaurant members manage modifier options" on public.modifier_options;
create policy "Restaurant members manage modifier options" on public.modifier_options for all to authenticated using(private.restaurant_permission_for(restaurant_id,'menu:manage')) with check(private.restaurant_permission_for(restaurant_id,'menu:manage'));

update public.restaurant_team_roles set permissions=(permissions||'["printers:view","printers:manage"]'::jsonb),updated_at=now() where is_system and key='manager';
update public.restaurant_team_roles set permissions=(permissions||'["printers:view"]'::jsonb),updated_at=now() where is_system and key in('staff','kitchen');
drop policy if exists "Restaurant members can manage printers" on public.restaurant_printers;
create policy "Restaurant members can manage printers" on public.restaurant_printers for all to authenticated using(private.restaurant_permission_for(restaurant_id,'printers:manage')) with check(private.restaurant_permission_for(restaurant_id,'printers:manage'));
drop policy if exists "Restaurant members can view printers" on public.restaurant_printers;
create policy "Restaurant members can view printers" on public.restaurant_printers for select to authenticated using(private.restaurant_permission_for(restaurant_id,'printers:view'));
drop policy if exists "Restaurant members can view print jobs" on public.print_jobs;
create policy "Restaurant members can view print jobs" on public.print_jobs for select to authenticated using(private.restaurant_permission_for(restaurant_id,'orders:view'));
drop policy if exists "Restaurant members can update print jobs" on public.print_jobs;
create policy "Restaurant members can update print jobs" on public.print_jobs for update to authenticated using(private.restaurant_permission_for(restaurant_id,'orders:manage')) with check(private.restaurant_permission_for(restaurant_id,'orders:manage'));

drop policy if exists "Restaurant members can create delivery zones" on public.restaurant_delivery_zones;
create policy "Restaurant members can create delivery zones" on public.restaurant_delivery_zones for insert to authenticated with check(private.restaurant_permission_for(restaurant_id,'settings:manage'));
drop policy if exists "Restaurant members can update delivery zones" on public.restaurant_delivery_zones;
create policy "Restaurant members can update delivery zones" on public.restaurant_delivery_zones for update to authenticated using(private.restaurant_permission_for(restaurant_id,'settings:manage')) with check(private.restaurant_permission_for(restaurant_id,'settings:manage'));
drop policy if exists "Restaurant members can delete delivery zones" on public.restaurant_delivery_zones;
create policy "Restaurant members can delete delivery zones" on public.restaurant_delivery_zones for delete to authenticated using(private.restaurant_permission_for(restaurant_id,'settings:manage'));
drop policy if exists "Restaurant members can view delivery zones" on public.restaurant_delivery_zones;
create policy "Restaurant members can view delivery zones" on public.restaurant_delivery_zones for select to authenticated using(private.restaurant_permission_for(restaurant_id,'settings:view') or private.restaurant_permission_for(restaurant_id,'settings:manage'));

revoke all on function public.restaurant_member_has_permission(text) from public,anon,authenticated;
grant execute on function public.restaurant_member_has_permission(text) to authenticated;

commit;
