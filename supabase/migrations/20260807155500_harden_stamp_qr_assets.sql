create or replace function public.create_stamp_qr_campaign(
  p_program_id uuid,
  p_stamps integer default 1,
  p_max_claims integer default 1,
  p_valid_minutes integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rid uuid;
  raw_token text;
  campaign_id uuid;
  expiry timestamptz;
begin
  select restaurant_id into rid
  from public.restaurant_members
  where user_id = auth.uid()
  order by created_at
  limit 1;

  if rid is null or not exists(
    select 1 from public.restaurant_stamp_programs
    where id = p_program_id and restaurant_id = rid and is_active
  ) then
    raise exception 'Stamp programme not found' using errcode='42501';
  end if;

  if p_stamps < 1 or p_stamps > 20 then
    raise exception 'QR campaigns can award between 1 and 20 stamps';
  end if;
  if p_max_claims < 1 or p_max_claims > 10000 then
    raise exception 'QR claim limit must be between 1 and 10000';
  end if;
  if p_valid_minutes < 1 or p_valid_minutes > 1440 then
    raise exception 'QR validity must be between 1 minute and 24 hours';
  end if;

  raw_token := encode(gen_random_bytes(24), 'hex');
  expiry := now() + make_interval(mins => p_valid_minutes);

  insert into public.stamp_qr_campaigns(
    program_id, restaurant_id, token_hash, stamps_awarded,
    max_claims, expires_at, created_by
  ) values (
    p_program_id, rid, encode(digest(raw_token, 'sha256'), 'hex'), p_stamps,
    p_max_claims, expiry, auth.uid()
  ) returning id into campaign_id;

  return jsonb_build_object(
    'campaign_id', campaign_id,
    'token', raw_token,
    'expires_at', expiry,
    'claim_url', '/account/stamps/claim?token=' || raw_token
  );
end;
$$;

revoke all on function public.create_stamp_qr_campaign(uuid, integer, integer, integer) from public, anon;
grant execute on function public.create_stamp_qr_campaign(uuid, integer, integer, integer) to authenticated, service_role;

create or replace function public.get_restaurant_stamp_programs()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  rid uuid;
  result jsonb;
begin
  select restaurant_id into rid
  from public.restaurant_members
  where user_id = auth.uid()
  order by created_at
  limit 1;

  if rid is null then
    raise exception 'Restaurant membership not found' using errcode='42501';
  end if;

  select jsonb_build_object(
    'restaurant', (
      select jsonb_build_object(
        'id', r.id,
        'name', r.name,
        'slug', r.slug,
        'logo_url', r.logo_url,
        'cover_url', r.cover_url
      )
      from public.restaurants r
      where r.id = rid
    ),
    'summary', jsonb_build_object(
      'program_count', (select count(*) from public.restaurant_stamp_programs where restaurant_id = rid),
      'active_count', (select count(*) from public.restaurant_stamp_programs where restaurant_id = rid and is_active and starts_at <= now() and (ends_at is null or ends_at > now())),
      'member_count', (select count(distinct customer_user_id) from public.customer_stamp_cards where restaurant_id = rid),
      'stamps_issued', coalesce((select sum(stamps_delta) from public.customer_stamp_events where restaurant_id = rid and event_type in ('earned','manual_adjustment','qr_claim')), 0),
      'completed_cards', (select count(*) from public.customer_stamp_events where restaurant_id = rid and event_type = 'completion')
    ),
    'programs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'description', p.description,
        'eligibility_type', p.eligibility_type,
        'menu_item_id', p.menu_item_id,
        'minimum_order_pence', p.minimum_order_pence,
        'stamps_per_qualifying_order', p.stamps_per_qualifying_order,
        'stamps_required', p.stamps_required,
        'reward_id', p.reward_id,
        'reward_name', rw.name,
        'repeatable', p.repeatable,
        'card_expiry_days', p.card_expiry_days,
        'starts_at', p.starts_at,
        'ends_at', p.ends_at,
        'is_active', p.is_active,
        'created_at', p.created_at
      ) order by p.created_at desc)
      from public.restaurant_stamp_programs p
      left join public.restaurant_loyalty_rewards rw on rw.id = p.reward_id
      where p.restaurant_id = rid
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_restaurant_stamp_programs() from public, anon;
grant execute on function public.get_restaurant_stamp_programs() to authenticated, service_role;
