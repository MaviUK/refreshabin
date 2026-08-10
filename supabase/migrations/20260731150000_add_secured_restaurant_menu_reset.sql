create or replace function public.reset_restaurant_menu(p_restaurant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_category_count integer;
  v_item_count integer;
  v_modifier_group_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.restaurant_members rm
    where rm.restaurant_id = p_restaurant_id
      and rm.user_id = auth.uid()
      and rm.role in ('owner', 'admin')
  ) then
    raise exception 'You do not have permission to replace this menu';
  end if;

  select count(*) into v_category_count from public.menu_categories where restaurant_id = p_restaurant_id;
  select count(*) into v_item_count from public.menu_items where restaurant_id = p_restaurant_id;
  select count(*) into v_modifier_group_count from public.modifier_groups where restaurant_id = p_restaurant_id;

  delete from public.modifier_groups where restaurant_id = p_restaurant_id;
  delete from public.menu_categories where restaurant_id = p_restaurant_id;

  return jsonb_build_object(
    'restaurant_id', p_restaurant_id,
    'categories_deleted', v_category_count,
    'items_deleted', v_item_count,
    'modifier_groups_deleted', v_modifier_group_count
  );
end;
$function$;

revoke all on function public.reset_restaurant_menu(uuid) from public, anon;
grant execute on function public.reset_restaurant_menu(uuid) to authenticated;
