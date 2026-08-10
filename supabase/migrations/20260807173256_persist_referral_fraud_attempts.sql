create or replace function public.claim_referral_attribution(p_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); t public.referral_attribution_tokens%rowtype; c public.customer_referral_codes%rowtype; p public.restaurant_referral_programs%rowtype; existing public.customer_referrals%rowtype; newref public.customer_referrals%rowtype; recent_count integer; total_count integer;
begin
  if uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into t from public.referral_attribution_tokens where id=p_token for update;
  if not found or t.expires_at<=now() then raise exception 'Referral attribution has expired'; end if;
  if t.claimed_at is not null then
    if t.claimed_by_user_id=uid then return jsonb_build_object('claimed',true,'referral_id',t.referral_id); end if;
    raise exception 'Referral attribution has already been claimed';
  end if;
  select * into c from public.customer_referral_codes where id=t.referral_code_id and is_active;
  select * into p from public.restaurant_referral_programs where id=t.program_id and is_enabled and not disabled_by_platform and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>now());
  if not found then raise exception 'Referral programme is not currently available'; end if;
  if c.customer_user_id=uid then
    insert into public.referral_fraud_flags(restaurant_id,flag_type,severity,details) values(p.restaurant_id,'self_referral','high',jsonb_build_object('user_id',uid,'code_id',c.id));
    update public.referral_attribution_tokens set claimed_at=now(),claimed_by_user_id=uid where id=t.id;
    return jsonb_build_object('claimed',false,'status','rejected','reason','self_referral');
  end if;
  select * into existing from public.customer_referrals where restaurant_id=p.restaurant_id and referred_user_id=uid limit 1;
  if found then
    if existing.referrer_user_id<>c.customer_user_id then insert into public.referral_fraud_flags(referral_id,restaurant_id,flag_type,severity,details) values(existing.id,p.restaurant_id,'duplicate_referee','high',jsonb_build_object('attempted_code_id',c.id)); end if;
    update public.referral_attribution_tokens set claimed_at=now(),claimed_by_user_id=uid,referral_id=existing.id where id=t.id;
    return jsonb_build_object('claimed',existing.referrer_user_id=c.customer_user_id,'referral_id',existing.id,'status',existing.status);
  end if;
  if exists(select 1 from public.orders o where o.restaurant_id=p.restaurant_id and o.customer_user_id=uid and o.payment_status='paid' and o.created_at<t.created_at) then
    insert into public.customer_referrals(restaurant_id,program_id,referrer_user_id,referred_user_id,referral_code_id,referral_code,status,registered_at,rejected_at,rejection_reason)
    values(p.restaurant_id,p.id,c.customer_user_id,uid,c.id,c.code,'rejected',now(),now(),'existing_customer') returning * into newref;
    insert into public.referral_events(referral_id,restaurant_id,event_type,new_status,actor_user_id,actor_kind,metadata) values(newref.id,p.restaurant_id,'rejected_existing_customer','rejected',uid,'customer','{}');
    update public.referral_attribution_tokens set claimed_at=now(),claimed_by_user_id=uid,referral_id=newref.id where id=t.id;
    return jsonb_build_object('claimed',false,'referral_id',newref.id,'status','rejected','reason','existing_customer');
  end if;
  select count(*) into total_count from public.customer_referrals x where x.program_id=p.id and x.status<>'rejected';
  if p.campaign_referral_cap is not null and total_count>=p.campaign_referral_cap then
    insert into public.referral_fraud_flags(restaurant_id,flag_type,severity,details) values(p.restaurant_id,'campaign_cap_attempt','low',jsonb_build_object('code_id',c.id));
    update public.referral_attribution_tokens set claimed_at=now(),claimed_by_user_id=uid where id=t.id;
    return jsonb_build_object('claimed',false,'status','rejected','reason','campaign_cap_reached');
  end if;
  if p.maximum_referrals_per_customer is not null and (select count(*) from public.customer_referrals x where x.program_id=p.id and x.referrer_user_id=c.customer_user_id and x.status<>'rejected')>=p.maximum_referrals_per_customer then
    update public.referral_attribution_tokens set claimed_at=now(),claimed_by_user_id=uid where id=t.id;
    return jsonb_build_object('claimed',false,'status','rejected','reason','referrer_limit_reached');
  end if;
  insert into public.customer_referrals(restaurant_id,program_id,referrer_user_id,referred_user_id,referral_code_id,referral_code,status,registered_at)
  values(p.restaurant_id,p.id,c.customer_user_id,uid,c.id,c.code,'registered',now()) returning * into newref;
  insert into public.referral_events(referral_id,restaurant_id,event_type,new_status,actor_user_id,actor_kind) values(newref.id,p.restaurant_id,'registered','registered',uid,'customer');
  update public.referral_attribution_tokens set claimed_at=now(),claimed_by_user_id=uid,referral_id=newref.id where id=t.id;
  perform private.queue_referral_notification(newref.id,null,c.customer_user_id,p.restaurant_id,'friend_registered','Your friend joined','A friend used your referral link and created their account.');
  select count(*) into recent_count from public.customer_referrals x where x.referrer_user_id=c.customer_user_id and x.created_at>=now()-interval '24 hours';
  if recent_count>=10 then insert into public.referral_fraud_flags(referral_id,restaurant_id,flag_type,severity,details) values(newref.id,p.restaurant_id,'referral_velocity',case when recent_count>=25 then 'high' else 'medium' end,jsonb_build_object('referrals_24h',recent_count)); end if;
  return jsonb_build_object('claimed',true,'referral_id',newref.id,'status','registered');
end$$;
