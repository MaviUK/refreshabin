begin;

create or replace function public.reserve_order_balances(
  p_order_id uuid,
  p_gift_card_code text default null,
  p_use_credit_pence integer default 0
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  o public.orders%rowtype;
  card public.restaurant_gift_cards%rowtype;
  credit public.customer_credit_accounts%rowtype;
  reserved integer;
  gift_use integer := 0;
  credit_use integer := 0;
  base_total integer;
  remaining integer;
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

  if p_use_credit_pence < 0 then
    raise exception 'Credit amount cannot be negative';
  end if;

  base_total := o.total_pence
    + coalesce(o.gift_card_used_pence, 0)
    + coalesce(o.customer_credit_used_pence, 0);

  delete from public.checkout_balance_reservations
  where order_id = o.id
    and status = 'reserved';

  remaining := base_total;

  if nullif(trim(p_gift_card_code), '') is not null then
    select * into card
    from public.restaurant_gift_cards
    where restaurant_id = o.restaurant_id
      and upper(code) = upper(trim(p_gift_card_code))
      and is_active
      and remaining_value_pence > 0
      and (expires_at is null or expires_at > now())
    for update;

    if not found then
      raise exception 'Gift card is invalid, empty or expired';
    end if;

    select coalesce(sum(amount_pence), 0) into reserved
    from public.checkout_balance_reservations
    where gift_card_id = card.id
      and status = 'reserved'
      and expires_at > now();

    gift_use := least(remaining, greatest(card.remaining_value_pence - reserved, 0));

    if gift_use > 0 then
      insert into public.checkout_balance_reservations (
        order_id, restaurant_id, reservation_type, gift_card_id, amount_pence
      ) values (
        o.id, o.restaurant_id, 'gift_card', card.id, gift_use
      );
    end if;

    remaining := remaining - gift_use;
  end if;

  if p_use_credit_pence > 0 and remaining > 0 then
    select * into credit
    from public.customer_credit_accounts
    where restaurant_id = o.restaurant_id
      and customer_user_id = auth.uid()
    for update;

    if found then
      select coalesce(sum(amount_pence), 0) into reserved
      from public.checkout_balance_reservations
      where credit_account_id = credit.id
        and status = 'reserved'
        and expires_at > now();

      credit_use := least(
        remaining,
        p_use_credit_pence,
        greatest(credit.balance_pence - reserved, 0)
      );

      if credit_use > 0 then
        insert into public.checkout_balance_reservations (
          order_id, restaurant_id, reservation_type, credit_account_id, amount_pence
        ) values (
          o.id, o.restaurant_id, 'customer_credit', credit.id, credit_use
        );
      end if;
    end if;
  end if;

  update public.orders
  set gift_card_used_pence = gift_use,
      customer_credit_used_pence = credit_use,
      total_pence = greatest(base_total - gift_use - credit_use, 0)
  where id = o.id;

  return jsonb_build_object(
    'gift_card_used_pence', gift_use,
    'customer_credit_used_pence', credit_use,
    'total_pence', greatest(base_total - gift_use - credit_use, 0)
  );
end;
$function$;

revoke all on function public.reserve_order_balances(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_order_balances(uuid, text, integer)
  to authenticated;

create or replace function private.finalize_checkout_balances_on_payment_change()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
begin
  if new.payment_status is not distinct from old.payment_status then
    return new;
  end if;

  if new.payment_status = 'paid' then
    perform public.finalize_order_balance_reservations(new.id, true);
  elsif new.payment_status in ('failed', 'cancelled') then
    perform public.finalize_order_balance_reservations(new.id, false);
  end if;

  return new;
end;
$function$;

revoke all on function private.finalize_checkout_balances_on_payment_change()
  from public, anon, authenticated;

drop trigger if exists finalize_checkout_balances_after_payment_change on public.orders;
create trigger finalize_checkout_balances_after_payment_change
after update of payment_status on public.orders
for each row
when (old.payment_status is distinct from new.payment_status)
execute function private.finalize_checkout_balances_on_payment_change();

create or replace function public.release_expired_checkout_balance_reservations(
  p_limit integer default 500
) returns integer
language plpgsql security definer set search_path = ''
as $function$
declare
  released_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  with expired as (
    select id
    from public.checkout_balance_reservations
    where status = 'reserved'
      and expires_at <= now()
    order by expires_at
    limit greatest(1, least(coalesce(p_limit, 500), 2000))
    for update skip locked
  )
  update public.checkout_balance_reservations r
  set status = 'released',
      released_at = now()
  from expired
  where r.id = expired.id;

  get diagnostics released_count = row_count;
  return released_count;
end;
$function$;

revoke all on function public.release_expired_checkout_balance_reservations(integer)
  from public, anon, authenticated;
grant execute on function public.release_expired_checkout_balance_reservations(integer)
  to service_role;

commit;
