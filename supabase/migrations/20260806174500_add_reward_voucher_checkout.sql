begin;

alter table public.orders
  add column if not exists reward_voucher_id uuid references public.customer_reward_vouchers(id) on delete set null,
  add column if not exists reward_discount_pence integer not null default 0 check (reward_discount_pence >= 0);

create unique index if not exists orders_reward_voucher_unique_idx
  on public.orders (reward_voucher_id)
  where reward_voucher_id is not null;

create or replace function public.get_checkout_reward_vouchers(p_restaurant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'voucher_id', v.id,
    'code', v.code,
    'reward_name', r.name,
    'reward_type', r.reward_type,
    'fixed_value_pence', r.fixed_value_pence,
    'percentage_basis_points', r.percentage_basis_points,
    'menu_item_id', r.menu_item_id,
    'minimum_order_pence', r.minimum_order_pence,
    'expires_at', v.expires_at
  ) order by v.created_at desc), '[]'::jsonb)
  into v_result
  from public.customer_reward_vouchers v
  join public.restaurant_loyalty_rewards r on r.id = v.reward_id
  where v.customer_user_id = v_user_id
    and v.restaurant_id = p_restaurant_id
    and (
      v.status = 'available'
      or (v.status = 'reserved' and v.reservation_expires_at <= now())
    )
    and (v.expires_at is null or v.expires_at > now());

  return v_result;
end;
$function$;

create or replace function public.reserve_order_reward_voucher(
  p_order_id uuid,
  p_voucher_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_voucher public.customer_reward_vouchers%rowtype;
  v_reward public.restaurant_loyalty_rewards%rowtype;
  v_discount integer := 0;
  v_item_discount integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id and customer_user_id = v_user_id
  for update;

  if not found then raise exception 'Order not found' using errcode = '42501'; end if;
  if v_order.order_status <> 'pending_payment' then raise exception 'Order is no longer awaiting payment'; end if;
  if v_order.reward_voucher_id is not null then raise exception 'A reward is already applied to this order'; end if;

  select * into v_voucher
  from public.customer_reward_vouchers
  where id = p_voucher_id
    and customer_user_id = v_user_id
    and restaurant_id = v_order.restaurant_id
  for update;

  if not found then raise exception 'Reward voucher not found'; end if;
  if v_voucher.expires_at is not null and v_voucher.expires_at <= now() then
    update public.customer_reward_vouchers set status = 'expired' where id = v_voucher.id;
    raise exception 'Reward voucher has expired';
  end if;
  if v_voucher.status = 'reserved' and v_voucher.reservation_expires_at > now() then
    raise exception 'Reward voucher is already reserved';
  end if;
  if v_voucher.status not in ('available','reserved') then raise exception 'Reward voucher is not available'; end if;

  select * into v_reward from public.restaurant_loyalty_rewards where id = v_voucher.reward_id;
  if not found then raise exception 'Reward is no longer available'; end if;
  if v_order.subtotal_pence < v_reward.minimum_order_pence then raise exception 'Minimum order value has not been reached'; end if;

  v_discount := case v_reward.reward_type
    when 'fixed_discount' then least(coalesce(v_reward.fixed_value_pence, 0), v_order.total_pence)
    when 'percentage_discount' then least(round(v_order.subtotal_pence * coalesce(v_reward.percentage_basis_points, 0) / 10000.0)::integer, v_order.total_pence)
    when 'free_delivery' then least(v_order.delivery_fee_pence, v_order.total_pence)
    when 'wallet_credit' then least(coalesce(v_reward.fixed_value_pence, 0), v_order.total_pence)
    when 'free_item' then 0
    else 0
  end;

  if v_reward.reward_type = 'free_item' then
    select coalesce(max(unit_price_pence), 0) into v_item_discount
    from public.order_items
    where order_id = v_order.id and menu_item_id = v_reward.menu_item_id;
    if v_item_discount <= 0 then raise exception 'The required reward item is not in this order'; end if;
    v_discount := least(v_item_discount, v_order.total_pence);
  end if;

  if v_discount <= 0 then raise exception 'This reward does not reduce the current order total'; end if;

  update public.customer_reward_vouchers
  set status = 'reserved',
      reserved_order_id = v_order.id,
      reserved_at = now(),
      reservation_expires_at = now() + interval '35 minutes'
  where id = v_voucher.id;

  update public.orders
  set reward_voucher_id = v_voucher.id,
      reward_discount_pence = v_discount,
      discount_pence = discount_pence + v_discount,
      total_pence = greatest(total_pence - v_discount, 0),
      restaurant_net_pence = greatest(restaurant_net_pence - v_discount, 0),
      updated_at = now()
  where id = v_order.id;

  return jsonb_build_object(
    'voucher_id', v_voucher.id,
    'reward_name', v_reward.name,
    'discount_pence', v_discount,
    'total_pence', greatest(v_order.total_pence - v_discount, 0),
    'reservation_expires_at', now() + interval '35 minutes'
  );
end;
$function$;

create or replace function public.finalize_order_reward_voucher(
  p_order_id uuid,
  p_consume boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order public.orders%rowtype;
  v_voucher public.customer_reward_vouchers%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.reward_voucher_id is null then return; end if;

  select * into v_voucher
  from public.customer_reward_vouchers
  where id = v_order.reward_voucher_id
  for update;
  if not found then return; end if;

  if p_consume then
    if v_voucher.status = 'redeemed' then return; end if;
    update public.customer_reward_vouchers
    set status = 'redeemed', redeemed_order_id = v_order.id, redeemed_at = now(),
        reserved_order_id = null, reserved_at = null, reservation_expires_at = null
    where id = v_voucher.id;

    insert into public.customer_reward_redemptions(
      voucher_id, reward_id, restaurant_id, customer_user_id,
      order_id, points_spent, discount_pence
    ) values (
      v_voucher.id, v_voucher.reward_id, v_voucher.restaurant_id,
      v_voucher.customer_user_id, v_order.id, v_voucher.points_spent,
      v_order.reward_discount_pence
    ) on conflict (voucher_id) do nothing;
  elsif v_voucher.status = 'reserved' and v_voucher.reserved_order_id = v_order.id then
    update public.customer_reward_vouchers
    set status = 'available', reserved_order_id = null, reserved_at = null,
        reservation_expires_at = null
    where id = v_voucher.id;
  end if;
end;
$function$;

create or replace function public.process_order_reward_voucher_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.reward_voucher_id is null then return new; end if;

  if new.payment_status in ('paid','authorized','partially_refunded','refunded')
     and old.payment_status is distinct from new.payment_status then
    perform public.finalize_order_reward_voucher(new.id, true);
  elsif new.payment_status in ('failed','cancelled')
     and old.payment_status is distinct from new.payment_status then
    perform public.finalize_order_reward_voucher(new.id, false);
  end if;
  return new;
end;
$function$;

drop trigger if exists orders_reward_voucher_status_trigger on public.orders;
create trigger orders_reward_voucher_status_trigger
after update of payment_status on public.orders
for each row execute function public.process_order_reward_voucher_status();

create or replace function public.release_expired_reward_voucher_reservations(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_count integer;
begin
  with released as (
    update public.customer_reward_vouchers
    set status = 'available', reserved_order_id = null, reserved_at = null,
        reservation_expires_at = null
    where id in (
      select id from public.customer_reward_vouchers
      where status = 'reserved' and reservation_expires_at <= now()
      order by reservation_expires_at
      limit least(greatest(p_limit, 1), 1000)
      for update skip locked
    )
    returning 1
  ) select count(*) into v_count from released;
  return v_count;
end;
$function$;

revoke all on function public.get_checkout_reward_vouchers(uuid) from public, anon, authenticated;
revoke all on function public.reserve_order_reward_voucher(uuid,uuid) from public, anon, authenticated;
revoke all on function public.finalize_order_reward_voucher(uuid,boolean) from public, anon, authenticated;
revoke all on function public.release_expired_reward_voucher_reservations(integer) from public, anon, authenticated;
grant execute on function public.get_checkout_reward_vouchers(uuid) to authenticated;
grant execute on function public.reserve_order_reward_voucher(uuid,uuid) to authenticated;
grant execute on function public.finalize_order_reward_voucher(uuid,boolean) to service_role;
grant execute on function public.release_expired_reward_voucher_reservations(integer) to service_role;

commit;
