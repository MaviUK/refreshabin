begin;

create or replace function public.reserve_order_balances(
  p_order_id uuid,
  p_gift_card_code text default null,
  p_use_credit_pence integer default 0
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  o public.orders%rowtype;
  card public.restaurant_gift_cards%rowtype;
  credit public.customer_credit_accounts%rowtype;
  reserved integer;
  gift_use integer := 0;
  credit_use integer := 0;
  remaining integer;
  reward_id uuid;
  reward_result jsonb;
  raw_code text := nullif(trim(p_gift_card_code), '');
  actual_gift_code text;
begin
  select * into o
  from public.orders
  where id = p_order_id
    and customer_user_id = auth.uid()
    and order_status = 'pending_payment'
  for update;

  if not found then
    raise exception 'Order is not available for balance redemption' using errcode = '42501';
  end if;

  if raw_code like 'REWARD:%|GIFT:%' then
    reward_id := split_part(split_part(raw_code, '|', 1), ':', 2)::uuid;
    actual_gift_code := nullif(split_part(raw_code, '|GIFT:', 2), '');
    reward_result := public.reserve_order_reward_voucher(o.id, reward_id);
    select * into o from public.orders where id = p_order_id for update;
  else
    actual_gift_code := raw_code;
  end if;

  delete from public.checkout_balance_reservations
  where order_id = o.id and status = 'reserved';

  remaining := o.total_pence;

  if actual_gift_code is not null then
    select * into card
    from public.restaurant_gift_cards
    where restaurant_id = o.restaurant_id
      and upper(code) = upper(trim(actual_gift_code))
      and is_active
      and remaining_value_pence > 0
      and (expires_at is null or expires_at > now())
    for update;

    if not found then raise exception 'Gift card is invalid, empty or expired'; end if;

    select coalesce(sum(amount_pence), 0) into reserved
    from public.checkout_balance_reservations
    where gift_card_id = card.id and status = 'reserved' and expires_at > now();

    gift_use := least(remaining, greatest(card.remaining_value_pence - reserved, 0));
    if gift_use > 0 then
      insert into public.checkout_balance_reservations(order_id, restaurant_id, reservation_type, gift_card_id, amount_pence)
      values(o.id, o.restaurant_id, 'gift_card', card.id, gift_use);
    end if;
    remaining := remaining - gift_use;
  end if;

  if p_use_credit_pence > 0 and remaining > 0 then
    select * into credit
    from public.customer_credit_accounts
    where restaurant_id = o.restaurant_id and customer_user_id = auth.uid()
    for update;

    if found then
      select coalesce(sum(amount_pence), 0) into reserved
      from public.checkout_balance_reservations
      where credit_account_id = credit.id and status = 'reserved' and expires_at > now();

      credit_use := least(remaining, p_use_credit_pence, greatest(credit.balance_pence - reserved, 0));
      if credit_use > 0 then
        insert into public.checkout_balance_reservations(order_id, restaurant_id, reservation_type, credit_account_id, amount_pence)
        values(o.id, o.restaurant_id, 'customer_credit', credit.id, credit_use);
      end if;
    end if;
  end if;

  update public.orders
  set gift_card_used_pence = gift_use,
      customer_credit_used_pence = credit_use,
      total_pence = greatest(total_pence - gift_use - credit_use, 0)
  where id = o.id;

  return jsonb_build_object(
    'gift_card_used_pence', gift_use,
    'customer_credit_used_pence', credit_use,
    'reward_discount_pence', coalesce((reward_result ->> 'discount_pence')::integer, 0),
    'reward_name', reward_result ->> 'reward_name',
    'total_pence', greatest(o.total_pence - gift_use - credit_use, 0)
  );
end;
$function$;

revoke all on function public.reserve_order_balances(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.reserve_order_balances(uuid, text, integer) to authenticated;

commit;
