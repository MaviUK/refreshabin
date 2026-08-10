begin;

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
  delivery_instructions text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_restaurant public.restaurants%rowtype;
  created_order public.orders%rowtype;
  requested_item jsonb;
  menu_item_record public.menu_items%rowtype;
  requested_quantity integer;
  calculated_subtotal integer := 0;
  calculated_delivery_fee integer := 0;
  calculated_total integer := 0;
  normalised_postcode text;
  item_count integer := 0;
begin
  if storefront_slug is null or trim(storefront_slug) = '' then
    raise exception 'Restaurant slug is required.';
  end if;

  if fulfilment_method not in ('delivery', 'collection') then
    raise exception 'Invalid fulfilment method.';
  end if;

  if nullif(trim(customer_first_name), '') is null
    or nullif(trim(customer_last_name), '') is null
    or nullif(trim(customer_email), '') is null
    or nullif(trim(customer_phone), '') is null then
    raise exception 'Customer details are incomplete.';
  end if;

  if basket_items is null
    or jsonb_typeof(basket_items) <> 'array'
    or jsonb_array_length(basket_items) = 0 then
    raise exception 'Basket is empty.';
  end if;

  select *
  into selected_restaurant
  from public.restaurants
  where slug = storefront_slug
  limit 1;

  if not found then
    raise exception 'Restaurant not found.';
  end if;

  if fulfilment_method = 'delivery' and not coalesce(selected_restaurant.accepts_delivery, false) then
    raise exception 'This restaurant is not accepting delivery orders.';
  end if;

  if fulfilment_method = 'collection' and not coalesce(selected_restaurant.accepts_collection, false) then
    raise exception 'This restaurant is not accepting collection orders.';
  end if;

  normalised_postcode := upper(regexp_replace(coalesce(postcode, ''), '\s+', '', 'g'));

  if fulfilment_method = 'delivery' then
    if nullif(trim(address_line_1), '') is null
      or nullif(trim(town_city), '') is null
      or normalised_postcode = '' then
      raise exception 'A complete delivery address is required.';
    end if;

    if not exists (
      select 1
      from public.restaurant_service_postcodes service_postcode
      where service_postcode.restaurant_id = selected_restaurant.id
        and upper(regexp_replace(service_postcode.postcode, '\s+', '', 'g')) = normalised_postcode
    ) and exists (
      select 1
      from public.restaurant_service_postcodes service_postcode
      where service_postcode.restaurant_id = selected_restaurant.id
    ) then
      raise exception 'This postcode is outside the restaurant delivery area.';
    end if;
  end if;

  for requested_item in
    select value from jsonb_array_elements(basket_items)
  loop
    requested_quantity := coalesce((requested_item ->> 'quantity')::integer, 0);

    if requested_quantity <= 0 or requested_quantity > 100 then
      raise exception 'Invalid item quantity.';
    end if;

    select *
    into menu_item_record
    from public.menu_items
    where id = (requested_item ->> 'id')::uuid
      and restaurant_id = selected_restaurant.id
      and coalesce(is_active, true)
    limit 1;

    if not found then
      raise exception 'One or more basket items are unavailable.';
    end if;

    calculated_subtotal := calculated_subtotal + (menu_item_record.price_pence * requested_quantity);
    item_count := item_count + requested_quantity;
  end loop;

  if item_count <= 0 then
    raise exception 'Basket is empty.';
  end if;

  if calculated_subtotal < coalesce(selected_restaurant.minimum_order_pence, 0) then
    raise exception 'The order does not meet the restaurant minimum order value.';
  end if;

  if fulfilment_method = 'delivery'
    and (
      selected_restaurant.free_delivery_threshold_pence is null
      or calculated_subtotal < selected_restaurant.free_delivery_threshold_pence
    ) then
    calculated_delivery_fee := coalesce(selected_restaurant.delivery_fee_pence, 0);
  end if;

  calculated_total := calculated_subtotal + calculated_delivery_fee;

  insert into public.orders (
    restaurant_id,
    customer_user_id,
    customer_first_name,
    customer_last_name,
    customer_email,
    customer_phone,
    fulfilment_method,
    address_line_1,
    address_line_2,
    town_city,
    postcode,
    delivery_instructions,
    subtotal_pence,
    delivery_fee_pence,
    discount_pence,
    total_pence,
    payment_status,
    order_status
  ) values (
    selected_restaurant.id,
    auth.uid(),
    trim(customer_first_name),
    trim(customer_last_name),
    lower(trim(customer_email)),
    trim(customer_phone),
    fulfilment_method,
    case when fulfilment_method = 'delivery' then trim(address_line_1) else null end,
    case when fulfilment_method = 'delivery' then nullif(trim(address_line_2), '') else null end,
    case when fulfilment_method = 'delivery' then trim(town_city) else null end,
    case when fulfilment_method = 'delivery' then upper(trim(postcode)) else null end,
    nullif(trim(delivery_instructions), ''),
    calculated_subtotal,
    calculated_delivery_fee,
    0,
    calculated_total,
    'pending',
    'pending_payment'
  )
  returning * into created_order;

  for requested_item in
    select value from jsonb_array_elements(basket_items)
  loop
    requested_quantity := (requested_item ->> 'quantity')::integer;

    select *
    into menu_item_record
    from public.menu_items
    where id = (requested_item ->> 'id')::uuid
      and restaurant_id = selected_restaurant.id
      and coalesce(is_active, true)
    limit 1;

    insert into public.order_items (
      order_id,
      menu_item_id,
      item_name,
      unit_price_pence,
      quantity,
      customer_notes,
      item_snapshot
    ) values (
      created_order.id,
      menu_item_record.id,
      menu_item_record.name,
      menu_item_record.price_pence,
      requested_quantity,
      nullif(trim(requested_item ->> 'notes'), ''),
      jsonb_build_object(
        'name', menu_item_record.name,
        'price_pence', menu_item_record.price_pence,
        'image_url', menu_item_record.image_url
      )
    );
  end loop;

  return jsonb_build_object(
    'order_id', created_order.id,
    'order_number', created_order.order_number,
    'restaurant_id', selected_restaurant.id,
    'restaurant_name', selected_restaurant.name,
    'subtotal_pence', calculated_subtotal,
    'delivery_fee_pence', calculated_delivery_fee,
    'total_pence', calculated_total,
    'currency', 'gbp',
    'payment_status', created_order.payment_status,
    'order_status', created_order.order_status
  );
exception
  when invalid_text_representation then
    raise exception 'Basket contains an invalid item.';
end;
$$;

revoke all on function public.create_order(
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  text
) from public;

grant execute on function public.create_order(
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  text
) to anon, authenticated;

comment on function public.create_order is
  'Creates a pending-payment order using server-side menu prices and restaurant delivery rules. Stripe payment must be completed by a trusted server-side integration.';

commit;
