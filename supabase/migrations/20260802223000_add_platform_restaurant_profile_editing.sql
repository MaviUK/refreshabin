begin;

create or replace function public.get_platform_restaurant_profile(p_restaurant_id uuid)
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
    raise exception 'You do not have permission to view restaurant profiles' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', r.id,
    'name', r.name,
    'slug', r.slug,
    'email', r.email,
    'phone', r.phone,
    'cuisines', r.cuisines,
    'accepts_delivery', r.accepts_delivery,
    'accepts_collection', r.accepts_collection,
    'minimum_order_pence', r.minimum_order_pence,
    'delivery_fee_pence', r.delivery_fee_pence,
    'delivery_radius_miles', r.delivery_radius_miles,
    'delivery_preparation_time_minutes', r.delivery_preparation_time_minutes,
    'collection_preparation_time_minutes', r.collection_preparation_time_minutes,
    'free_delivery_threshold_pence', r.free_delivery_threshold_pence,
    'vat_registered', r.vat_registered,
    'vat_number', r.vat_number,
    'updated_at', r.updated_at,
    'location', coalesce((
      select jsonb_build_object(
        'id', l.id,
        'line1', l.line1,
        'line2', l.line2,
        'city', l.city,
        'postcode', l.postcode
      )
      from public.restaurant_locations l
      where l.restaurant_id = r.id and l.is_active
      order by l.is_primary desc, l.created_at asc
      limit 1
    ), '{}'::jsonb),
    'opening_hours', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day_of_week', h.day_of_week,
        'is_closed', h.is_closed,
        'open_time', case when h.open_time is null then null else to_char(h.open_time, 'HH24:MI') end,
        'close_time', case when h.close_time is null then null else to_char(h.close_time, 'HH24:MI') end
      ) order by case when h.day_of_week = 0 then 7 else h.day_of_week end)
      from public.opening_hours h
      join public.restaurant_locations l on l.id = h.location_id
      where l.restaurant_id = r.id and l.is_active
        and l.id = (
          select l2.id
          from public.restaurant_locations l2
          where l2.restaurant_id = r.id and l2.is_active
          order by l2.is_primary desc, l2.created_at asc
          limit 1
        )
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

create or replace function public.update_platform_restaurant_profile(
  p_restaurant_id uuid,
  p_payload jsonb,
  p_reason text,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := (select auth.uid());
  payload jsonb := coalesce(p_payload, '{}'::jsonb);
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
  restaurant_record public.restaurants%rowtype;
  location_record public.restaurant_locations%rowtype;
  before_value jsonb;
  after_value jsonb;
  clean_name text;
  clean_email text;
  clean_phone text;
  clean_line1 text;
  clean_line2 text;
  clean_city text;
  clean_postcode text;
  clean_vat_number text;
  v_cuisines text[];
  v_accepts_delivery boolean;
  v_accepts_collection boolean;
  v_minimum_order_pence integer;
  v_delivery_fee_pence integer;
  v_delivery_radius_miles numeric;
  v_delivery_minutes integer;
  v_collection_minutes integer;
  v_free_delivery_threshold_pence integer;
  v_vat_registered boolean;
  v_hours jsonb;
  hour_entry jsonb;
  v_day integer;
  v_is_closed boolean;
  v_open_time time;
  v_close_time time;
  seen_days integer[] := '{}';
begin
  if not private.has_platform_admin_permission('restaurants:manage') then
    raise exception 'You do not have permission to edit restaurant profiles' using errcode = '42501';
  end if;
  if jsonb_typeof(payload) <> 'object' then
    raise exception 'Restaurant profile must be an object' using errcode = '22023';
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
  if p_expected_updated_at is not null and restaurant_record.updated_at <> p_expected_updated_at then
    raise exception 'This restaurant changed since you opened it. Refresh and try again.' using errcode = '40001';
  end if;

  clean_name := nullif(trim(payload ->> 'name'), '');
  clean_email := nullif(lower(trim(payload ->> 'email')), '');
  clean_phone := nullif(trim(payload ->> 'phone'), '');
  clean_line1 := nullif(trim(payload #>> '{location,line1}'), '');
  clean_line2 := nullif(trim(payload #>> '{location,line2}'), '');
  clean_city := nullif(trim(payload #>> '{location,city}'), '');
  clean_postcode := nullif(upper(trim(payload #>> '{location,postcode}')), '');

  if clean_name is null or char_length(clean_name) < 2 or char_length(clean_name) > 120 then
    raise exception 'Restaurant name must be between 2 and 120 characters' using errcode = '22023';
  end if;
  if clean_email is null or char_length(clean_email) > 254 or clean_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'Enter a valid restaurant email address' using errcode = '22023';
  end if;
  if clean_phone is null or char_length(clean_phone) < 7 or char_length(clean_phone) > 30 then
    raise exception 'Enter a valid restaurant phone number' using errcode = '22023';
  end if;
  if clean_line1 is null or char_length(clean_line1) > 160
    or clean_city is null or char_length(clean_city) > 100
    or clean_postcode is null or char_length(clean_postcode) > 12
    or char_length(coalesce(clean_line2, '')) > 160 then
    raise exception 'Enter a valid full trading address' using errcode = '22023';
  end if;

  if jsonb_typeof(payload -> 'cuisines') <> 'array' then
    raise exception 'Choose at least one cuisine' using errcode = '22023';
  end if;
  select array_agg(distinct trim(value) order by trim(value))
  into v_cuisines
  from jsonb_array_elements_text(payload -> 'cuisines') as cuisine(value)
  where nullif(trim(value), '') is not null;
  if coalesce(cardinality(v_cuisines), 0) < 1 or cardinality(v_cuisines) > 10
    or exists (select 1 from unnest(v_cuisines) value where char_length(value) > 50) then
    raise exception 'Choose between 1 and 10 valid cuisines' using errcode = '22023';
  end if;

  if jsonb_typeof(payload -> 'accepts_delivery') <> 'boolean'
    or jsonb_typeof(payload -> 'accepts_collection') <> 'boolean'
    or jsonb_typeof(payload -> 'vat_registered') <> 'boolean' then
    raise exception 'Service and VAT settings must be true or false' using errcode = '22023';
  end if;
  v_accepts_delivery := (payload ->> 'accepts_delivery')::boolean;
  v_accepts_collection := (payload ->> 'accepts_collection')::boolean;
  v_vat_registered := (payload ->> 'vat_registered')::boolean;
  if not v_accepts_delivery and not v_accepts_collection then
    raise exception 'Enable delivery, collection, or both' using errcode = '22023';
  end if;

  begin
    v_minimum_order_pence := (payload ->> 'minimum_order_pence')::integer;
    v_delivery_fee_pence := (payload ->> 'delivery_fee_pence')::integer;
    v_delivery_radius_miles := (payload ->> 'delivery_radius_miles')::numeric;
    v_delivery_minutes := (payload ->> 'delivery_preparation_time_minutes')::integer;
    v_collection_minutes := (payload ->> 'collection_preparation_time_minutes')::integer;
    v_free_delivery_threshold_pence := case
      when payload -> 'free_delivery_threshold_pence' is null or jsonb_typeof(payload -> 'free_delivery_threshold_pence') = 'null' then null
      else (payload ->> 'free_delivery_threshold_pence')::integer
    end;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Enter valid order amounts, radius and preparation times' using errcode = '22023';
  end;

  if v_minimum_order_pence < 0 or v_minimum_order_pence > 10000000
    or v_delivery_fee_pence < 0 or v_delivery_fee_pence > 1000000 then
    raise exception 'Order amounts are outside the allowed range' using errcode = '22023';
  end if;
  if v_delivery_radius_miles < 0 or v_delivery_radius_miles > 100 then
    raise exception 'Delivery radius must be between 0 and 100 miles' using errcode = '22023';
  end if;
  if v_delivery_minutes < 5 or v_delivery_minutes > 480
    or v_collection_minutes < 5 or v_collection_minutes > 480 then
    raise exception 'Preparation times must be between 5 and 480 minutes' using errcode = '22023';
  end if;
  if v_free_delivery_threshold_pence is not null
    and (v_free_delivery_threshold_pence <= v_minimum_order_pence or v_free_delivery_threshold_pence > 10000000) then
    raise exception 'Free delivery threshold must be higher than the minimum order' using errcode = '22023';
  end if;

  clean_vat_number := nullif(upper(regexp_replace(coalesce(payload ->> 'vat_number', ''), '[[:space:]-]', '', 'g')), '');
  if v_vat_registered and (clean_vat_number is null or clean_vat_number !~ '^(GB)?[0-9]{9}([0-9]{3})?$') then
    raise exception 'Enter a valid UK VAT number' using errcode = '22023';
  end if;

  v_hours := payload -> 'opening_hours';
  if jsonb_typeof(v_hours) <> 'array' or jsonb_array_length(v_hours) <> 7 then
    raise exception 'Supply opening hours for all seven days' using errcode = '22023';
  end if;
  for hour_entry in select value from jsonb_array_elements(v_hours)
  loop
    begin
      v_day := (hour_entry ->> 'day_of_week')::integer;
      v_is_closed := (hour_entry ->> 'is_closed')::boolean;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Opening hours contain an invalid day or closed status' using errcode = '22023';
    end;
    if v_day < 0 or v_day > 6 or v_day = any(seen_days)
      or jsonb_typeof(hour_entry -> 'is_closed') <> 'boolean' then
      raise exception 'Opening hours must contain each day exactly once' using errcode = '22023';
    end if;
    seen_days := array_append(seen_days, v_day);
    if v_is_closed then
      v_open_time := null;
      v_close_time := null;
    else
      if coalesce(hour_entry ->> 'open_time', '') !~ '^[0-2][0-9]:[0-5][0-9]$'
        or coalesce(hour_entry ->> 'close_time', '') !~ '^[0-2][0-9]:[0-5][0-9]$' then
        raise exception 'Enter valid opening and closing times' using errcode = '22023';
      end if;
      begin
        v_open_time := (hour_entry ->> 'open_time')::time;
        v_close_time := (hour_entry ->> 'close_time')::time;
      exception when invalid_datetime_format or datetime_field_overflow then
        raise exception 'Enter valid opening and closing times' using errcode = '22023';
      end;
      if v_open_time = v_close_time then
        raise exception 'Opening and closing times must be different' using errcode = '22023';
      end if;
    end if;
  end loop;

  select l.* into location_record
  from public.restaurant_locations l
  where l.restaurant_id = p_restaurant_id and l.is_active
  order by l.is_primary desc, l.created_at asc
  limit 1
  for update;

  before_value := jsonb_build_object(
    'restaurant', to_jsonb(restaurant_record) - array['approval_notes','onboarding_step'],
    'location', case when location_record.id is null then null else to_jsonb(location_record) end,
    'opening_hours', coalesce((select jsonb_agg(to_jsonb(h) order by h.day_of_week) from public.opening_hours h where h.location_id = location_record.id), '[]'::jsonb)
  );

  update public.restaurants
  set name = clean_name,
      email = clean_email,
      phone = clean_phone,
      cuisines = v_cuisines,
      accepts_delivery = v_accepts_delivery,
      accepts_collection = v_accepts_collection,
      minimum_order_pence = v_minimum_order_pence,
      delivery_fee_pence = case when v_accepts_delivery then v_delivery_fee_pence else 0 end,
      delivery_radius_miles = case when v_accepts_delivery then v_delivery_radius_miles else 0 end,
      preparation_time_minutes = least(case when v_accepts_delivery then v_delivery_minutes else v_collection_minutes end, 240),
      delivery_preparation_time_minutes = v_delivery_minutes,
      collection_preparation_time_minutes = v_collection_minutes,
      free_delivery_threshold_pence = case when v_accepts_delivery then v_free_delivery_threshold_pence else null end,
      vat_registered = v_vat_registered,
      vat_number = case when v_vat_registered then clean_vat_number else null end,
      updated_at = now()
  where id = p_restaurant_id;

  if location_record.id is null then
    insert into public.restaurant_locations (
      restaurant_id, name, line1, line2, city, postcode, timezone, is_primary, is_active
    ) values (
      p_restaurant_id, 'Main location', clean_line1, clean_line2, clean_city, clean_postcode,
      'Europe/London', true, true
    ) returning * into location_record;
  else
    update public.restaurant_locations
    set line1 = clean_line1,
        line2 = clean_line2,
        city = clean_city,
        postcode = clean_postcode,
        latitude = case when (line1, line2, city, postcode) is distinct from (clean_line1, clean_line2, clean_city, clean_postcode) then null else latitude end,
        longitude = case when (line1, line2, city, postcode) is distinct from (clean_line1, clean_line2, clean_city, clean_postcode) then null else longitude end,
        is_primary = true,
        updated_at = now()
    where id = location_record.id
    returning * into location_record;
  end if;

  for hour_entry in select value from jsonb_array_elements(v_hours)
  loop
    v_day := (hour_entry ->> 'day_of_week')::integer;
    v_is_closed := (hour_entry ->> 'is_closed')::boolean;
    v_open_time := case when v_is_closed then null else (hour_entry ->> 'open_time')::time end;
    v_close_time := case when v_is_closed then null else (hour_entry ->> 'close_time')::time end;
    insert into public.opening_hours (location_id, day_of_week, is_closed, open_time, close_time, updated_at)
    values (location_record.id, v_day, v_is_closed, v_open_time, v_close_time, now())
    on conflict (location_id, day_of_week) do update
    set is_closed = excluded.is_closed,
        open_time = excluded.open_time,
        close_time = excluded.close_time,
        updated_at = now();
  end loop;

  select jsonb_build_object(
    'restaurant', to_jsonb(r) - array['approval_notes','onboarding_step'],
    'location', to_jsonb(location_record),
    'opening_hours', coalesce((select jsonb_agg(to_jsonb(h) order by h.day_of_week) from public.opening_hours h where h.location_id = location_record.id), '[]'::jsonb)
  ) into after_value
  from public.restaurants r
  where r.id = p_restaurant_id;

  insert into public.platform_admin_audit_log (actor_user_id, action, target_type, target_id, details)
  values (
    actor_id,
    'restaurant_profile_updated',
    'restaurant',
    p_restaurant_id,
    jsonb_build_object(
      'restaurant_name', clean_name,
      'reason', clean_reason,
      'before', before_value,
      'after', after_value
    )
  );

  return public.get_platform_restaurant_profile(p_restaurant_id);
end;
$function$;

revoke all on function public.get_platform_restaurant_profile(uuid) from public, anon, authenticated;
revoke all on function public.update_platform_restaurant_profile(uuid, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.get_platform_restaurant_profile(uuid) to authenticated;
grant execute on function public.update_platform_restaurant_profile(uuid, jsonb, text, timestamptz) to authenticated;

commit;
