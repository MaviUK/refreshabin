begin;

alter table public.restaurants
  add column if not exists gift_cards_enabled boolean not null default true,
  add column if not exists gift_cards_disabled_at timestamptz,
  add column if not exists gift_cards_disabled_by uuid references public.platform_admins(user_id) on delete set null,
  add column if not exists gift_cards_disabled_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.restaurants'::regclass
      and conname = 'restaurants_gift_cards_disabled_reason_length_check'
  ) then
    alter table public.restaurants
      add constraint restaurants_gift_cards_disabled_reason_length_check
      check (gift_cards_disabled_reason is null or char_length(trim(gift_cards_disabled_reason)) between 3 and 500);
  end if;
end;
$$;

comment on column public.restaurants.gift_cards_enabled is
  'Platform control for new gift-card sales and manual issuance. Existing issued gift cards remain redeemable.';

create or replace function public.set_platform_restaurant_gift_cards_enabled(
  p_restaurant_id uuid,
  p_enabled boolean,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
  restaurant_name text;
begin
  if not private.has_platform_admin_permission('finance:manage') then
    raise exception 'You do not have permission to manage gift card availability' using errcode = '42501';
  end if;
  if clean_reason is null or char_length(clean_reason) < 3 or char_length(clean_reason) > 500 then
    raise exception 'A reason between 3 and 500 characters is required' using errcode = '22023';
  end if;

  select r.name into restaurant_name
  from public.restaurants r
  where r.id = p_restaurant_id
  for update;

  if restaurant_name is null then
    raise exception 'Restaurant not found' using errcode = 'P0002';
  end if;

  update public.restaurants
  set gift_cards_enabled = p_enabled,
      gift_cards_disabled_at = case when p_enabled then null else now() end,
      gift_cards_disabled_by = case when p_enabled then null else auth.uid() end,
      gift_cards_disabled_reason = case when p_enabled then null else clean_reason end,
      updated_at = now()
  where id = p_restaurant_id;

  insert into public.platform_admin_audit_log(actor_user_id, action, target_type, target_id, details)
  values (
    auth.uid(),
    case when p_enabled then 'restaurant_gift_cards_enabled' else 'restaurant_gift_cards_disabled' end,
    'restaurant',
    p_restaurant_id,
    jsonb_build_object('restaurant_name', restaurant_name, 'enabled', p_enabled, 'reason', clean_reason)
  );
end;
$function$;

create or replace function public.get_public_gift_card_restaurant(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object('id', r.id, 'name', r.name, 'slug', r.slug)
  from public.restaurants r
  where r.slug = p_slug
    and r.status::text = 'active'
    and r.gift_cards_enabled
  limit 1
$function$;

create or replace function public.create_restaurant_gift_card(
  p_value_pence integer,
  p_recipient_email text,
  p_recipient_name text default null,
  p_purchaser_email text default null,
  p_message text default null,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_restaurant_id uuid;
  v_code text;
  v_id uuid;
begin
  select rm.restaurant_id into v_restaurant_id
  from public.restaurant_members rm
  where rm.user_id = auth.uid()
  order by rm.created_at
  limit 1;

  if v_restaurant_id is null then
    raise exception 'Restaurant membership not found' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.restaurants r
    where r.id = v_restaurant_id and r.gift_cards_enabled
  ) then
    raise exception 'Gift card sales have been disabled for this restaurant' using errcode = '42501';
  end if;
  if p_value_pence < 500 or p_value_pence > 100000 then
    raise exception 'Gift card value must be between £5 and £1,000';
  end if;
  if nullif(trim(p_recipient_email), '') is null then
    raise exception 'Recipient email is required';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Expiry must be in the future';
  end if;

  loop
    v_code := 'OF-' || upper(substr(encode(gen_random_bytes(12), 'hex'), 1, 16));
    exit when not exists (
      select 1 from public.restaurant_gift_cards
      where restaurant_id = v_restaurant_id and code = v_code
    );
  end loop;

  insert into public.restaurant_gift_cards(
    restaurant_id, code, original_value_pence, remaining_value_pence,
    purchaser_email, recipient_email, recipient_name, message, expires_at
  ) values (
    v_restaurant_id, v_code, p_value_pence, p_value_pence,
    nullif(trim(p_purchaser_email), ''), lower(trim(p_recipient_email)),
    nullif(trim(p_recipient_name), ''), nullif(trim(p_message), ''), p_expires_at
  ) returning id into v_id;

  return jsonb_build_object('id', v_id, 'code', v_code);
end;
$function$;

create or replace function public.get_platform_gift_card_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  if not private.has_platform_admin_permission('finance:view') then
    raise exception 'Platform finance permission required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'summary', jsonb_build_object(
      'purchase_count', (select count(*) from public.gift_card_purchases),
      'paid_value_pence', coalesce((select sum(p.value_pence) from public.gift_card_purchases p where p.status in ('paid','issued')), 0),
      'outstanding_value_pence', coalesce((select sum(g.remaining_value_pence) from public.restaurant_gift_cards g where g.is_active and g.remaining_value_pence > 0 and (g.expires_at is null or g.expires_at > now())), 0),
      'delivered_count', (select count(*) from public.gift_card_purchases p where p.email_sent_at is not null),
      'failed_delivery_count', (select count(*) from public.gift_card_purchases p where p.delivery_error is not null),
      'restaurants_enabled', (select count(*) from public.restaurants r where r.status::text in ('active','suspended') and r.gift_cards_enabled),
      'restaurants_disabled', (select count(*) from public.restaurants r where r.status::text in ('active','suspended') and not r.gift_cards_enabled)
    ),
    'purchases', coalesce((
      select jsonb_agg(jsonb_build_object(
        'purchase_id', p.id,
        'restaurant_name', r.name,
        'restaurant_slug', r.slug,
        'purchaser_email', p.purchaser_email,
        'recipient_email', p.recipient_email,
        'value_pence', p.value_pence,
        'status', p.status,
        'delivery_at', p.delivery_at,
        'email_sent_at', p.email_sent_at,
        'delivery_error', p.delivery_error,
        'gift_card_code', g.code,
        'remaining_value_pence', g.remaining_value_pence,
        'created_at', p.created_at
      ) order by p.created_at desc)
      from public.gift_card_purchases p
      join public.restaurants r on r.id = p.restaurant_id
      left join public.restaurant_gift_cards g on g.id = p.gift_card_id
    ), '[]'::jsonb),
    'restaurants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'restaurant_id', r.id,
        'restaurant_name', r.name,
        'restaurant_slug', r.slug,
        'restaurant_status', r.status::text,
        'gift_cards_enabled', r.gift_cards_enabled,
        'disabled_at', r.gift_cards_disabled_at,
        'disabled_reason', r.gift_cards_disabled_reason,
        'purchase_count', coalesce(ps.purchase_count, 0),
        'paid_value_pence', coalesce(ps.paid_value_pence, 0),
        'outstanding_value_pence', coalesce(gs.outstanding_value_pence, 0)
      ) order by r.name)
      from public.restaurants r
      left join (
        select p.restaurant_id,
          count(*)::bigint as purchase_count,
          coalesce(sum(p.value_pence) filter (where p.status in ('paid','issued')), 0)::bigint as paid_value_pence
        from public.gift_card_purchases p
        group by p.restaurant_id
      ) ps on ps.restaurant_id = r.id
      left join (
        select g.restaurant_id,
          coalesce(sum(g.remaining_value_pence) filter (where g.is_active and g.remaining_value_pence > 0 and (g.expires_at is null or g.expires_at > now())), 0)::bigint as outstanding_value_pence
        from public.restaurant_gift_cards g
        group by g.restaurant_id
      ) gs on gs.restaurant_id = r.id
      where r.status::text in ('active','suspended')
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$function$;

revoke all on function public.set_platform_restaurant_gift_cards_enabled(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.set_platform_restaurant_gift_cards_enabled(uuid, boolean, text) to authenticated;

revoke all on function public.get_public_gift_card_restaurant(text) from public;
grant execute on function public.get_public_gift_card_restaurant(text) to anon, authenticated;

revoke all on function public.create_restaurant_gift_card(integer, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.create_restaurant_gift_card(integer, text, text, text, text, timestamptz) to authenticated;

revoke all on function public.get_platform_gift_card_dashboard() from public, anon, authenticated;
grant execute on function public.get_platform_gift_card_dashboard() to authenticated;

commit;