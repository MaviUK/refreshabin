begin;

alter table public.gift_card_purchases
  add column if not exists purchaser_email_sent_at timestamptz,
  add column if not exists delivery_attempted_at timestamptz,
  add column if not exists delivery_error text;

create index if not exists gift_card_purchases_pending_payment_idx
  on public.gift_card_purchases(created_at)
  where status = 'pending' and stripe_checkout_session_id is not null;

create index if not exists gift_card_purchases_due_delivery_idx
  on public.gift_card_purchases(delivery_at)
  where status = 'issued' and email_sent_at is null;

create or replace function public.get_gift_card_purchase_status(p_session_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'status', p.status,
    'delivery_at', p.delivery_at,
    'email_sent', p.email_sent_at is not null,
    'purchaser_receipt_sent', p.purchaser_email_sent_at is not null,
    'restaurant_name', r.name,
    'restaurant_slug', r.slug
  )
  from public.gift_card_purchases p
  join public.restaurants r on r.id = p.restaurant_id
  where p.stripe_checkout_session_id = p_session_id
  limit 1
$function$;

revoke all on function public.get_gift_card_purchase_status(text) from public, anon, authenticated;
grant execute on function public.get_gift_card_purchase_status(text) to anon, authenticated;

commit;
