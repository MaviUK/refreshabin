begin;

create table if not exists public.customer_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  phone text,
  address_line_1 text,
  address_line_2 text,
  town_city text,
  postcode text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_profiles enable row level security;

drop policy if exists customer_profiles_select_own on public.customer_profiles;
create policy customer_profiles_select_own on public.customer_profiles
for select using (auth.uid() = user_id);

drop policy if exists customer_profiles_insert_own on public.customer_profiles;
create policy customer_profiles_insert_own on public.customer_profiles
for insert with check (auth.uid() = user_id);

drop policy if exists customer_profiles_update_own on public.customer_profiles;
create policy customer_profiles_update_own on public.customer_profiles
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.claim_customer_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_count integer;
  account_email text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  select lower(email) into account_email
  from auth.users
  where id = auth.uid();

  update public.orders
  set customer_user_id = auth.uid()
  where customer_user_id is null
    and lower(customer_email) = account_email;

  get diagnostics claimed_count = row_count;
  return claimed_count;
end;
$$;

grant execute on function public.claim_customer_orders() to authenticated;

create or replace function public.get_customer_order_history()
returns table (
  id uuid,
  order_number bigint,
  restaurant_name text,
  restaurant_slug text,
  fulfilment_method text,
  total_pence integer,
  payment_status text,
  order_status text,
  created_at timestamptz,
  stripe_checkout_session_id text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    o.id,
    o.order_number,
    r.name,
    r.slug,
    o.fulfilment_method,
    o.total_pence,
    o.payment_status,
    o.order_status,
    o.created_at,
    o.stripe_checkout_session_id
  from public.orders o
  join public.restaurants r on r.id = o.restaurant_id
  where o.customer_user_id = auth.uid()
  order by o.created_at desc;
$$;

grant execute on function public.get_customer_order_history() to authenticated;

commit;
