begin;

create table if not exists public.restaurant_loyalty_rewards (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  description text,
  reward_type text not null check (reward_type in ('fixed_discount','percentage_discount','free_delivery','wallet_credit','free_item')),
  points_cost integer not null check (points_cost > 0),
  fixed_value_pence integer check (fixed_value_pence > 0),
  percentage_basis_points integer check (percentage_basis_points between 1 and 10000),
  menu_item_id uuid references public.menu_items(id) on delete set null,
  minimum_order_pence integer not null default 0 check (minimum_order_pence >= 0),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  total_redemption_limit integer check (total_redemption_limit > 0),
  per_customer_limit integer check (per_customer_limit > 0),
  redemption_count integer not null default 0 check (redemption_count >= 0),
  stock_remaining integer check (stock_remaining >= 0),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at),
  check (
    (reward_type in ('fixed_discount','wallet_credit') and fixed_value_pence is not null)
    or (reward_type = 'percentage_discount' and percentage_basis_points is not null)
    or (reward_type = 'free_item' and menu_item_id is not null)
    or reward_type = 'free_delivery'
  )
);

create table if not exists public.customer_reward_vouchers (
  id uuid primary key default gen_random_uuid(),
  reward_id uuid not null references public.restaurant_loyalty_rewards(id) on delete restrict,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  points_spent integer not null check (points_spent > 0),
  status text not null default 'available' check (status in ('available','reserved','redeemed','expired','cancelled')),
  expires_at timestamptz,
  reserved_order_id uuid references public.orders(id) on delete set null,
  reserved_at timestamptz,
  reservation_expires_at timestamptz,
  redeemed_order_id uuid references public.orders(id) on delete set null,
  redeemed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (restaurant_id, code)
);

create table if not exists public.customer_reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references public.customer_reward_vouchers(id) on delete restrict,
  reward_id uuid not null references public.restaurant_loyalty_rewards(id) on delete restrict,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  points_spent integer not null check (points_spent > 0),
  discount_pence integer not null default 0 check (discount_pence >= 0),
  redeemed_at timestamptz not null default now(),
  unique (voucher_id)
);

create index if not exists loyalty_rewards_restaurant_active_idx on public.restaurant_loyalty_rewards (restaurant_id, is_active, starts_at, ends_at);
create index if not exists reward_vouchers_customer_idx on public.customer_reward_vouchers (customer_user_id, restaurant_id, status, expires_at);
create index if not exists reward_vouchers_reservation_idx on public.customer_reward_vouchers (status, reservation_expires_at) where status = 'reserved';
create index if not exists reward_redemptions_restaurant_idx on public.customer_reward_redemptions (restaurant_id, redeemed_at desc);

alter table public.restaurant_loyalty_rewards enable row level security;
alter table public.customer_reward_vouchers enable row level security;
alter table public.customer_reward_redemptions enable row level security;
revoke all on public.restaurant_loyalty_rewards, public.customer_reward_vouchers, public.customer_reward_redemptions from public, anon, authenticated;

create or replace function public.get_restaurant_loyalty_rewards()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_restaurant_id uuid;
  v_result jsonb;
begin
  select rm.restaurant_id into v_restaurant_id
  from public.restaurant_members rm
  where rm.user_id = auth.uid()
  order by rm.created_at
  limit 1;
  if v_restaurant_id is null then raise exception 'Restaurant membership not found' using errcode = '42501'; end if;

  select jsonb_build_object(
    'summary', jsonb_build_object(
      'reward_count', count(*),
      'active_count', count(*) filter (where r.is_active and r.starts_at <= now() and (r.ends_at is null or r.ends_at > now())),
      'redemption_count', coalesce(sum(r.redemption_count), 0),
      'points_redeemed', coalesce((select sum(cr.points_spent) from public.customer_reward_redemptions cr where cr.restaurant_id = v_restaurant_id), 0)
    ),
    'rewards', coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'name', r.name,
      'description', r.description,
      'reward_type', r.reward_type,
      'points_cost', r.points_cost,
      'fixed_value_pence', r.fixed_value_pence,
      'percentage_basis_points', r.percentage_basis_points,
      'menu_item_id', r.menu_item_id,
      'minimum_order_pence', r.minimum_order_pence,
      'starts_at', r.starts_at,
      'ends_at', r.ends_at,
      'total_redemption_limit', r.total_redemption_limit,
      'per_customer_limit', r.per_customer_limit,
      'redemption_count', r.redemption_count,
      'stock_remaining', r.stock_remaining,
      'is_active', r.is_active,
      'created_at', r.created_at
    ) order by r.created_at desc) filter (where r.id is not null), '[]'::jsonb)
  ) into v_result
  from public.restaurant_loyalty_rewards r
  where r.restaurant_id = v_restaurant_id;
  return v_result;
end;
$function$;

create or replace function public.save_restaurant_loyalty_reward(
  p_reward_id uuid,
  p_name text,
  p_description text,
  p_reward_type text,
  p_points_cost integer,
  p_fixed_value_pence integer default null,
  p_percentage_basis_points integer default null,
  p_menu_item_id uuid default null,
  p_minimum_order_pence integer default 0,
  p_starts_at timestamptz default now(),
  p_ends_at timestamptz default null,
  p_total_redemption_limit integer default null,
  p_per_customer_limit integer default null,
  p_stock_remaining integer default null,
  p_is_active boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_restaurant_id uuid;
  v_reward public.restaurant_loyalty_rewards%rowtype;
begin
  select rm.restaurant_id into v_restaurant_id
  from public.restaurant_members rm
  where rm.user_id = auth.uid()
  order by rm.created_at
  limit 1;
  if v_restaurant_id is null then raise exception 'Restaurant membership not found' using errcode = '42501'; end if;
  if nullif(trim(p_name), '') is null then raise exception 'Reward name is required'; end if;
  if p_points_cost <= 0 then raise exception 'Points cost must be greater than zero'; end if;
  if p_ends_at is not null and p_ends_at <= p_starts_at then raise exception 'Reward end date must be after its start date'; end if;
  if p_reward_type = 'free_item' and not exists (select 1 from public.menu_items where id = p_menu_item_id and restaurant_id = v_restaurant_id) then raise exception 'Menu item is not available for this restaurant'; end if;

  if p_reward_id is null then
    insert into public.restaurant_loyalty_rewards (
      restaurant_id, name, description, reward_type, points_cost, fixed_value_pence,
      percentage_basis_points, menu_item_id, minimum_order_pence, starts_at, ends_at,
      total_redemption_limit, per_customer_limit, stock_remaining, is_active, created_by
    ) values (
      v_restaurant_id, trim(p_name), nullif(trim(p_description), ''), p_reward_type, p_points_cost,
      p_fixed_value_pence, p_percentage_basis_points, p_menu_item_id, p_minimum_order_pence,
      p_starts_at, p_ends_at, p_total_redemption_limit, p_per_customer_limit,
      p_stock_remaining, p_is_active, auth.uid()
    ) returning * into v_reward;
  else
    update public.restaurant_loyalty_rewards set
      name = trim(p_name), description = nullif(trim(p_description), ''), reward_type = p_reward_type,
      points_cost = p_points_cost, fixed_value_pence = p_fixed_value_pence,
      percentage_basis_points = p_percentage_basis_points, menu_item_id = p_menu_item_id,
      minimum_order_pence = p_minimum_order_pence, starts_at = p_starts_at, ends_at = p_ends_at,
      total_redemption_limit = p_total_redemption_limit, per_customer_limit = p_per_customer_limit,
      stock_remaining = p_stock_remaining, is_active = p_is_active, updated_at = now()
    where id = p_reward_id and restaurant_id = v_restaurant_id
    returning * into v_reward;
    if not found then raise exception 'Reward not found'; end if;
  end if;
  return to_jsonb(v_reward);
end;
$function$;

create or replace function public.get_customer_reward_store(p_restaurant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_points integer := 0;
  v_result jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select points_balance into v_points from public.customer_loyalty_accounts where restaurant_id = p_restaurant_id and customer_user_id = v_user_id;
  v_points := coalesce(v_points, 0);

  select jsonb_build_object(
    'points_balance', v_points,
    'rewards', coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'name', r.name,
      'description', r.description,
      'reward_type', r.reward_type,
      'points_cost', r.points_cost,
      'fixed_value_pence', r.fixed_value_pence,
      'percentage_basis_points', r.percentage_basis_points,
      'minimum_order_pence', r.minimum_order_pence,
      'ends_at', r.ends_at,
      'stock_remaining', r.stock_remaining,
      'can_afford', v_points >= r.points_cost
    ) order by r.points_cost, r.name) filter (where r.id is not null), '[]'::jsonb),
    'vouchers', coalesce((select jsonb_agg(jsonb_build_object(
      'id', v.id, 'reward_id', v.reward_id, 'code', v.code, 'status', v.status,
      'expires_at', v.expires_at, 'created_at', v.created_at, 'reward_name', rr.name,
      'reward_type', rr.reward_type, 'fixed_value_pence', rr.fixed_value_pence,
      'percentage_basis_points', rr.percentage_basis_points, 'minimum_order_pence', rr.minimum_order_pence
    ) order by v.created_at desc)
    from public.customer_reward_vouchers v join public.restaurant_loyalty_rewards rr on rr.id = v.reward_id
    where v.restaurant_id = p_restaurant_id and v.customer_user_id = v_user_id
      and v.status in ('available','reserved') and (v.expires_at is null or v.expires_at > now())), '[]'::jsonb)
  ) into v_result
  from public.restaurant_loyalty_rewards r
  where r.restaurant_id = p_restaurant_id and r.is_active and r.starts_at <= now()
    and (r.ends_at is null or r.ends_at > now())
    and (r.total_redemption_limit is null or r.redemption_count < r.total_redemption_limit)
    and (r.stock_remaining is null or r.stock_remaining > 0);
  return v_result;
end;
$function$;

create or replace function public.redeem_loyalty_reward(p_reward_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_reward public.restaurant_loyalty_rewards%rowtype;
  v_account public.customer_loyalty_accounts%rowtype;
  v_voucher public.customer_reward_vouchers%rowtype;
  v_customer_redemptions integer;
  v_code text;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_reward from public.restaurant_loyalty_rewards
  where id = p_reward_id and is_active and starts_at <= now() and (ends_at is null or ends_at > now())
  for update;
  if not found then raise exception 'Reward is not currently available'; end if;
  if v_reward.total_redemption_limit is not null and v_reward.redemption_count >= v_reward.total_redemption_limit then raise exception 'Reward redemption limit has been reached'; end if;
  if v_reward.stock_remaining is not null and v_reward.stock_remaining <= 0 then raise exception 'Reward is out of stock'; end if;
  select * into v_account from public.customer_loyalty_accounts
  where restaurant_id = v_reward.restaurant_id and customer_user_id = v_user_id for update;
  if not found or v_account.points_balance < v_reward.points_cost then raise exception 'You do not have enough points'; end if;
  if v_reward.per_customer_limit is not null then
    select count(*) into v_customer_redemptions from public.customer_reward_vouchers
    where reward_id = v_reward.id and customer_user_id = v_user_id and status <> 'cancelled';
    if v_customer_redemptions >= v_reward.per_customer_limit then raise exception 'You have reached the redemption limit for this reward'; end if;
  end if;

  loop
    v_code := 'RW-' || upper(substr(encode(gen_random_bytes(10), 'hex'), 1, 14));
    exit when not exists (select 1 from public.customer_reward_vouchers where restaurant_id = v_reward.restaurant_id and code = v_code);
  end loop;

  update public.customer_loyalty_accounts set
    points_balance = points_balance - v_reward.points_cost,
    lifetime_points_redeemed = lifetime_points_redeemed + v_reward.points_cost,
    last_redeemed_at = now(), updated_at = now()
  where id = v_account.id;

  insert into public.customer_loyalty_ledger (
    loyalty_account_id, restaurant_id, customer_user_id, points_delta, entry_type, note
  ) values (
    v_account.id, v_reward.restaurant_id, v_user_id, -v_reward.points_cost,
    'reward_redeemed', 'Redeemed points for ' || v_reward.name
  );

  insert into public.customer_reward_vouchers (
    reward_id, restaurant_id, customer_user_id, code, points_spent, expires_at
  ) values (
    v_reward.id, v_reward.restaurant_id, v_user_id, v_code, v_reward.points_cost,
    case when v_reward.ends_at is not null then v_reward.ends_at else now() + interval '90 days' end
  ) returning * into v_voucher;

  update public.restaurant_loyalty_rewards set
    redemption_count = redemption_count + 1,
    stock_remaining = case when stock_remaining is null then null else greatest(stock_remaining - 1, 0) end,
    updated_at = now()
  where id = v_reward.id;

  return jsonb_build_object('voucher_id', v_voucher.id, 'code', v_voucher.code, 'expires_at', v_voucher.expires_at, 'points_spent', v_reward.points_cost);
end;
$function$;

revoke all on function public.get_restaurant_loyalty_rewards() from public, anon, authenticated;
revoke all on function public.save_restaurant_loyalty_reward(uuid,text,text,text,integer,integer,integer,uuid,integer,timestamptz,timestamptz,integer,integer,integer,boolean) from public, anon, authenticated;
revoke all on function public.get_customer_reward_store(uuid) from public, anon, authenticated;
revoke all on function public.redeem_loyalty_reward(uuid) from public, anon, authenticated;
grant execute on function public.get_restaurant_loyalty_rewards() to authenticated;
grant execute on function public.save_restaurant_loyalty_reward(uuid,text,text,text,integer,integer,integer,uuid,integer,timestamptz,timestamptz,integer,integer,integer,boolean) to authenticated;
grant execute on function public.get_customer_reward_store(uuid) to authenticated;
grant execute on function public.redeem_loyalty_reward(uuid) to authenticated;

commit;
