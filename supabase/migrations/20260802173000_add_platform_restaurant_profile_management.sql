begin;

create or replace function public.get_platform_restaurant_menu(p_restaurant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  if not private.has_platform_admin_permission('restaurants:view') then
    raise exception 'You do not have permission to view restaurant menus' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'restaurant_id', r.id,
    'restaurant_name', r.name,
    'categories', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'description', c.description,
          'sort_order', c.sort_order,
          'is_active', c.is_active,
          'updated_at', c.updated_at,
          'items', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', i.id,
                'category_id', i.category_id,
                'name', i.name,
                'description', i.description,
                'price_pence', i.price_pence,
                'image_url', i.image_url,
                'is_available', i.is_available,
                'is_vegetarian', i.is_vegetarian,
                'is_vegan', i.is_vegan,
                'sort_order', i.sort_order,
                'updated_at', i.updated_at
              ) order by i.sort_order, i.created_at
            )
            from public.menu_items i
            where i.restaurant_id = r.id and i.category_id = c.id
          ), '[]'::jsonb)
        ) order by c.sort_order, c.created_at
      )
      from public.menu_categories c
      where c.restaurant_id = r.id
    ), '[]'::jsonb)
  ) into result
  from public.restaurants r
  where r.id = p_restaurant_id;

  if result is null then
    raise exception 'Restaurant not found' using errcode = 'P0002';
  end if;

  return result;
end;
$function$;

create or replace function public.set_platform_restaurant_accepting_orders(
  p_restaurant_id uuid,
  p_accepting_orders boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := (select auth.uid());
  restaurant_record public.restaurants%rowtype;
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not private.has_platform_admin_permission('restaurants:manage') then
    raise exception 'You do not have permission to manage restaurant availability' using errcode = '42501';
  end if;
  if p_accepting_orders is null then
    raise exception 'Choose whether the restaurant should accept orders' using errcode = '22023';
  end if;
  if clean_reason is null or char_length(clean_reason) < 3 then
    raise exception 'Add a reason of at least 3 characters' using errcode = '22023';
  end if;
  if char_length(clean_reason) > 500 then
    raise exception 'The reason must be 500 characters or fewer' using errcode = '22023';
  end if;

  select r.* into restaurant_record
  from public.restaurants r
  where r.id = p_restaurant_id
  for update;

  if restaurant_record.id is null then
    raise exception 'Restaurant not found' using errcode = 'P0002';
  end if;
  if restaurant_record.status <> 'active' then
    raise exception 'Only live restaurants can be put online or offline' using errcode = '22023';
  end if;
  if restaurant_record.accepting_orders = p_accepting_orders then
    raise exception 'Restaurant availability is already set to this value' using errcode = '22023';
  end if;

  update public.restaurants
  set accepting_orders = p_accepting_orders, updated_at = now()
  where id = p_restaurant_id;

  insert into public.platform_admin_audit_log (actor_user_id, action, target_type, target_id, details)
  values (
    actor_id,
    case when p_accepting_orders then 'restaurant_put_online' else 'restaurant_put_offline' end,
    'restaurant',
    p_restaurant_id,
    jsonb_build_object(
      'restaurant_name', restaurant_record.name,
      'previous_accepting_orders', restaurant_record.accepting_orders,
      'accepting_orders', p_accepting_orders,
      'reason', clean_reason
    )
  );

  return jsonb_build_object(
    'restaurant_id', p_restaurant_id,
    'accepting_orders', p_accepting_orders,
    'reason', clean_reason
  );
end;
$function$;

create or replace function public.manage_platform_restaurant_menu(
  p_restaurant_id uuid,
  p_action text,
  p_target_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := (select auth.uid());
  restaurant_name text;
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
  payload jsonb := coalesce(p_payload, '{}'::jsonb);
  category_record public.menu_categories%rowtype;
  item_record public.menu_items%rowtype;
  v_category_id uuid;
  created_id uuid;
  clean_name text;
  clean_description text;
  v_price_pence integer;
  v_is_available boolean;
  v_is_vegetarian boolean;
  v_is_vegan boolean;
  before_value jsonb;
  after_value jsonb;
  target_type text;
begin
  if not private.has_platform_admin_permission('restaurants:manage') then
    raise exception 'You do not have permission to manage restaurant menus' using errcode = '42501';
  end if;
  if p_action not in ('category_create', 'category_update', 'category_delete', 'item_create', 'item_update', 'item_delete') then
    raise exception 'Unsupported menu action' using errcode = '22023';
  end if;
  if clean_reason is null or char_length(clean_reason) < 3 then
    raise exception 'Add a reason of at least 3 characters' using errcode = '22023';
  end if;
  if char_length(clean_reason) > 500 then
    raise exception 'The reason must be 500 characters or fewer' using errcode = '22023';
  end if;

  select r.name into restaurant_name
  from public.restaurants r
  where r.id = p_restaurant_id
  for update;
  if restaurant_name is null then
    raise exception 'Restaurant not found' using errcode = 'P0002';
  end if;

  if p_action = 'category_create' then
    clean_name := nullif(trim(payload ->> 'name'), '');
    clean_description := nullif(trim(payload ->> 'description'), '');
    if clean_name is null or char_length(clean_name) > 120 then
      raise exception 'Category name must be between 1 and 120 characters' using errcode = '22023';
    end if;
    if char_length(coalesce(clean_description, '')) > 500 then
      raise exception 'Category description must be 500 characters or fewer' using errcode = '22023';
    end if;
    if payload ? 'is_active' and jsonb_typeof(payload -> 'is_active') <> 'boolean' then
      raise exception 'Category active state must be true or false' using errcode = '22023';
    end if;

    insert into public.menu_categories (restaurant_id, name, description, sort_order, is_active)
    values (
      p_restaurant_id,
      clean_name,
      clean_description,
      (select coalesce(max(c.sort_order), -1) + 1 from public.menu_categories c where c.restaurant_id = p_restaurant_id),
      coalesce((payload ->> 'is_active')::boolean, true)
    ) returning id into created_id;
    select to_jsonb(c) into after_value from public.menu_categories c where c.id = created_id;
    target_type := 'menu_category';

  elsif p_action in ('category_update', 'category_delete') then
    select c.* into category_record
    from public.menu_categories c
    where c.id = p_target_id and c.restaurant_id = p_restaurant_id
    for update;
    if category_record.id is null then
      raise exception 'Menu category not found' using errcode = 'P0002';
    end if;
    before_value := to_jsonb(category_record);
    created_id := category_record.id;
    target_type := 'menu_category';

    if p_action = 'category_delete' then
      before_value := before_value || jsonb_build_object(
        'item_count', (select count(*) from public.menu_items i where i.category_id = category_record.id)
      );
      delete from public.menu_categories where id = category_record.id;
    else
      clean_name := case when payload ? 'name' then nullif(trim(payload ->> 'name'), '') else category_record.name end;
      clean_description := case when payload ? 'description' then nullif(trim(payload ->> 'description'), '') else category_record.description end;
      if clean_name is null or char_length(clean_name) > 120 then
        raise exception 'Category name must be between 1 and 120 characters' using errcode = '22023';
      end if;
      if char_length(coalesce(clean_description, '')) > 500 then
        raise exception 'Category description must be 500 characters or fewer' using errcode = '22023';
      end if;
      if payload ? 'is_active' and jsonb_typeof(payload -> 'is_active') <> 'boolean' then
        raise exception 'Category active state must be true or false' using errcode = '22023';
      end if;

      update public.menu_categories
      set name = clean_name,
          description = clean_description,
          is_active = case when payload ? 'is_active' then (payload ->> 'is_active')::boolean else is_active end,
          updated_at = now()
      where id = category_record.id;
      select to_jsonb(c) into after_value from public.menu_categories c where c.id = category_record.id;
    end if;

  elsif p_action = 'item_create' then
    begin
      v_category_id := (payload ->> 'category_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'Choose a valid menu category' using errcode = '22023';
    end;
    if not exists (
      select 1 from public.menu_categories c where c.id = v_category_id and c.restaurant_id = p_restaurant_id
    ) then
      raise exception 'Menu category not found' using errcode = 'P0002';
    end if;
    clean_name := nullif(trim(payload ->> 'name'), '');
    clean_description := nullif(trim(payload ->> 'description'), '');
    if clean_name is null or char_length(clean_name) > 160 then
      raise exception 'Item name must be between 1 and 160 characters' using errcode = '22023';
    end if;
    if char_length(coalesce(clean_description, '')) > 1000 then
      raise exception 'Item description must be 1,000 characters or fewer' using errcode = '22023';
    end if;
    if jsonb_typeof(payload -> 'price_pence') <> 'number' or (payload ->> 'price_pence') !~ '^[0-9]+$' then
      raise exception 'Enter a valid item price' using errcode = '22023';
    end if;
    v_price_pence := (payload ->> 'price_pence')::integer;
    if v_price_pence > 10000000 then
      raise exception 'Item price is too high' using errcode = '22023';
    end if;
    if (payload ? 'is_vegetarian' and jsonb_typeof(payload -> 'is_vegetarian') <> 'boolean')
      or (payload ? 'is_vegan' and jsonb_typeof(payload -> 'is_vegan') <> 'boolean') then
      raise exception 'Dietary values must be true or false' using errcode = '22023';
    end if;
    v_is_vegan := coalesce((payload ->> 'is_vegan')::boolean, false);
    v_is_vegetarian := coalesce((payload ->> 'is_vegetarian')::boolean, false) or v_is_vegan;

    insert into public.menu_items (
      restaurant_id, category_id, name, description, price_pence,
      is_available, is_vegetarian, is_vegan, sort_order
    ) values (
      p_restaurant_id, v_category_id, clean_name, clean_description, v_price_pence,
      true, v_is_vegetarian, v_is_vegan,
      (select coalesce(max(i.sort_order), -1) + 1 from public.menu_items i where i.category_id = v_category_id)
    ) returning id into created_id;
    select to_jsonb(i) into after_value from public.menu_items i where i.id = created_id;
    target_type := 'menu_item';

  else
    select i.* into item_record
    from public.menu_items i
    where i.id = p_target_id and i.restaurant_id = p_restaurant_id
    for update;
    if item_record.id is null then
      raise exception 'Menu item not found' using errcode = 'P0002';
    end if;
    before_value := to_jsonb(item_record);
    created_id := item_record.id;
    target_type := 'menu_item';

    if p_action = 'item_delete' then
      delete from public.menu_items where id = item_record.id;
    else
      v_category_id := item_record.category_id;
      if payload ? 'category_id' then
        begin
          v_category_id := (payload ->> 'category_id')::uuid;
        exception when invalid_text_representation then
          raise exception 'Choose a valid menu category' using errcode = '22023';
        end;
        if not exists (
          select 1 from public.menu_categories c where c.id = v_category_id and c.restaurant_id = p_restaurant_id
        ) then
          raise exception 'Menu category not found' using errcode = 'P0002';
        end if;
      end if;
      clean_name := case when payload ? 'name' then nullif(trim(payload ->> 'name'), '') else item_record.name end;
      clean_description := case when payload ? 'description' then nullif(trim(payload ->> 'description'), '') else item_record.description end;
      v_price_pence := item_record.price_pence;
      if payload ? 'price_pence' then
        if jsonb_typeof(payload -> 'price_pence') <> 'number' or (payload ->> 'price_pence') !~ '^[0-9]+$' then
          raise exception 'Enter a valid item price' using errcode = '22023';
        end if;
        v_price_pence := (payload ->> 'price_pence')::integer;
      end if;
      if clean_name is null or char_length(clean_name) > 160 then
        raise exception 'Item name must be between 1 and 160 characters' using errcode = '22023';
      end if;
      if char_length(coalesce(clean_description, '')) > 1000 then
        raise exception 'Item description must be 1,000 characters or fewer' using errcode = '22023';
      end if;
      if v_price_pence > 10000000 then
        raise exception 'Item price is too high' using errcode = '22023';
      end if;
      if (payload ? 'is_available' and jsonb_typeof(payload -> 'is_available') <> 'boolean')
        or (payload ? 'is_vegetarian' and jsonb_typeof(payload -> 'is_vegetarian') <> 'boolean')
        or (payload ? 'is_vegan' and jsonb_typeof(payload -> 'is_vegan') <> 'boolean') then
        raise exception 'Menu status values must be true or false' using errcode = '22023';
      end if;
      v_is_available := case when payload ? 'is_available' then (payload ->> 'is_available')::boolean else item_record.is_available end;
      v_is_vegan := case when payload ? 'is_vegan' then (payload ->> 'is_vegan')::boolean else item_record.is_vegan end;
      v_is_vegetarian := case when payload ? 'is_vegetarian' then (payload ->> 'is_vegetarian')::boolean else item_record.is_vegetarian end;
      v_is_vegetarian := v_is_vegetarian or v_is_vegan;

      update public.menu_items
      set category_id = v_category_id,
          name = clean_name,
          description = clean_description,
          price_pence = v_price_pence,
          is_available = v_is_available,
          is_vegetarian = v_is_vegetarian,
          is_vegan = v_is_vegan,
          updated_at = now()
      where id = item_record.id;
      select to_jsonb(i) into after_value from public.menu_items i where i.id = item_record.id;
    end if;
  end if;

  insert into public.platform_admin_audit_log (actor_user_id, action, target_type, target_id, details)
  values (
    actor_id,
    'restaurant_menu_' || p_action,
    target_type,
    created_id,
    jsonb_build_object(
      'restaurant_id', p_restaurant_id,
      'restaurant_name', restaurant_name,
      'reason', clean_reason,
      'before', before_value,
      'after', after_value
    )
  );

  return jsonb_build_object(
    'restaurant_id', p_restaurant_id,
    'action', p_action,
    'target_type', target_type,
    'target_id', created_id,
    'value', after_value
  );
end;
$function$;

revoke all on function public.get_platform_restaurant_menu(uuid) from public, anon, authenticated;
revoke all on function public.set_platform_restaurant_accepting_orders(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.manage_platform_restaurant_menu(uuid, text, uuid, jsonb, text) from public, anon, authenticated;

grant execute on function public.get_platform_restaurant_menu(uuid) to authenticated;
grant execute on function public.set_platform_restaurant_accepting_orders(uuid, boolean, text) to authenticated;
grant execute on function public.manage_platform_restaurant_menu(uuid, text, uuid, jsonb, text) to authenticated;

commit;
