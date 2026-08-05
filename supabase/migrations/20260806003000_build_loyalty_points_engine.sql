begin;

create table if not exists public.restaurant_loyalty_programs (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  is_enabled boolean not null default false,
  points_per_pound numeric(8,2) not null default 1 check (points_per_pound >= 0 and points_per_pound <= 1000),
  minimum_eligible_spend_pence integer not null default 0 check (minimum_eligible_spend_pence >= 0),
  include_delivery_fee boolean not null default false,
  include_service_fee boolean not null default false,
  earn_on_discounted_spend boolean not null default true,
  rounding_mode text not null default 'floor' check (rounding_mode in ('floor','nearest','ceil')),
  pending_hours integer not null default 24 check (pending_hours between 0 and 720),
  first_order_bonus_points integer not null default 0 check (first_order_bonus_points >= 0),
  birthday_bonus_points integer not null default 0 check (birthday_bonus_points >= 0),
  points_expiry_months integer check (points_expiry_months between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_loyalty_pending_points (
  id uuid primary key default gen_random_uuid(),
  loyalty_account_id uuid not null references public.customer_loyalty_accounts(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  base_points integer not null check (base_points >= 0),
  bonus_points integer not null default 0 check (bonus_points >= 0),
  total_points integer generated always as (base_points + bonus_points) stored,
  eligible_spend_pence integer not null check (eligible_spend_pence >= 0),
  release_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','released','cancelled','reversed')),
  released_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  unique (order_id)
);

create index if not exists loyalty_pending_release_idx
  on public.customer_loyalty_pending_points (release_at, id)
  where status = 'pending';
create index if not exists loyalty_pending_customer_idx
  on public.customer_loyalty_pending_points (customer_user_id, restaurant_id, status);
create index if not exists loyalty_ledger_order_idx
  on public.customer_loyalty_ledger (order_id, entry_type);

alter table public.customer_loyalty_accounts
  add column if not exists pending_points integer not null default 0 check (pending_points >= 0);
alter table public.customer_loyalty_accounts
  add column if not exists last_earned_at timestamptz;
alter table public.customer_loyalty_accounts
  add column if not exists last_redeemed_at timestamptz;

alter table public.orders
  add column if not exists loyalty_points_earned integer not null default 0 check (loyalty_points_earned >= 0);
alter table public.orders
  add column if not exists loyalty_points_pending integer not null default 0 check (loyalty_points_pending >= 0);

alter table public.restaurant_loyalty_programs enable row level security;
alter table public.customer_loyalty_pending_points enable row level security;
revoke all on public.restaurant_loyalty_programs, public.customer_loyalty_pending_points from public, anon, authenticated;

create or replace function public.get_restaurant_loyalty_program()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_restaurant_id uuid;
  v_program public.restaurant_loyalty_programs%rowtype;
begin
  select rm.restaurant_id into v_restaurant_id
  from public.restaurant_members rm
  where rm.user_id = auth.uid()
  order by rm.created_at
  limit 1;

  if v_restaurant_id is null then
    raise exception 'Restaurant membership not found' using errcode = '42501';
  end if;

  insert into public.restaurant_loyalty_programs (restaurant_id)
  values (v_restaurant_id)
  on conflict (restaurant_id) do nothing;

  select * into v_program
  from public.restaurant_loyalty_programs
  where restaurant_id = v_restaurant_id;

  return to_jsonb(v_program);
end;
$function$;

create or replace function public.update_restaurant_loyalty_program(
  p_is_enabled boolean,
  p_points_per_pound numeric,
  p_minimum_eligible_spend_pence integer,
  p_include_delivery_fee boolean,
  p_include_service_fee boolean,
  p_earn_on_discounted_spend boolean,
  p_rounding_mode text,
  p_pending_hours integer,
  p_first_order_bonus_points integer,
  p_birthday_bonus_points integer,
  p_points_expiry_months integer default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_restaurant_id uuid;
  v_program public.restaurant_loyalty_programs%rowtype;
begin
  select rm.restaurant_id into v_restaurant_id
  from public.restaurant_members rm
  where rm.user_id = auth.uid()
  order by rm.created_at
  limit 1;

  if v_restaurant_id is null then
    raise exception 'Restaurant membership not found' using errcode = '42501';
  end if;

  insert into public.restaurant_loyalty_programs (
    restaurant_id, is_enabled, points_per_pound, minimum_eligible_spend_pence,
    include_delivery_fee, include_service_fee, earn_on_discounted_spend,
    rounding_mode, pending_hours, first_order_bonus_points,
    birthday_bonus_points, points_expiry_months, updated_at
  ) values (
    v_restaurant_id, p_is_enabled, p_points_per_pound, p_minimum_eligible_spend_pence,
    p_include_delivery_fee, p_include_service_fee, p_earn_on_discounted_spend,
    p_rounding_mode, p_pending_hours, p_first_order_bonus_points,
    p_birthday_bonus_points, p_points_expiry_months, now()
  )
  on conflict (restaurant_id) do update set
    is_enabled = excluded.is_enabled,
    points_per_pound = excluded.points_per_pound,
    minimum_eligible_spend_pence = excluded.minimum_eligible_spend_pence,
    include_delivery_fee = excluded.include_delivery_fee,
    include_service_fee = excluded.include_service_fee,
    earn_on_discounted_spend = excluded.earn_on_discounted_spend,
    rounding_mode = excluded.rounding_mode,
    pending_hours = excluded.pending_hours,
    first_order_bonus_points = excluded.first_order_bonus_points,
    birthday_bonus_points = excluded.birthday_bonus_points,
    points_expiry_months = excluded.points_expiry_months,
    updated_at = now()
  returning * into v_program;

  return to_jsonb(v_program);
end;
$function$;

create or replace function public.queue_order_loyalty_points(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order public.orders%rowtype;
  v_program public.restaurant_loyalty_programs%rowtype;
  v_account public.customer_loyalty_accounts%rowtype;
  v_eligible_spend integer;
  v_raw_points numeric;
  v_base_points integer;
  v_bonus_points integer := 0;
  v_previous_completed_orders integer;
  v_pending public.customer_loyalty_pending_points%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;

  if v_order.customer_user_id is null or v_order.order_status <> 'completed' or v_order.payment_status not in ('paid','partially_refunded') then
    return jsonb_build_object('queued', false, 'reason', 'Order is not eligible');
  end if;

  select * into v_program from public.restaurant_loyalty_programs
  where restaurant_id = v_order.restaurant_id and is_enabled;
  if not found then return jsonb_build_object('queued', false, 'reason', 'Loyalty is disabled'); end if;

  if exists (select 1 from public.customer_loyalty_pending_points where order_id = v_order.id)
     or exists (select 1 from public.customer_loyalty_ledger where order_id = v_order.id and entry_type = 'order_earned') then
    return jsonb_build_object('queued', false, 'reason', 'Points already processed');
  end if;

  v_eligible_spend := v_order.subtotal_pence;
  if not v_program.earn_on_discounted_spend then
    v_eligible_spend := v_eligible_spend + coalesce(v_order.discount_pence, 0);
  end if;
  if v_program.include_delivery_fee then v_eligible_spend := v_eligible_spend + coalesce(v_order.delivery_fee_pence, 0); end if;
  if v_program.include_service_fee then v_eligible_spend := v_eligible_spend + coalesce(v_order.service_fee_pence, 0); end if;
  v_eligible_spend := greatest(v_eligible_spend - coalesce(v_order.refunded_pence, 0), 0);

  if v_eligible_spend < v_program.minimum_eligible_spend_pence then
    return jsonb_build_object('queued', false, 'reason', 'Minimum eligible spend not reached');
  end if;

  v_raw_points := (v_eligible_spend / 100.0) * v_program.points_per_pound;
  v_base_points := case v_program.rounding_mode
    when 'ceil' then ceil(v_raw_points)::integer
    when 'nearest' then round(v_raw_points)::integer
    else floor(v_raw_points)::integer
  end;

  select count(*) into v_previous_completed_orders
  from public.orders o
  where o.restaurant_id = v_order.restaurant_id
    and o.customer_user_id = v_order.customer_user_id
    and o.id <> v_order.id
    and o.order_status = 'completed'
    and o.payment_status in ('paid','partially_refunded');
  if v_previous_completed_orders = 0 then v_bonus_points := v_program.first_order_bonus_points; end if;

  insert into public.customer_loyalty_accounts (restaurant_id, customer_user_id)
  values (v_order.restaurant_id, v_order.customer_user_id)
  on conflict (restaurant_id, customer_user_id) do update set updated_at = now()
  returning * into v_account;

  insert into public.customer_loyalty_pending_points (
    loyalty_account_id, restaurant_id, customer_user_id, order_id,
    base_points, bonus_points, eligible_spend_pence, release_at
  ) values (
    v_account.id, v_order.restaurant_id, v_order.customer_user_id, v_order.id,
    greatest(v_base_points, 0), v_bonus_points, v_eligible_spend,
    now() + make_interval(hours => v_program.pending_hours)
  ) returning * into v_pending;

  update public.customer_loyalty_accounts
  set pending_points = pending_points + v_pending.total_points, updated_at = now()
  where id = v_account.id;

  update public.orders set loyalty_points_pending = v_pending.total_points where id = v_order.id;

  return jsonb_build_object('queued', true, 'points', v_pending.total_points, 'release_at', v_pending.release_at);
end;
$function$;

create or replace function public.release_due_loyalty_points(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.customer_loyalty_pending_points%rowtype;
  v_count integer := 0;
begin
  for v_row in
    select * from public.customer_loyalty_pending_points
    where status = 'pending' and release_at <= now()
    order by release_at, id
    limit least(greatest(p_limit, 1), 1000)
    for update skip locked
  loop
    update public.customer_loyalty_accounts
    set points_balance = points_balance + v_row.total_points,
        pending_points = greatest(pending_points - v_row.total_points, 0),
        lifetime_points_earned = lifetime_points_earned + v_row.total_points,
        last_earned_at = now(), updated_at = now()
    where id = v_row.loyalty_account_id;

    insert into public.customer_loyalty_ledger (
      loyalty_account_id, restaurant_id, customer_user_id, order_id,
      points_delta, entry_type, note
    ) values (
      v_row.loyalty_account_id, v_row.restaurant_id, v_row.customer_user_id,
      v_row.order_id, v_row.total_points, 'order_earned',
      'Points earned from completed order'
    );

    update public.customer_loyalty_pending_points
    set status = 'released', released_at = now()
    where id = v_row.id;

    update public.orders
    set loyalty_points_pending = 0, loyalty_points_earned = v_row.total_points
    where id = v_row.order_id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

create or replace function public.cancel_order_loyalty_points(p_order_id uuid, p_reason text default 'Order cancelled or refunded')
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_pending public.customer_loyalty_pending_points%rowtype;
  v_ledger public.customer_loyalty_ledger%rowtype;
begin
  select * into v_pending from public.customer_loyalty_pending_points where order_id = p_order_id for update;
  if found and v_pending.status = 'pending' then
    update public.customer_loyalty_accounts
    set pending_points = greatest(pending_points - v_pending.total_points, 0), updated_at = now()
    where id = v_pending.loyalty_account_id;
    update public.customer_loyalty_pending_points
    set status = 'cancelled', cancelled_at = now(), cancellation_reason = p_reason
    where id = v_pending.id;
    update public.orders set loyalty_points_pending = 0 where id = p_order_id;
    return;
  end if;

  select * into v_ledger from public.customer_loyalty_ledger
  where order_id = p_order_id and entry_type = 'order_earned'
  order by created_at desc limit 1 for update;
  if found and not exists (
    select 1 from public.customer_loyalty_ledger where order_id = p_order_id and entry_type = 'refund_reversal'
  ) then
    update public.customer_loyalty_accounts
    set points_balance = greatest(points_balance - v_ledger.points_delta, 0), updated_at = now()
    where id = v_ledger.loyalty_account_id;
    insert into public.customer_loyalty_ledger (
      loyalty_account_id, restaurant_id, customer_user_id, order_id,
      points_delta, entry_type, note
    ) values (
      v_ledger.loyalty_account_id, v_ledger.restaurant_id, v_ledger.customer_user_id,
      p_order_id, -v_ledger.points_delta, 'refund_reversal', p_reason
    );
    update public.orders set loyalty_points_earned = 0 where id = p_order_id;
  end if;
end;
$function$;

create or replace function public.get_customer_loyalty_summary()
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
  if v_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select jsonb_build_object(
    'total_available_points', coalesce(sum(a.points_balance), 0),
    'total_pending_points', coalesce(sum(a.pending_points), 0),
    'accounts', coalesce(jsonb_agg(jsonb_build_object(
      'restaurant_id', a.restaurant_id,
      'restaurant_name', r.name,
      'restaurant_slug', r.slug,
      'available_points', a.points_balance,
      'pending_points', a.pending_points,
      'lifetime_earned', a.lifetime_points_earned,
      'lifetime_redeemed', a.lifetime_points_redeemed,
      'last_earned_at', a.last_earned_at
    ) order by a.points_balance desc, r.name) filter (where a.id is not null), '[]'::jsonb),
    'transactions', coalesce((select jsonb_agg(entry order by created_at desc) from (
      select jsonb_build_object('id',l.id,'restaurant_name',r2.name,'points_delta',l.points_delta,'entry_type',l.entry_type,'note',l.note,'created_at',l.created_at) entry,l.created_at
      from public.customer_loyalty_ledger l join public.restaurants r2 on r2.id=l.restaurant_id
      where l.customer_user_id=v_user_id order by l.created_at desc limit 100
    ) recent), '[]'::jsonb)
  ) into v_result
  from public.customer_loyalty_accounts a
  join public.restaurants r on r.id = a.restaurant_id
  where a.customer_user_id = v_user_id;
  return v_result;
end;
$function$;

create or replace function public.order_loyalty_status_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.order_status = 'completed' and old.order_status is distinct from new.order_status then
    perform public.queue_order_loyalty_points(new.id);
  elsif new.order_status in ('cancelled','rejected') and old.order_status is distinct from new.order_status then
    perform public.cancel_order_loyalty_points(new.id, 'Order ' || new.order_status);
  elsif new.payment_status in ('refunded','partially_refunded') and old.payment_status is distinct from new.payment_status then
    perform public.cancel_order_loyalty_points(new.id, 'Payment ' || new.payment_status);
  end if;
  return new;
end;
$function$;

drop trigger if exists orders_loyalty_status_trigger on public.orders;
create trigger orders_loyalty_status_trigger
after update of order_status, payment_status on public.orders
for each row execute function public.order_loyalty_status_trigger();

revoke all on function public.get_restaurant_loyalty_program() from public, anon, authenticated;
revoke all on function public.update_restaurant_loyalty_program(boolean,numeric,integer,boolean,boolean,boolean,text,integer,integer,integer,integer) from public, anon, authenticated;
revoke all on function public.queue_order_loyalty_points(uuid) from public, anon, authenticated;
revoke all on function public.release_due_loyalty_points(integer) from public, anon, authenticated;
revoke all on function public.cancel_order_loyalty_points(uuid,text) from public, anon, authenticated;
revoke all on function public.get_customer_loyalty_summary() from public, anon, authenticated;

grant execute on function public.get_restaurant_loyalty_program() to authenticated;
grant execute on function public.update_restaurant_loyalty_program(boolean,numeric,integer,boolean,boolean,boolean,text,integer,integer,integer,integer) to authenticated;
grant execute on function public.get_customer_loyalty_summary() to authenticated;
grant execute on function public.release_due_loyalty_points(integer) to service_role;
grant execute on function public.queue_order_loyalty_points(uuid) to service_role;
grant execute on function public.cancel_order_loyalty_points(uuid,text) to service_role;

commit;
