begin;

alter table public.orders
  add column if not exists restaurant_payout_mode text not null default 'platform_manual'
    check (restaurant_payout_mode in ('platform_manual','stripe_connect')),
  add column if not exists manual_payout_status text not null default 'unsettled'
    check (manual_payout_status in ('unsettled','processing','paid','not_applicable'));

create index if not exists orders_manual_payout_balance_idx
  on public.orders (restaurant_id, created_at)
  where restaurant_payout_mode = 'platform_manual'
    and payment_status in ('paid','partially_refunded','refunded');

comment on column public.orders.restaurant_payout_mode is
  'stripe_connect when Stripe transfers the restaurant share automatically; platform_manual when ordered.food collects funds for later manual settlement.';

commit;
