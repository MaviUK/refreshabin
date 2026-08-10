begin;

alter table public.restaurants
  add column if not exists delivery_preparation_time_minutes integer,
  add column if not exists collection_preparation_time_minutes integer;

update public.restaurants
set
  delivery_preparation_time_minutes = coalesce(delivery_preparation_time_minutes, preparation_time_minutes, 30),
  collection_preparation_time_minutes = coalesce(collection_preparation_time_minutes, preparation_time_minutes, 20)
where delivery_preparation_time_minutes is null
   or collection_preparation_time_minutes is null;

alter table public.restaurants
  alter column delivery_preparation_time_minutes set default 30,
  alter column delivery_preparation_time_minutes set not null,
  alter column collection_preparation_time_minutes set default 20,
  alter column collection_preparation_time_minutes set not null;

alter table public.restaurants
  drop constraint if exists restaurants_delivery_preparation_time_minutes_check,
  drop constraint if exists restaurants_collection_preparation_time_minutes_check,
  add constraint restaurants_delivery_preparation_time_minutes_check
    check (delivery_preparation_time_minutes between 5 and 480),
  add constraint restaurants_collection_preparation_time_minutes_check
    check (collection_preparation_time_minutes between 5 and 480);

alter table public.orders
  add column if not exists requested_fulfilment_at timestamptz;

comment on column public.restaurants.delivery_preparation_time_minutes is
  'Default customer-facing delivery estimate in minutes.';
comment on column public.restaurants.collection_preparation_time_minutes is
  'Default customer-facing collection estimate in minutes.';
comment on column public.orders.requested_fulfilment_at is
  'Optional later fulfilment time selected by the customer at checkout.';

create or replace function public.get_public_fulfilment_settings(storefront_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'delivery_preparation_time_minutes', r.delivery_preparation_time_minutes,
    'collection_preparation_time_minutes', r.collection_preparation_time_minutes
  )
  from public.restaurants r
  where r.slug = storefront_slug
    and r.status = 'active'
  limit 1;
$function$;

revoke all on function public.get_public_fulfilment_settings(text) from public;
grant execute on function public.get_public_fulfilment_settings(text) to anon, authenticated;

-- Keep the full, already-deployed pricing and modifier validation in one internal
-- function. The new public wrapper adds scheduling validation without duplicating
-- that sensitive order calculation logic.
alter function public.create_order(
  text, text, text, text, text, text, jsonb,
  text, text, text, text, text
) rename to create_order_internal;

revoke all on function public.create_order_internal(
  text, text, text, text, text, text, jsonb,
  text, text, text, text, text
) from public, anon, authenticated;

create or replace function public.create_order(
  storefront_slug text,
  fulfilment_method text,
  customer_first_name text,
  customer_last_name text,
  customer_email text,
  customer_phone text,
  basket_items jsonb,
  address_line_1 text default null,
  address_line_2 text default null,
  town_city text default null,
  postcode text default null,
  delivery_instructions text default null,
  requested_fulfilment_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  selected_restaurant public.restaurants%rowtype;
  created_order jsonb;
  minimum_minutes integer;
  requested_local timestamp;
  requested_day integer;
  requested_time time;
  opening_hours_exist boolean;
  requested_time_is_open boolean;
begin
  select *
  into selected_restaurant
  from public.restaurants r
  where r.slug = storefront_slug
  limit 1;

  if not found then
    raise exception 'Restaurant not found.';
  end if;

  minimum_minutes := case fulfilment_method
    when 'delivery' then selected_restaurant.delivery_preparation_time_minutes
    when 'collection' then selected_restaurant.collection_preparation_time_minutes
    else null
  end;

  if requested_fulfilment_at is not null then
    if minimum_minutes is null then
      raise exception 'Invalid fulfilment method.';
    end if;

    if requested_fulfilment_at < current_timestamp + make_interval(mins => minimum_minutes) then
      raise exception 'Choose a time at least % minutes from now.', minimum_minutes;
    end if;

    if requested_fulfilment_at > current_timestamp + interval '7 days' then
      raise exception 'Choose a time within the next 7 days.';
    end if;

    requested_local := requested_fulfilment_at at time zone 'Europe/London';
    requested_day := extract(dow from requested_local)::integer;
    requested_time := requested_local::time;

    select exists (
      select 1
      from public.restaurant_locations l
      join public.opening_hours h on h.location_id = l.id
      where l.restaurant_id = selected_restaurant.id
        and l.is_primary = true
    ) into opening_hours_exist;

    select exists (
      select 1
      from public.restaurant_locations l
      join public.opening_hours h on h.location_id = l.id
      where l.restaurant_id = selected_restaurant.id
        and l.is_primary = true
        and h.day_of_week = requested_day
        and not h.is_closed
        and (
          (h.close_time > h.open_time and requested_time between h.open_time and h.close_time)
          or
          (h.close_time < h.open_time and (requested_time >= h.open_time or requested_time <= h.close_time))
        )
    ) into requested_time_is_open;

    if opening_hours_exist and not requested_time_is_open then
      raise exception 'Choose a time within the restaurant opening hours.';
    end if;
  end if;

  created_order := public.create_order_internal(
    storefront_slug,
    fulfilment_method,
    customer_first_name,
    customer_last_name,
    customer_email,
    customer_phone,
    basket_items,
    address_line_1,
    address_line_2,
    town_city,
    postcode,
    delivery_instructions
  );

  update public.orders
  set
    requested_fulfilment_at = create_order.requested_fulfilment_at,
    estimated_ready_at = coalesce(
      create_order.requested_fulfilment_at,
      current_timestamp + make_interval(mins => minimum_minutes)
    )
  where id = (created_order ->> 'order_id')::uuid;

  return created_order || jsonb_build_object(
    'requested_fulfilment_at', requested_fulfilment_at,
    'estimated_ready_at', coalesce(
      requested_fulfilment_at,
      current_timestamp + make_interval(mins => minimum_minutes)
    )
  );
end;
$function$;

revoke all on function public.create_order(
  text, text, text, text, text, text, jsonb,
  text, text, text, text, text, timestamptz
) from public;

grant execute on function public.create_order(
  text, text, text, text, text, text, jsonb,
  text, text, text, text, text, timestamptz
) to anon, authenticated;

comment on function public.create_order is
  'Creates a validated order and records either ASAP defaults or a later customer-requested fulfilment time.';

commit;
