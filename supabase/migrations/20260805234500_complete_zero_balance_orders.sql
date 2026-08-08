begin;

create or replace function public.complete_zero_balance_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  order_row public.orders%rowtype;
begin
  select * into order_row
  from public.orders
  where id = p_order_id
    and customer_user_id = auth.uid()
  for update;

  if not found then
    raise exception 'Order not found' using errcode = '42501';
  end if;
  if order_row.order_status <> 'pending_payment' then
    raise exception 'Order is no longer awaiting payment';
  end if;
  if order_row.total_pence <> 0 then
    raise exception 'This order still requires payment';
  end if;

  update public.orders
  set payment_status = 'paid',
      order_status = 'placed',
      paid_at = now(),
      manual_payout_status = case when restaurant_payout_mode = 'platform_manual' then 'unsettled' else manual_payout_status end
  where id = order_row.id;

  perform public.finalize_order_balance_reservations(order_row.id, true);
  perform public.record_order_promotion_redemption(order_row.id);
end;
$function$;

revoke all on function public.complete_zero_balance_order(uuid) from public, anon, authenticated;
grant execute on function public.complete_zero_balance_order(uuid) to authenticated;

commit;
