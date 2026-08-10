create or replace function private.get_customer_vip_early_access_hours(
  p_restaurant_id uuid,
  p_customer_user_id uuid
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(greatest(1, least(168, coalesce(nullif(b.metadata->>'hours_before','')::integer, 24)))), 0)::integer
  from public.customer_vip_memberships m
  join public.restaurant_vip_programs p
    on p.restaurant_id = m.restaurant_id
   and p.is_enabled
   and not p.disabled_by_platform
  join public.restaurant_vip_tiers t
    on t.id = m.current_tier_id
   and t.restaurant_id = m.restaurant_id
   and t.is_active
   and t.archived_at is null
  join public.restaurant_vip_tier_benefits b
    on b.tier_id = t.id
   and b.restaurant_id = t.restaurant_id
   and b.benefit_type = 'early_access_promotions'
   and b.is_active
  where m.restaurant_id = p_restaurant_id
    and m.customer_user_id = p_customer_user_id;
$$;

revoke all on function private.get_customer_vip_early_access_hours(uuid,uuid) from public, anon, authenticated;
grant execute on function private.get_customer_vip_early_access_hours(uuid,uuid) to service_role;

create or replace function public.validate_restaurant_promotion(
  p_restaurant_id uuid,
  p_code text,
  p_subtotal_pence integer,
  p_delivery_fee_pence integer,
  p_fulfilment_method text,
  p_customer_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  promotion public.restaurant_promotions%rowtype;
  customer_redemptions integer := 0;
  discount integer := 0;
  early_access_hours integer := 0;
begin
  if auth.uid() is not null then
    early_access_hours := private.get_customer_vip_early_access_hours(p_restaurant_id, auth.uid());
  end if;

  select * into promotion
  from public.restaurant_promotions
  where restaurant_id = p_restaurant_id
    and upper(code) = upper(trim(p_code))
    and is_active = true
    and (ends_at is null or ends_at > now())
    and (
      starts_at <= now()
      or (
        early_access_hours > 0
        and starts_at <= now() + make_interval(hours => early_access_hours)
      )
    )
  limit 1;

  if not found then
    return jsonb_build_object('valid',false,'error','Promotion code is invalid or expired.');
  end if;
  if p_fulfilment_method <> all(promotion.fulfilment_methods) then
    return jsonb_build_object('valid',false,'error','Promotion is not valid for this fulfilment method.');
  end if;
  if p_subtotal_pence < promotion.minimum_order_pence then
    return jsonb_build_object('valid',false,'error','Minimum order value has not been reached.');
  end if;
  if promotion.total_redemption_limit is not null and promotion.redemption_count >= promotion.total_redemption_limit then
    return jsonb_build_object('valid',false,'error','Promotion redemption limit has been reached.');
  end if;
  if promotion.per_customer_limit is not null and p_customer_email is not null then
    select count(*) into customer_redemptions
    from public.promotion_redemptions
    where promotion_id = promotion.id
      and lower(customer_email) = lower(p_customer_email);
    if customer_redemptions >= promotion.per_customer_limit then
      return jsonb_build_object('valid',false,'error','You have already used this promotion.');
    end if;
  end if;

  discount := case promotion.promotion_type
    when 'percentage' then round(p_subtotal_pence * promotion.percentage_basis_points / 10000.0)
    when 'fixed' then promotion.fixed_discount_pence
    when 'free_delivery' then p_delivery_fee_pence
    else coalesce(promotion.fixed_discount_pence,0)
  end;
  discount := least(discount,p_subtotal_pence+p_delivery_fee_pence);
  if promotion.maximum_discount_pence is not null then
    discount := least(discount,promotion.maximum_discount_pence);
  end if;

  return jsonb_build_object(
    'valid',true,
    'promotion_id',promotion.id,
    'code',promotion.code,
    'name',promotion.name,
    'discount_pence',greatest(discount,0),
    'vip_early_access',promotion.starts_at > now()
  );
end;
$$;

create or replace function private.issue_referral_reward(p_reward_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rw public.referral_rewards%rowtype;
  ref public.customer_referrals%rowtype;
  p public.restaurant_referral_programs%rowtype;
  acct public.customer_credit_accounts%rowtype;
  lacct public.customer_loyalty_accounts%rowtype;
  ledger_id uuid;
  v_code text;
  vid uuid;
  catalogue uuid;
  title text;
begin
  select * into rw from public.referral_rewards where id=p_reward_id for update;
  if not found or rw.status<>'pending' or rw.available_at>now() then return; end if;
  select * into ref from public.customer_referrals where id=rw.referral_id;
  select * into p from public.restaurant_referral_programs where id=ref.program_id;
  if ref.status='rejected' then
    update public.referral_rewards set status='reversed',reversed_at=now(),reversal_reason='Referral no longer qualifies',updated_at=now() where id=rw.id;
    return;
  end if;

  if rw.reward_type='store_credit' then
    insert into public.customer_credit_accounts(restaurant_id,customer_user_id,balance_pence)
    values(rw.restaurant_id,rw.customer_user_id,0)
    on conflict(restaurant_id,customer_user_id) do nothing;
    select * into acct from public.customer_credit_accounts where restaurant_id=rw.restaurant_id and customer_user_id=rw.customer_user_id for update;
    insert into public.customer_credit_ledger(credit_account_id,restaurant_id,customer_user_id,amount_pence,entry_type,note,referral_reward_id)
    values(acct.id,rw.restaurant_id,rw.customer_user_id,rw.reward_value,'referral_credit','Referral reward',rw.id)
    on conflict(referral_reward_id) where referral_reward_id is not null do nothing returning id into ledger_id;
    if ledger_id is not null then
      update public.customer_credit_accounts set balance_pence=balance_pence+rw.reward_value,updated_at=now() where id=acct.id;
    end if;
    update public.referral_rewards set status='available',issued_at=coalesce(issued_at,now()),credit_ledger_id=coalesce(credit_ledger_id,ledger_id),updated_at=now() where id=rw.id;
  elsif rw.reward_type='loyalty_points' then
    insert into public.customer_loyalty_accounts(restaurant_id,customer_user_id,points_balance,lifetime_points_earned,lifetime_points_redeemed)
    values(rw.restaurant_id,rw.customer_user_id,0,0,0)
    on conflict(restaurant_id,customer_user_id) do nothing;
    select * into lacct from public.customer_loyalty_accounts where restaurant_id=rw.restaurant_id and customer_user_id=rw.customer_user_id for update;
    insert into public.customer_loyalty_ledger(loyalty_account_id,restaurant_id,customer_user_id,points_delta,entry_type,note,referral_reward_id)
    values(lacct.id,rw.restaurant_id,rw.customer_user_id,rw.reward_value,'referral_bonus','Referral reward',rw.id)
    on conflict(referral_reward_id) where referral_reward_id is not null do nothing returning id into ledger_id;
    if ledger_id is not null then
      update public.customer_loyalty_accounts set points_balance=points_balance+rw.reward_value,lifetime_points_earned=lifetime_points_earned+rw.reward_value,updated_at=now() where id=lacct.id;
    end if;
    update public.referral_rewards set status='available',issued_at=coalesce(issued_at,now()),loyalty_ledger_id=coalesce(loyalty_ledger_id,ledger_id),updated_at=now() where id=rw.id;
  else
    catalogue:=case when rw.recipient_role='referrer' then p.referrer_reward_catalogue_id else p.referee_reward_catalogue_id end;
    if catalogue is null then raise exception 'Referral voucher catalogue is not configured'; end if;
    loop
      v_code:='RF-'||upper(substr(encode(extensions.gen_random_bytes(10),'hex'),1,14));
      exit when not exists(select 1 from public.customer_reward_vouchers v where v.restaurant_id=rw.restaurant_id and v.code=v_code);
    end loop;
    insert into public.customer_reward_vouchers(
      reward_id,restaurant_id,customer_user_id,code,points_spent,expires_at,referral_reward_id,
      override_fixed_value_pence,override_percentage_basis_points,benefit_source_type,benefit_source_id
    ) values(
      catalogue,rw.restaurant_id,rw.customer_user_id,v_code,0,now()+interval '90 days',rw.id,
      case when rw.reward_type='fixed_value_voucher' then rw.reward_value else null end,
      case when rw.reward_type='percentage_voucher' then least(rw.reward_value,10000) else null end,
      case when rw.vip_multiplier_basis_points>10000 then 'vip_referral_multiplier' else null end,
      case when rw.vip_multiplier_basis_points>10000 then rw.id else null end
    )
    on conflict(referral_reward_id) where referral_reward_id is not null do nothing returning id into vid;
    if vid is null then select id into vid from public.customer_reward_vouchers where referral_reward_id=rw.id; end if;
    update public.referral_rewards set status='available',issued_at=coalesce(issued_at,now()),voucher_id=vid,updated_at=now() where id=rw.id;
  end if;

  title:=case when rw.recipient_role='referrer' then 'Referral reward available' else 'Your referral reward is ready' end;
  perform private.queue_referral_notification(ref.id,rw.id,rw.customer_user_id,rw.restaurant_id,'reward_available',title,private.referral_reward_label(rw.reward_type,rw.reward_value)||' is now available in your account.');
  if not exists(select 1 from public.referral_rewards z where z.referral_id=ref.id and z.status='pending') then
    update public.customer_referrals set status='rewarded',rewarded_at=coalesce(rewarded_at,now()),updated_at=now() where id=ref.id and status='qualified';
    if found then
      insert into public.referral_events(referral_id,restaurant_id,event_type,old_status,new_status,actor_kind)
      values(ref.id,ref.restaurant_id,'rewarded','qualified','rewarded','system');
    end if;
  end if;
end;
$$;
