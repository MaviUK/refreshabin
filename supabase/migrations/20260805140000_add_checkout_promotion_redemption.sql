begin;

create or replace function public.create_order_with_promotion(
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
  requested_fulfilment_at timestamptz default null,
  promotion_code text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  created jsonb;
  order_row public.orders%rowtype;
  validation jsonb;
  discount integer := 0;
  restaurant_gross integer;
  commission integer;
  commission_vat integer;
begin
  created := public.create_order(
    storefront_slug, fulfilment_method, customer_first_name, customer_last_name,
    customer_email, customer_phone, basket_items, address_line_1, address_line_2,
    town_city, postcode, delivery_instructions, requested_fulfilment_at
  );

  if nullif(trim(promotion_code), '') is null then
    return created;
  end if;

  select * into order_row
  from public.orders
  where id = (created->>'order_id')::uuid
  for update;

  validation := public.validate_restaurant_promotion(
    order_row.restaurant_id,
    promotion_code,
    order_row.subtotal_pence,
    order_row.delivery_fee_pence,
    order_row.fulfilment_method,
    order_row.customer_email
  );

  if not coalesce((validation->>'valid')::boolean, false) then
    raise exception '%', coalesce(validation->>'error', 'Promotion code could not be applied.');
  end if;

  discount := greatest(coalesce((validation->>'discount_pence')::integer, 0), 0);
  restaurant_gross := greatest(order_row.subtotal_pence + order_row.delivery_fee_pence - discount, 0);
  commission := round(restaurant_gross * order_row.platform_commission_basis_points / 10000.0);
  commission_vat := case when order_row.platform_commission_pence > 0
    then round(commission * order_row.platform_commission_vat_pence / order_row.platform_commission_pence::numeric)
    else 0 end;

  update public.orders
  set promotion_id = (validation->>'promotion_id')::uuid,
      promotion_code = validation->>'code',
      discount_pence = discount,
      total_pence = greatest(subtotal_pence + delivery_fee_pence + service_fee_pence - discount, 0),
      platform_commission_pence = commission,
      platform_commission_vat_pence = commission_vat,
      restaurant_net_pence = greatest(restaurant_gross - commission - commission_vat, 0)
  where id = order_row.id
  returning * into order_row;

  return created || jsonb_build_object(
    'discount_pence', order_row.discount_pence,
    'promotion_code', order_row.promotion_code,
    'total_pence', order_row.total_pence,
    'restaurant_net_pence', order_row.restaurant_net_pence
  );
end;
$function$;

revoke all on function public.create_order_with_promotion(text,text,text,text,text,text,jsonb,text,text,text,text,text,timestamptz,text) from public;
grant execute on function public.create_order_with_promotion(text,text,text,text,text,text,jsonb,text,text,text,text,text,timestamptz,text) to anon, authenticated;

create or replace function public.record_order_promotion_redemption(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  order_row public.orders%rowtype;
begin
  select * into order_row from public.orders where id = p_order_id for update;
  if not found or order_row.promotion_id is null or order_row.discount_pence <= 0 then return; end if;

  insert into public.promotion_redemptions(
    promotion_id, restaurant_id, order_id, customer_user_id, customer_email, discount_pence
  ) values (
    order_row.promotion_id, order_row.restaurant_id, order_row.id,
    order_row.customer_user_id, order_row.customer_email, order_row.discount_pence
  ) on conflict do nothing;

  if found then
    update public.restaurant_promotions
    set redemption_count = redemption_count + 1, updated_at = now()
    where id = order_row.promotion_id;
  end if;
end;
$function$;

create unique index if not exists promotion_redemptions_order_unique
  on public.promotion_redemptions(order_id)
  where order_id is not null;

revoke all on function public.record_order_promotion_redemption(uuid) from public, anon, authenticated;
grant execute on function public.record_order_promotion_redemption(uuid) to service_role;

commit;
