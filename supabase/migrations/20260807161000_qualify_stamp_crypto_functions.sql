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

  raw_token := encode(extensions.gen_random_bytes(24), 'hex');
  expiry := now() + make_interval(mins => p_valid_minutes);

  insert into public.stamp_qr_campaigns(
    program_id, restaurant_id, token_hash, stamps_awarded,
    max_claims, expires_at, created_by
  ) values (
    p_program_id, rid, encode(extensions.digest(raw_token, 'sha256'), 'hex'), p_stamps,
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

create or replace function public.claim_stamp_qr(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  campaign public.stamp_qr_campaigns%rowtype;
  result jsonb;
begin
  if uid is null then raise exception 'Authentication required' using errcode='42501'; end if;

  select * into campaign
  from public.stamp_qr_campaigns
  where token_hash = encode(extensions.digest(trim(p_token), 'sha256'), 'hex')
  for update;

  if not found or not campaign.is_active or campaign.expires_at <= now() then
    raise exception 'This stamp QR code is invalid or expired';
  end if;
  if campaign.claim_count >= campaign.max_claims then
    raise exception 'This stamp QR code has reached its claim limit';
  end if;
  if exists(select 1 from public.stamp_qr_claims where campaign_id=campaign.id and customer_user_id=uid) then
    raise exception 'You have already claimed this stamp QR code';
  end if;

  result := public.add_customer_stamp_progress(campaign.program_id,uid,campaign.stamps_awarded,'qr_claim','Stamp claimed from restaurant QR code',null);
  insert into public.stamp_qr_claims(campaign_id,program_id,restaurant_id,customer_user_id,stamps_awarded)
  values(campaign.id,campaign.program_id,campaign.restaurant_id,uid,campaign.stamps_awarded);
  update public.stamp_qr_campaigns
  set claim_count=claim_count+1,
      is_active=case when claim_count+1>=max_claims then false else is_active end
  where id=campaign.id;

  return result || jsonb_build_object('stamps_awarded',campaign.stamps_awarded,'restaurant_id',campaign.restaurant_id,'program_id',campaign.program_id);
end;
$$;

create or replace function public.issue_stamp_completion_reward(p_card_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  card public.customer_stamp_cards%rowtype;
  program public.restaurant_stamp_programs%rowtype;
  reward public.restaurant_loyalty_rewards%rowtype;
  voucher_id uuid;
  voucher_code text;
begin
  select * into card from public.customer_stamp_cards where id=p_card_id for update;
  if not found then raise exception 'Stamp card not found'; end if;
  select * into program from public.restaurant_stamp_programs where id=card.program_id for update;
  select * into reward from public.restaurant_loyalty_rewards where id=program.reward_id for update;
  if not found or not reward.is_active then raise exception 'Stamp reward is unavailable'; end if;
  if reward.total_redemption_limit is not null and reward.redemption_count >= reward.total_redemption_limit then raise exception 'Stamp reward limit reached'; end if;
  if reward.stock_remaining is not null and reward.stock_remaining <= 0 then raise exception 'Stamp reward is out of stock'; end if;

  loop
    voucher_code := 'ST-' || upper(substr(encode(extensions.gen_random_bytes(10),'hex'),1,14));
    exit when not exists(select 1 from public.customer_reward_vouchers where restaurant_id=card.restaurant_id and code=voucher_code);
  end loop;

  insert into public.customer_reward_vouchers(reward_id,restaurant_id,customer_user_id,code,points_spent,status,expires_at)
  values(reward.id,card.restaurant_id,card.customer_user_id,voucher_code,0,'available',coalesce(reward.ends_at,now()+interval '90 days'))
  returning id into voucher_id;

  update public.restaurant_loyalty_rewards
  set redemption_count=redemption_count+1,
      stock_remaining=case when stock_remaining is null then null else greatest(stock_remaining-1,0) end,
      updated_at=now()
  where id=reward.id;

  return voucher_id;
end;
$$;

revoke all on function public.create_stamp_qr_campaign(uuid, integer, integer, integer) from public, anon;
grant execute on function public.create_stamp_qr_campaign(uuid, integer, integer, integer) to authenticated, service_role;
revoke all on function public.claim_stamp_qr(text) from public, anon;
grant execute on function public.claim_stamp_qr(text) to authenticated, service_role;
revoke all on function public.issue_stamp_completion_reward(uuid) from public, anon, authenticated;
grant execute on function public.issue_stamp_completion_reward(uuid) to service_role;
