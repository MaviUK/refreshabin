begin;

create table public.platform_fee_settings (
  singleton boolean primary key default true check (singleton),
  commission_basis_points integer not null default 1000 check (commission_basis_points between 0 and 5000),
  commission_vat_basis_points integer not null default 2000 check (commission_vat_basis_points between 0 and 3000),
  service_fee_pence integer not null default 0 check (service_fee_pence between 0 and 5000),
  service_fee_enabled boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.platform_fee_settings (singleton) values (true) on conflict do nothing;

create table public.restaurant_fee_overrides (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  commission_basis_points integer check (commission_basis_points between 0 and 5000),
  service_fee_pence integer check (service_fee_pence between 0 and 5000),
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  reason text not null check (length(trim(reason)) between 3 and 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (commission_basis_points is not null or service_fee_pence is not null),
  check (effective_until is null or effective_until > effective_from)
);

create index restaurant_fee_overrides_effective_idx
  on public.restaurant_fee_overrides (restaurant_id, effective_from desc, effective_until);

create table public.platform_fee_setting_history (
  id bigint generated always as identity primary key,
  commission_basis_points integer not null,
  commission_vat_basis_points integer not null,
  service_fee_pence integer not null,
  service_fee_enabled boolean not null,
  reason text not null,
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.platform_fee_settings enable row level security;
alter table public.restaurant_fee_overrides enable row level security;
alter table public.platform_fee_setting_history enable row level security;
revoke all on public.platform_fee_settings, public.restaurant_fee_overrides, public.platform_fee_setting_history from public, anon, authenticated;

alter table public.orders
  add column service_fee_pence integer not null default 0 check (service_fee_pence >= 0),
  add column platform_commission_basis_points integer not null default 0 check (platform_commission_basis_points between 0 and 5000),
  add column platform_commission_pence integer not null default 0 check (platform_commission_pence >= 0),
  add column platform_commission_vat_pence integer not null default 0 check (platform_commission_vat_pence >= 0),
  add column restaurant_net_pence integer not null default 0 check (restaurant_net_pence >= 0),
  add column fee_override_id uuid references public.restaurant_fee_overrides(id) on delete set null;

alter table public.orders drop constraint if exists order_total_matches;
alter table public.orders add constraint order_total_matches check (
  total_pence = greatest(subtotal_pence + delivery_fee_pence + service_fee_pence - discount_pence, 0)
);

update public.orders
set restaurant_net_pence = greatest(subtotal_pence + delivery_fee_pence - discount_pence, 0)
where restaurant_net_pence = 0;

create or replace function private.resolve_platform_fees(p_restaurant_id uuid, p_at timestamptz default now())
returns table (
  commission_basis_points integer,
  commission_vat_basis_points integer,
  service_fee_pence integer,
  override_id uuid
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select
    coalesce(o.commission_basis_points, s.commission_basis_points),
    s.commission_vat_basis_points,
    case when s.service_fee_enabled then coalesce(o.service_fee_pence, s.service_fee_pence) else 0 end,
    o.id
  from public.platform_fee_settings s
  left join lateral (
    select rfo.*
    from public.restaurant_fee_overrides rfo
    where rfo.restaurant_id = p_restaurant_id
      and rfo.effective_from <= p_at
      and (rfo.effective_until is null or rfo.effective_until > p_at)
    order by rfo.effective_from desc, rfo.created_at desc
    limit 1
  ) o on true
  where s.singleton;
$function$;

revoke all on function private.resolve_platform_fees(uuid, timestamptz) from public, anon, authenticated, service_role;

create or replace function public.get_platform_fee_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare result jsonb;
begin
  if not private.has_platform_admin_permission('finance:view') then
    raise exception 'You do not have permission to view platform fees' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'global', jsonb_build_object(
      'commission_basis_points', s.commission_basis_points,
      'commission_vat_basis_points', s.commission_vat_basis_points,
      'service_fee_pence', s.service_fee_pence,
      'service_fee_enabled', s.service_fee_enabled,
      'updated_at', s.updated_at
    ),
    'restaurants', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'slug', r.slug) order by r.name) from public.restaurants r where r.status in ('active', 'pending_approval')), '[]'::jsonb),
    'overrides', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'restaurant_id', o.restaurant_id, 'restaurant_name', r.name,
        'commission_basis_points', o.commission_basis_points, 'service_fee_pence', o.service_fee_pence,
        'effective_from', o.effective_from, 'effective_until', o.effective_until,
        'reason', o.reason, 'created_at', o.created_at
      ) order by o.effective_from desc)
      from public.restaurant_fee_overrides o join public.restaurants r on r.id = o.restaurant_id
      where o.effective_until is null or o.effective_until > now()
    ), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc) from (select * from public.platform_fee_setting_history order by created_at desc limit 20) h), '[]'::jsonb)
  ) into result
  from public.platform_fee_settings s where s.singleton;
  return result;
end;
$function$;

create or replace function public.update_platform_fee_settings(
  p_commission_basis_points integer,
  p_commission_vat_basis_points integer,
  p_service_fee_pence integer,
  p_service_fee_enabled boolean,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not private.has_platform_admin_permission('finance:manage') then
    raise exception 'You do not have permission to manage platform fees' using errcode = '42501';
  end if;
  if nullif(trim(p_reason), '') is null then raise exception 'A reason is required'; end if;
  if p_commission_basis_points not between 0 and 5000 or p_commission_vat_basis_points not between 0 and 3000 or p_service_fee_pence not between 0 and 5000 then
    raise exception 'Fee values are outside the allowed range';
  end if;

  insert into public.platform_fee_setting_history (commission_basis_points, commission_vat_basis_points, service_fee_pence, service_fee_enabled, reason, changed_by)
  values (p_commission_basis_points, p_commission_vat_basis_points, p_service_fee_pence, p_service_fee_enabled, trim(p_reason), auth.uid());
  update public.platform_fee_settings set commission_basis_points = p_commission_basis_points, commission_vat_basis_points = p_commission_vat_basis_points,
    service_fee_pence = p_service_fee_pence, service_fee_enabled = p_service_fee_enabled, updated_by = auth.uid(), updated_at = now() where singleton;
  insert into public.platform_admin_audit_log (actor_user_id, action, target_type, details)
  values (auth.uid(), 'platform_fees_updated', 'platform_settings', jsonb_build_object('commission_basis_points', p_commission_basis_points, 'commission_vat_basis_points', p_commission_vat_basis_points, 'service_fee_pence', p_service_fee_pence, 'service_fee_enabled', p_service_fee_enabled, 'reason', trim(p_reason)));
end;
$function$;

create or replace function public.set_restaurant_fee_override(p_restaurant_id uuid, p_commission_basis_points integer, p_service_fee_pence integer, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare new_id uuid;
begin
  if not private.has_platform_admin_permission('finance:manage') then raise exception 'You do not have permission to manage platform fees' using errcode = '42501'; end if;
  if not exists (select 1 from public.restaurants where id = p_restaurant_id) then raise exception 'Restaurant not found'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'A reason is required'; end if;
  if p_commission_basis_points is null and p_service_fee_pence is null then raise exception 'Set at least one override'; end if;
  if p_commission_basis_points is not null and p_commission_basis_points not between 0 and 5000 then raise exception 'Commission must be between 0% and 50%'; end if;
  if p_service_fee_pence is not null and p_service_fee_pence not between 0 and 5000 then raise exception 'Service fee must be between £0 and £50'; end if;

  update public.restaurant_fee_overrides set effective_until = now()
  where restaurant_id = p_restaurant_id and effective_until is null;
  insert into public.restaurant_fee_overrides (restaurant_id, commission_basis_points, service_fee_pence, reason, created_by)
  values (p_restaurant_id, p_commission_basis_points, p_service_fee_pence, trim(p_reason), auth.uid()) returning id into new_id;
  insert into public.platform_admin_audit_log (actor_user_id, action, target_type, target_id, details)
  values (auth.uid(), 'restaurant_fee_override_set', 'restaurant', p_restaurant_id, jsonb_build_object('override_id', new_id, 'commission_basis_points', p_commission_basis_points, 'service_fee_pence', p_service_fee_pence, 'reason', trim(p_reason)));
  return new_id;
end;
$function$;

revoke all on function public.get_platform_fee_settings(), public.update_platform_fee_settings(integer, integer, integer, boolean, text), public.set_restaurant_fee_override(uuid, integer, integer, text) from public, anon, authenticated;
grant execute on function public.get_platform_fee_settings() to authenticated;
grant execute on function public.update_platform_fee_settings(integer, integer, integer, boolean, text), public.set_restaurant_fee_override(uuid, integer, integer, text) to authenticated;

create or replace function public.get_public_fulfilment_settings(storefront_slug text)
returns jsonb language sql stable security definer set search_path = '' as $function$
  select jsonb_build_object(
    'delivery_preparation_time_minutes', r.delivery_preparation_time_minutes,
    'collection_preparation_time_minutes', r.collection_preparation_time_minutes,
    'service_fee_pence', f.service_fee_pence
  )
  from public.restaurants r cross join lateral private.resolve_platform_fees(r.id, now()) f
  where r.slug = storefront_slug and r.status = 'active' limit 1;
$function$;
revoke all on function public.get_public_fulfilment_settings(text) from public;
grant execute on function public.get_public_fulfilment_settings(text) to anon, authenticated;

-- Apply the effective rates after the existing internal order calculator has
-- validated menu pricing, modifiers, delivery rules and minimum spend.
create or replace function public.apply_order_platform_fees(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare o public.orders%rowtype; f record; commission integer; commission_vat integer; restaurant_gross integer;
begin
  select * into o from public.orders where id = p_order_id and customer_user_id is not distinct from auth.uid() for update;
  if not found then raise exception 'Order not found'; end if;
  select * into f from private.resolve_platform_fees(o.restaurant_id, o.created_at);
  restaurant_gross := greatest(o.subtotal_pence + o.delivery_fee_pence - o.discount_pence, 0);
  commission := round(restaurant_gross * f.commission_basis_points / 10000.0);
  commission_vat := round(commission * f.commission_vat_basis_points / 10000.0);
  update public.orders set service_fee_pence = f.service_fee_pence, total_pence = restaurant_gross + f.service_fee_pence,
    platform_commission_basis_points = f.commission_basis_points, platform_commission_pence = commission,
    platform_commission_vat_pence = commission_vat, restaurant_net_pence = greatest(restaurant_gross - commission - commission_vat, 0), fee_override_id = f.override_id
  where id = p_order_id returning * into o;
  return jsonb_build_object('subtotal_pence', o.subtotal_pence, 'delivery_fee_pence', o.delivery_fee_pence, 'service_fee_pence', o.service_fee_pence,
    'total_pence', o.total_pence, 'currency', o.currency, 'payment_status', o.payment_status, 'order_status', o.order_status);
end;
$function$;
revoke all on function public.apply_order_platform_fees(uuid) from public;
revoke all on function public.apply_order_platform_fees(uuid) from anon, authenticated;

-- Wrap the scheduled order creator so every new order receives an immutable fee snapshot.
alter function public.create_order(text, text, text, text, text, text, jsonb, text, text, text, text, text, timestamptz) rename to create_order_without_platform_fees;
revoke all on function public.create_order_without_platform_fees(text, text, text, text, text, text, jsonb, text, text, text, text, text, timestamptz) from public, anon, authenticated;

create function public.create_order(
  storefront_slug text, fulfilment_method text, customer_first_name text, customer_last_name text, customer_email text, customer_phone text,
  basket_items jsonb, address_line_1 text default null, address_line_2 text default null, town_city text default null, postcode text default null,
  delivery_instructions text default null, requested_fulfilment_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare created jsonb; fees jsonb;
begin
  created := public.create_order_without_platform_fees(storefront_slug, fulfilment_method, customer_first_name, customer_last_name, customer_email, customer_phone,
    basket_items, address_line_1, address_line_2, town_city, postcode, delivery_instructions, requested_fulfilment_at);
  fees := public.apply_order_platform_fees((created ->> 'order_id')::uuid);
  return created || fees;
end;
$function$;
revoke all on function public.create_order(text, text, text, text, text, text, jsonb, text, text, text, text, text, timestamptz) from public;
grant execute on function public.create_order(text, text, text, text, text, text, jsonb, text, text, text, text, text, timestamptz) to anon, authenticated;

commit;
