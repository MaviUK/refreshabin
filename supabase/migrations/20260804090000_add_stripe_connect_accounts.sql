begin;

alter table public.restaurants
  add column if not exists stripe_account_id text unique,
  add column if not exists stripe_connect_status text not null default 'not_started'
    check (stripe_connect_status in ('not_started','pending','restricted','enabled')),
  add column if not exists stripe_details_submitted boolean not null default false,
  add column if not exists stripe_charges_enabled boolean not null default false,
  add column if not exists stripe_payouts_enabled boolean not null default false,
  add column if not exists stripe_requirements jsonb not null default '{}'::jsonb
    check (jsonb_typeof(stripe_requirements) = 'object'),
  add column if not exists stripe_connect_updated_at timestamptz;

create index if not exists restaurants_stripe_connect_status_idx
  on public.restaurants (stripe_connect_status, stripe_connect_updated_at desc);

create or replace function public.get_restaurant_stripe_connect_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  restaurant_id uuid;
  result jsonb;
begin
  select rm.restaurant_id into restaurant_id
  from public.restaurant_members rm
  where rm.user_id = auth.uid()
  order by rm.created_at
  limit 1;

  if restaurant_id is null then
    raise exception 'Restaurant membership not found' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'restaurant_id', r.id,
    'stripe_account_id', r.stripe_account_id,
    'status', r.stripe_connect_status,
    'details_submitted', r.stripe_details_submitted,
    'charges_enabled', r.stripe_charges_enabled,
    'payouts_enabled', r.stripe_payouts_enabled,
    'requirements', r.stripe_requirements,
    'updated_at', r.stripe_connect_updated_at
  ) into result
  from public.restaurants r
  where r.id = restaurant_id;

  return result;
end;
$function$;

revoke all on function public.get_restaurant_stripe_connect_status() from public, anon, authenticated;
grant execute on function public.get_restaurant_stripe_connect_status() to authenticated;

create or replace function public.get_platform_restaurant_stripe_connect(p_restaurant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare result jsonb;
begin
  if not private.has_platform_admin_permission('finance:view') then
    raise exception 'You do not have permission to view restaurant payment status' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'restaurant_id', r.id,
    'restaurant_name', r.name,
    'stripe_account_id', r.stripe_account_id,
    'status', r.stripe_connect_status,
    'details_submitted', r.stripe_details_submitted,
    'charges_enabled', r.stripe_charges_enabled,
    'payouts_enabled', r.stripe_payouts_enabled,
    'requirements', r.stripe_requirements,
    'updated_at', r.stripe_connect_updated_at
  ) into result
  from public.restaurants r
  where r.id = p_restaurant_id;

  if result is null then raise exception 'Restaurant not found' using errcode = 'P0002'; end if;
  return result;
end;
$function$;

revoke all on function public.get_platform_restaurant_stripe_connect(uuid) from public, anon, authenticated;
grant execute on function public.get_platform_restaurant_stripe_connect(uuid) to authenticated;

create or replace function public.update_restaurant_stripe_connect_status(
  p_restaurant_id uuid,
  p_stripe_account_id text,
  p_details_submitted boolean,
  p_charges_enabled boolean,
  p_payouts_enabled boolean,
  p_requirements jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare next_status text;
begin
  if current_user not in ('postgres','service_role','supabase_admin') then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  next_status := case
    when coalesce(p_charges_enabled, false) and coalesce(p_payouts_enabled, false) then 'enabled'
    when coalesce(p_details_submitted, false) then 'restricted'
    else 'pending'
  end;

  update public.restaurants
  set stripe_account_id = p_stripe_account_id,
      stripe_connect_status = next_status,
      stripe_details_submitted = coalesce(p_details_submitted, false),
      stripe_charges_enabled = coalesce(p_charges_enabled, false),
      stripe_payouts_enabled = coalesce(p_payouts_enabled, false),
      stripe_requirements = coalesce(p_requirements, '{}'::jsonb),
      stripe_connect_updated_at = now(),
      updated_at = now()
  where id = p_restaurant_id;

  if not found then raise exception 'Restaurant not found' using errcode = 'P0002'; end if;
end;
$function$;

revoke all on function public.update_restaurant_stripe_connect_status(uuid,text,boolean,boolean,boolean,jsonb)
  from public, anon, authenticated;
grant execute on function public.update_restaurant_stripe_connect_status(uuid,text,boolean,boolean,boolean,jsonb)
  to service_role;

commit;
