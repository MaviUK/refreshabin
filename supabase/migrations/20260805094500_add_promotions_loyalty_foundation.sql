begin;

create table if not exists public.restaurant_promotions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  code text not null,
  promotion_type text not null check (promotion_type in ('percentage','fixed','free_delivery','birthday','referral')),
  percentage_basis_points integer check (percentage_basis_points between 1 and 10000),
  fixed_discount_pence integer check (fixed_discount_pence > 0),
  minimum_order_pence integer not null default 0 check (minimum_order_pence >= 0),
  maximum_discount_pence integer check (maximum_discount_pence > 0),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  total_redemption_limit integer check (total_redemption_limit > 0),
  per_customer_limit integer check (per_customer_limit > 0),
  redemption_count integer not null default 0,
  first_order_only boolean not null default false,
  fulfilment_methods text[] not null default array['delivery','collection'],
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, code),
  check (ends_at is null or ends_at > starts_at),
  check (
    (promotion_type = 'percentage' and percentage_basis_points is not null)
    or (promotion_type = 'fixed' and fixed_discount_pence is not null)
    or promotion_type in ('free_delivery','birthday','referral')
  )
);

create table if not exists public.promotion_redemptions (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.restaurant_promotions(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  customer_user_id uuid references auth.users(id) on delete set null,
  customer_email text,
  discount_pence integer not null check (discount_pence >= 0),
  redeemed_at timestamptz not null default now()
);
create index if not exists promotion_redemptions_customer_idx on public.promotion_redemptions (promotion_id, customer_user_id, customer_email);

create table if not exists public.customer_loyalty_accounts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  points_balance integer not null default 0 check (points_balance >= 0),
  lifetime_points_earned integer not null default 0 check (lifetime_points_earned >= 0),
  lifetime_points_redeemed integer not null default 0 check (lifetime_points_redeemed >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, customer_user_id)
);

create table if not exists public.customer_loyalty_ledger (
  id uuid primary key default gen_random_uuid(),
  loyalty_account_id uuid not null references public.customer_loyalty_accounts(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  points_delta integer not null,
  entry_type text not null check (entry_type in ('order_earned','reward_redeemed','manual_adjustment','refund_reversal','birthday_bonus','referral_bonus')),
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.customer_credit_accounts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  balance_pence integer not null default 0 check (balance_pence >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, customer_user_id)
);

create table if not exists public.customer_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  credit_account_id uuid not null references public.customer_credit_accounts(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  amount_pence integer not null,
  entry_type text not null check (entry_type in ('gift_card','refund_credit','manual_credit','order_redemption','referral_credit','birthday_credit')),
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.restaurant_gift_cards (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  code text not null,
  original_value_pence integer not null check (original_value_pence > 0),
  remaining_value_pence integer not null check (remaining_value_pence >= 0),
  purchaser_email text,
  recipient_email text,
  recipient_name text,
  message text,
  expires_at timestamptz,
  redeemed_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (restaurant_id, code)
);

create table if not exists public.customer_referrals (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  referrer_user_id uuid not null references auth.users(id) on delete cascade,
  referred_user_id uuid references auth.users(id) on delete set null,
  referral_code text not null,
  status text not null default 'pending' check (status in ('pending','qualified','rewarded','cancelled')),
  qualifying_order_id uuid references public.orders(id) on delete set null,
  referrer_reward_pence integer not null default 0,
  referred_reward_pence integer not null default 0,
  qualified_at timestamptz,
  rewarded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (restaurant_id, referral_code),
  unique (restaurant_id, referred_user_id)
);

alter table public.orders add column if not exists promotion_id uuid references public.restaurant_promotions(id) on delete set null;
alter table public.orders add column if not exists promotion_code text;
alter table public.orders add column if not exists loyalty_points_redeemed integer not null default 0;
alter table public.orders add column if not exists customer_credit_used_pence integer not null default 0;
alter table public.orders add column if not exists gift_card_used_pence integer not null default 0;

alter table public.restaurant_promotions enable row level security;
alter table public.promotion_redemptions enable row level security;
alter table public.customer_loyalty_accounts enable row level security;
alter table public.customer_loyalty_ledger enable row level security;
alter table public.customer_credit_accounts enable row level security;
alter table public.customer_credit_ledger enable row level security;
alter table public.restaurant_gift_cards enable row level security;
alter table public.customer_referrals enable row level security;

revoke all on public.restaurant_promotions, public.promotion_redemptions, public.customer_loyalty_accounts, public.customer_loyalty_ledger, public.customer_credit_accounts, public.customer_credit_ledger, public.restaurant_gift_cards, public.customer_referrals from public, anon, authenticated;

create or replace function public.validate_restaurant_promotion(
  p_restaurant_id uuid,
  p_code text,
  p_subtotal_pence integer,
  p_delivery_fee_pence integer,
  p_fulfilment_method text,
  p_customer_email text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  promotion public.restaurant_promotions%rowtype;
  customer_redemptions integer := 0;
  discount integer := 0;
begin
  select * into promotion
  from public.restaurant_promotions
  where restaurant_id = p_restaurant_id
    and upper(code) = upper(trim(p_code))
    and is_active = true
    and starts_at <= now()
    and (ends_at is null or ends_at > now())
  limit 1;

  if not found then return jsonb_build_object('valid', false, 'error', 'Promotion code is invalid or expired.'); end if;
  if p_fulfilment_method <> all(promotion.fulfilment_methods) then return jsonb_build_object('valid', false, 'error', 'Promotion is not valid for this fulfilment method.'); end if;
  if p_subtotal_pence < promotion.minimum_order_pence then return jsonb_build_object('valid', false, 'error', 'Minimum order value has not been reached.'); end if;
  if promotion.total_redemption_limit is not null and promotion.redemption_count >= promotion.total_redemption_limit then return jsonb_build_object('valid', false, 'error', 'Promotion redemption limit has been reached.'); end if;

  if promotion.per_customer_limit is not null and p_customer_email is not null then
    select count(*) into customer_redemptions from public.promotion_redemptions where promotion_id = promotion.id and lower(customer_email) = lower(p_customer_email);
    if customer_redemptions >= promotion.per_customer_limit then return jsonb_build_object('valid', false, 'error', 'You have already used this promotion.'); end if;
  end if;

  discount := case promotion.promotion_type
    when 'percentage' then round(p_subtotal_pence * promotion.percentage_basis_points / 10000.0)
    when 'fixed' then promotion.fixed_discount_pence
    when 'free_delivery' then p_delivery_fee_pence
    else coalesce(promotion.fixed_discount_pence, 0)
  end;
  discount := least(discount, p_subtotal_pence + p_delivery_fee_pence);
  if promotion.maximum_discount_pence is not null then discount := least(discount, promotion.maximum_discount_pence); end if;

  return jsonb_build_object('valid', true, 'promotion_id', promotion.id, 'code', promotion.code, 'name', promotion.name, 'discount_pence', greatest(discount,0));
end;
$function$;

revoke all on function public.validate_restaurant_promotion(uuid,text,integer,integer,text,text) from public, anon, authenticated;
grant execute on function public.validate_restaurant_promotion(uuid,text,integer,integer,text,text) to anon, authenticated;

commit;
