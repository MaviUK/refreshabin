create or replace function private.issue_referral_reward(p_reward_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare rw public.referral_rewards%rowtype; ref public.customer_referrals%rowtype; p public.restaurant_referral_programs%rowtype; acct public.customer_credit_accounts%rowtype; lacct public.customer_loyalty_accounts%rowtype; ledger_id uuid; v_code text; vid uuid; catalogue uuid; title text;
begin
  select * into rw from public.referral_rewards where id=p_reward_id for update;
  if not found or rw.status<>'pending' or rw.available_at>now() then return; end if;
  select * into ref from public.customer_referrals where id=rw.referral_id;
  select * into p from public.restaurant_referral_programs where id=ref.program_id;
  if ref.status='rejected' then update public.referral_rewards set status='reversed',reversed_at=now(),reversal_reason='Referral no longer qualifies',updated_at=now() where id=rw.id; return; end if;
  if rw.reward_type='store_credit' then
    insert into public.customer_credit_accounts(restaurant_id,customer_user_id,balance_pence) values(rw.restaurant_id,rw.customer_user_id,0) on conflict(restaurant_id,customer_user_id) do nothing;
    select * into acct from public.customer_credit_accounts where restaurant_id=rw.restaurant_id and customer_user_id=rw.customer_user_id for update;
    insert into public.customer_credit_ledger(credit_account_id,restaurant_id,customer_user_id,amount_pence,entry_type,note,referral_reward_id) values(acct.id,rw.restaurant_id,rw.customer_user_id,rw.reward_value,'referral_credit','Referral reward',rw.id) on conflict(referral_reward_id) where referral_reward_id is not null do nothing returning id into ledger_id;
    if ledger_id is not null then update public.customer_credit_accounts set balance_pence=balance_pence+rw.reward_value,updated_at=now() where id=acct.id; end if;
    update public.referral_rewards set status='available',issued_at=coalesce(issued_at,now()),credit_ledger_id=coalesce(credit_ledger_id,ledger_id),updated_at=now() where id=rw.id;
  elsif rw.reward_type='loyalty_points' then
    insert into public.customer_loyalty_accounts(restaurant_id,customer_user_id,points_balance,lifetime_points_earned,lifetime_points_redeemed) values(rw.restaurant_id,rw.customer_user_id,0,0,0) on conflict(restaurant_id,customer_user_id) do nothing;
    select * into lacct from public.customer_loyalty_accounts where restaurant_id=rw.restaurant_id and customer_user_id=rw.customer_user_id for update;
    insert into public.customer_loyalty_ledger(loyalty_account_id,restaurant_id,customer_user_id,points_delta,entry_type,note,referral_reward_id) values(lacct.id,rw.restaurant_id,rw.customer_user_id,rw.reward_value,'referral_bonus','Referral reward',rw.id) on conflict(referral_reward_id) where referral_reward_id is not null do nothing returning id into ledger_id;
    if ledger_id is not null then update public.customer_loyalty_accounts set points_balance=points_balance+rw.reward_value,lifetime_points_earned=lifetime_points_earned+rw.reward_value,updated_at=now() where id=lacct.id; end if;
    update public.referral_rewards set status='available',issued_at=coalesce(issued_at,now()),loyalty_ledger_id=coalesce(loyalty_ledger_id,ledger_id),updated_at=now() where id=rw.id;
  else
    catalogue:=case when rw.recipient_role='referrer' then p.referrer_reward_catalogue_id else p.referee_reward_catalogue_id end;
    if catalogue is null then raise exception 'Referral voucher catalogue is not configured'; end if;
    loop v_code:='RF-'||upper(substr(encode(extensions.gen_random_bytes(10),'hex'),1,14)); exit when not exists(select 1 from public.customer_reward_vouchers v where v.restaurant_id=rw.restaurant_id and v.code=v_code); end loop;
    insert into public.customer_reward_vouchers(reward_id,restaurant_id,customer_user_id,code,points_spent,expires_at,referral_reward_id) values(catalogue,rw.restaurant_id,rw.customer_user_id,v_code,0,now()+interval '90 days',rw.id) on conflict(referral_reward_id) where referral_reward_id is not null do nothing returning id into vid;
    if vid is null then select id into vid from public.customer_reward_vouchers where referral_reward_id=rw.id; end if;
    update public.referral_rewards set status='available',issued_at=coalesce(issued_at,now()),voucher_id=vid,updated_at=now() where id=rw.id;
  end if;
  title:=case when rw.recipient_role='referrer' then 'Referral reward available' else 'Your referral reward is ready' end;
  perform private.queue_referral_notification(ref.id,rw.id,rw.customer_user_id,rw.restaurant_id,'reward_available',title,private.referral_reward_label(rw.reward_type,rw.reward_value)||' is now available in your account.');
  if not exists(select 1 from public.referral_rewards z where z.referral_id=ref.id and z.status='pending') then
    update public.customer_referrals set status='rewarded',rewarded_at=coalesce(rewarded_at,now()),updated_at=now() where id=ref.id and status='qualified';
    if found then insert into public.referral_events(referral_id,restaurant_id,event_type,old_status,new_status,actor_kind) values(ref.id,ref.restaurant_id,'rewarded','qualified','rewarded','system'); end if;
  end if;
end$$;

create or replace function private.reverse_referral_rewards(p_referral_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare rw public.referral_rewards%rowtype; acct public.customer_credit_accounts%rowtype; lacct public.customer_loyalty_accounts%rowtype; v public.customer_reward_vouchers%rowtype;
begin
  for rw in select * from public.referral_rewards where referral_id=p_referral_id and status in ('pending','available') for update loop
    if rw.status='pending' then update public.referral_rewards set status='reversed',reversed_at=now(),reversal_reason=p_reason,updated_at=now() where id=rw.id; continue; end if;
    if rw.reward_type='store_credit' then
      select * into acct from public.customer_credit_accounts where restaurant_id=rw.restaurant_id and customer_user_id=rw.customer_user_id for update;
      if found and acct.balance_pence>=rw.reward_value then
        update public.customer_credit_accounts set balance_pence=balance_pence-rw.reward_value,updated_at=now() where id=acct.id;
        insert into public.customer_credit_ledger(credit_account_id,restaurant_id,customer_user_id,amount_pence,entry_type,note) values(acct.id,rw.restaurant_id,rw.customer_user_id,-rw.reward_value,'manual_credit','Referral reward reversal: '||p_reason);
        update public.referral_rewards set status='reversed',reversed_at=now(),reversal_reason=p_reason,updated_at=now() where id=rw.id;
      else update public.referral_rewards set status='manual_review',reversal_reason=p_reason,updated_at=now() where id=rw.id; insert into public.referral_fraud_flags(referral_id,restaurant_id,flag_type,severity,details) values(p_referral_id,rw.restaurant_id,'reward_reversal_failed','high',jsonb_build_object('reward_id',rw.id,'reason','credit_already_spent')); end if;
    elsif rw.reward_type='loyalty_points' then
      select * into lacct from public.customer_loyalty_accounts where restaurant_id=rw.restaurant_id and customer_user_id=rw.customer_user_id for update;
      if found and lacct.points_balance>=rw.reward_value then
        update public.customer_loyalty_accounts set points_balance=points_balance-rw.reward_value,updated_at=now() where id=lacct.id;
        insert into public.customer_loyalty_ledger(loyalty_account_id,restaurant_id,customer_user_id,points_delta,entry_type,note) values(lacct.id,rw.restaurant_id,rw.customer_user_id,-rw.reward_value,'refund_reversal','Referral reward reversal: '||p_reason);
        update public.referral_rewards set status='reversed',reversed_at=now(),reversal_reason=p_reason,updated_at=now() where id=rw.id;
      else update public.referral_rewards set status='manual_review',reversal_reason=p_reason,updated_at=now() where id=rw.id; insert into public.referral_fraud_flags(referral_id,restaurant_id,flag_type,severity,details) values(p_referral_id,rw.restaurant_id,'reward_reversal_failed','high',jsonb_build_object('reward_id',rw.id,'reason','points_already_spent')); end if;
    else
      select * into v from public.customer_reward_vouchers where id=rw.voucher_id for update;
      if found and v.status='available' then update public.customer_reward_vouchers set status='cancelled',cancelled_at=now() where id=v.id; update public.referral_rewards set status='reversed',reversed_at=now(),reversal_reason=p_reason,updated_at=now() where id=rw.id;
      elsif found and v.status in ('reserved','redeemed') then update public.referral_rewards set status='manual_review',reversal_reason=p_reason,updated_at=now() where id=rw.id; insert into public.referral_fraud_flags(referral_id,restaurant_id,flag_type,severity,details) values(p_referral_id,rw.restaurant_id,'reward_reversal_failed','high',jsonb_build_object('reward_id',rw.id,'voucher_status',v.status));
      else update public.referral_rewards set status='reversed',reversed_at=now(),reversal_reason=p_reason,updated_at=now() where id=rw.id; end if;
    end if;
  end loop;
end$$;
