begin;

alter table public.orders
  add column if not exists cancellation_reason text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_cancellation_reason_length_check'
  ) then
    alter table public.orders
      add constraint orders_cancellation_reason_length_check
      check (
        cancellation_reason is null
        or char_length(trim(cancellation_reason)) between 3 and 500
      );
  end if;
end;
$$;

create or replace function public.get_platform_order_cancellation_context(
  p_order_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = p_actor_user_id
      and pa.is_active
      and 'orders:manage' = any(private.platform_admin_permissions(pa.role))
  ) then
    raise exception 'You do not have permission to cancel orders' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', o.id,
    'order_number', o.order_number,
    'restaurant_id', o.restaurant_id,
    'restaurant_name', r.name,
    'order_status', o.order_status,
    'payment_status', o.payment_status,
    'stripe_payment_intent_id', o.stripe_payment_intent_id,
    'restaurant_payout_mode', o.restaurant_payout_mode,
    'total_pence', o.total_pence,
    'currency', o.currency,
    'reward_voucher_id', o.reward_voucher_id
  )
  into result
  from public.orders o
  join public.restaurants r on r.id = o.restaurant_id
  where o.id = p_order_id;

  if result is null then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  if (result ->> 'order_status') in ('completed', 'cancelled', 'rejected') then
    raise exception 'This order can no longer be cancelled' using errcode = '22023';
  end if;

  return result;
end;
$function$;

create or replace function public.finalize_platform_order_cancellation(
  p_order_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_payment_status text default null,
  p_stripe_refund_id text default null,
  p_stripe_refund_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  order_row public.orders%rowtype;
  balance_row public.checkout_balance_reservations%rowtype;
  clean_reason text := trim(coalesce(p_reason, ''));
  previous_status text;
  previous_payment_status text;
  effective_payment_status text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = p_actor_user_id
      and pa.is_active
      and 'orders:manage' = any(private.platform_admin_permissions(pa.role))
  ) then
    raise exception 'You do not have permission to cancel orders' using errcode = '42501';
  end if;

  if char_length(clean_reason) < 3 or char_length(clean_reason) > 500 then
    raise exception 'Cancellation reason must be between 3 and 500 characters' using errcode = '22023';
  end if;

  if p_payment_status is not null
     and p_payment_status not in ('pending', 'requires_action', 'authorized', 'paid', 'failed', 'cancelled', 'refunded', 'partially_refunded') then
    raise exception 'Invalid payment status' using errcode = '22023';
  end if;

  select *
  into order_row
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  if order_row.order_status = 'cancelled' then
    return jsonb_build_object(
      'id', order_row.id,
      'order_number', order_row.order_number,
      'order_status', order_row.order_status,
      'payment_status', order_row.payment_status,
      'already_cancelled', true
    );
  end if;

  if order_row.order_status = 'rejected' then
    raise exception 'Rejected orders cannot be cancelled' using errcode = '22023';
  end if;

  previous_status := order_row.order_status;
  previous_payment_status := order_row.payment_status;
  effective_payment_status := coalesce(p_payment_status, order_row.payment_status);

  for balance_row in
    select *
    from public.checkout_balance_reservations
    where order_id = p_order_id
      and status in ('reserved', 'consumed')
    order by created_at, id
    for update
  loop
    if balance_row.status = 'consumed' then
      if balance_row.reservation_type = 'gift_card' and balance_row.gift_card_id is not null then
        update public.restaurant_gift_cards
        set remaining_value_pence = least(original_value_pence, remaining_value_pence + balance_row.amount_pence),
            redeemed_at = case
              when least(original_value_pence, remaining_value_pence + balance_row.amount_pence) > 0 then null
              else redeemed_at
            end
        where id = balance_row.gift_card_id;
      elsif balance_row.reservation_type = 'customer_credit' and balance_row.credit_account_id is not null then
        update public.customer_credit_accounts
        set balance_pence = balance_pence + balance_row.amount_pence,
            updated_at = now()
        where id = balance_row.credit_account_id;

        insert into public.customer_credit_ledger (
          credit_account_id,
          restaurant_id,
          customer_user_id,
          order_id,
          amount_pence,
          entry_type,
          note
        )
        select
          balance_row.credit_account_id,
          balance_row.restaurant_id,
          o.customer_user_id,
          o.id,
          balance_row.amount_pence,
          'refund_credit',
          'Restored after platform cancellation of order #' || o.order_number
        from public.orders o
        where o.id = p_order_id;
      end if;
    end if;

    update public.checkout_balance_reservations
    set status = 'released',
        released_at = coalesce(released_at, now())
    where id = balance_row.id;
  end loop;

  if order_row.reward_voucher_id is not null then
    delete from public.customer_reward_redemptions
    where voucher_id = order_row.reward_voucher_id
      and order_id = order_row.id;

    update public.customer_reward_vouchers
    set status = case
          when expires_at is not null and expires_at <= now() then 'expired'
          else 'available'
        end,
        reserved_order_id = null,
        reserved_at = null,
        reservation_expires_at = null,
        redeemed_order_id = null,
        redeemed_at = null
    where id = order_row.reward_voucher_id
      and (
        (status = 'reserved' and reserved_order_id = order_row.id)
        or (status = 'redeemed' and redeemed_order_id = order_row.id)
      );
  end if;

  delete from public.promotion_redemptions
  where order_id = order_row.id;

  update public.orders
  set order_status = 'cancelled',
      payment_status = effective_payment_status,
      cancellation_reason = clean_reason,
      cancelled_at = coalesce(cancelled_at, now()),
      manual_payout_status = 'not_applicable',
      updated_at = now()
  where id = order_row.id;

  update public.order_status_history h
  set changed_by = p_actor_user_id,
      note = clean_reason
  where h.id = (
    select h2.id
    from public.order_status_history h2
    where h2.order_id = order_row.id
      and h2.to_status = 'cancelled'
    order by h2.created_at desc, h2.id desc
    limit 1
  );

  insert into public.platform_admin_audit_log (
    actor_user_id,
    action,
    target_type,
    target_id,
    details
  ) values (
    p_actor_user_id,
    'order_cancelled_by_platform_admin',
    'order',
    order_row.id,
    jsonb_build_object(
      'order_number', order_row.order_number,
      'reason', clean_reason,
      'previous_order_status', previous_status,
      'previous_payment_status', previous_payment_status,
      'payment_status', effective_payment_status,
      'stripe_refund_id', p_stripe_refund_id,
      'stripe_refund_status', p_stripe_refund_status
    )
  );

  return jsonb_build_object(
    'id', order_row.id,
    'order_number', order_row.order_number,
    'order_status', 'cancelled',
    'payment_status', effective_payment_status,
    'cancellation_reason', clean_reason,
    'stripe_refund_id', p_stripe_refund_id,
    'stripe_refund_status', p_stripe_refund_status,
    'already_cancelled', false
  );
end;
$function$;

revoke all on function public.get_platform_order_cancellation_context(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_platform_order_cancellation_context(uuid, uuid) to service_role;

revoke all on function public.finalize_platform_order_cancellation(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.finalize_platform_order_cancellation(uuid, uuid, text, text, text, text) to service_role;

notify pgrst, 'reload schema';

commit;
