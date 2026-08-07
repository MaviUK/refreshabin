create or replace function private.issue_campaign_reward(p_issuance_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare rw public.customer_reward_issuances%rowtype; acct public.customer_credit_accounts%rowtype; lacct public.customer_loyalty_accounts%rowtype; ledger uuid; vid uuid; v_code text; title text; body text; duplicate_accounts integer:=0; dob_changed timestamptz; dob_set timestamptz; multiplier integer:=10000; base_value integer; reward_row public.restaurant_loyalty_rewards%rowtype;
begin
  select * into rw from public.customer_reward_issuances where id=p_issuance_id for update;
  if not found or rw.status<>'pending' then return; end if;
  if rw.source_type='birthday' then
    select p.date_of_birth_set_at,p.date_of_birth_last_changed_at into dob_set,dob_changed from public.customer_profiles p where p.user_id=rw.customer_user_id;
    if dob_set is not null and dob_set > now()-interval '14 days' then
      perform private.flag_campaign_fraud(rw.restaurant_id,rw.customer_user_id,rw.id,'birthday','recent_dob_set','high',jsonb_build_object('set_at',dob_set));
      update public.customer_reward_issuances set status='blocked',metadata=metadata||jsonb_build_object('blocked_reason','recent_dob_set'),updated_at=now() where id=rw.id; return;
    end if;
    if dob_changed is not null and dob_changed > now()-interval '30 days' then
      perform private.flag_campaign_fraud(rw.restaurant_id,rw.customer_user_id,rw.id,'birthday','recent_dob_change','high',jsonb_build_object('changed_at',dob_changed));
      update public.customer_reward_issuances set status='blocked',metadata=metadata||jsonb_build_object('blocked_reason','recent_dob_change'),updated_at=now() where id=rw.id; return;
    end if;
    select count(*) into duplicate_accounts from public.customer_profiles p join public.customer_profiles self on self.user_id=rw.customer_user_id where p.user_id<>self.user_id and p.date_of_birth=self.date_of_birth and self.phone is not null and p.phone is not null and regexp_replace(p.phone,'\D','','g')=regexp_replace(self.phone,'\D','','g');
    if duplicate_accounts>0 then
      perform private.flag_campaign_fraud(rw.restaurant_id,rw.customer_user_id,rw.id,'birthday','shared_phone_and_dob','high',jsonb_build_object('matching_accounts',duplicate_accounts));
      update public.customer_reward_issuances set status='blocked',metadata=metadata||jsonb_build_object('blocked_reason','shared_phone_and_dob','matching_accounts',duplicate_accounts),updated_at=now() where id=rw.id; return;
    end if;
    multiplier:=private.get_customer_vip_multiplier(rw.restaurant_id,rw.customer_user_id,'birthday_bonus_multiplier');
    if multiplier>10000 and coalesce((rw.metadata->>'vip_multiplier_applied')::boolean,false)=false and rw.reward_type not in ('free_item','free_delivery') then
      base_value:=rw.reward_value; rw.reward_value:=round(base_value*multiplier/10000.0);
      update public.customer_reward_issuances set reward_value=rw.reward_value,metadata=metadata||jsonb_build_object('vip_multiplier_applied',true,'vip_multiplier_basis_points',multiplier,'base_reward_value',base_value),updated_at=now() where id=rw.id;
    end if;
  end if;
  if rw.reward_type='wallet_credit' then
    insert into public.customer_credit_accounts(restaurant_id,customer_user_id,balance_pence) values(rw.restaurant_id,rw.customer_user_id,0) on conflict(restaurant_id,customer_user_id) do nothing;
    select * into acct from public.customer_credit_accounts where restaurant_id=rw.restaurant_id and customer_user_id=rw.customer_user_id for update;
    insert into public.customer_credit_ledger(credit_account_id,restaurant_id,customer_user_id,amount_pence,entry_type,note,reward_issuance_id)
    values(acct.id,rw.restaurant_id,rw.customer_user_id,rw.reward_value,case rw.source_type when 'birthday' then 'birthday_credit' when 'vip' then 'vip_credit' else 'milestone_credit' end,case rw.source_type when 'birthday' then 'Birthday reward' when 'vip' then 'VIP reward' else 'Milestone reward' end,rw.id)
    on conflict(reward_issuance_id) where reward_issuance_id is not null do nothing returning id into ledger;
    if ledger is not null then update public.customer_credit_accounts set balance_pence=balance_pence+rw.reward_value,updated_at=now() where id=acct.id; end if;
    update public.customer_reward_issuances set status='available',issued_at=coalesce(issued_at,now()),campaign_cost_pence=reward_value,metadata=metadata||jsonb_build_object('credit_ledger_id',ledger),updated_at=now() where id=rw.id;
  elsif rw.reward_type='loyalty_points' then
    insert into public.customer_loyalty_accounts(restaurant_id,customer_user_id,points_balance,lifetime_points_earned,lifetime_points_redeemed) values(rw.restaurant_id,rw.customer_user_id,0,0,0) on conflict(restaurant_id,customer_user_id) do nothing;
    select * into lacct from public.customer_loyalty_accounts where restaurant_id=rw.restaurant_id and customer_user_id=rw.customer_user_id for update;
    insert into public.customer_loyalty_ledger(loyalty_account_id,restaurant_id,customer_user_id,points_delta,entry_type,note,reward_issuance_id)
    values(lacct.id,rw.restaurant_id,rw.customer_user_id,rw.reward_value,case rw.source_type when 'birthday' then 'birthday_bonus' when 'vip' then 'vip_bonus' else 'milestone_bonus' end,case rw.source_type when 'birthday' then 'Birthday reward' when 'vip' then 'VIP reward' else 'Milestone reward' end,rw.id)
    on conflict(reward_issuance_id) where reward_issuance_id is not null do nothing returning id into ledger;
    if ledger is not null then update public.customer_loyalty_accounts set points_balance=points_balance+rw.reward_value,lifetime_points_earned=lifetime_points_earned+rw.reward_value,updated_at=now() where id=lacct.id; end if;
    update public.customer_reward_issuances set status='available',issued_at=coalesce(issued_at,now()),loyalty_ledger_id=coalesce(loyalty_ledger_id,ledger),updated_at=now() where id=rw.id;
  else
    if rw.reward_catalogue_id is null then raise exception 'Reward catalogue entry is missing'; end if;
    select * into reward_row from public.restaurant_loyalty_rewards where id=rw.reward_catalogue_id;
    loop v_code:=case rw.source_type when 'birthday' then 'BD-' when 'vip' then 'VIP-' else 'MS-' end||upper(substr(encode(extensions.gen_random_bytes(10),'hex'),1,14)); exit when not exists(select 1 from public.customer_reward_vouchers v where v.restaurant_id=rw.restaurant_id and v.code=v_code); end loop;
    insert into public.customer_reward_vouchers(reward_id,restaurant_id,customer_user_id,code,points_spent,expires_at,reward_issuance_id,override_fixed_value_pence,override_percentage_basis_points,benefit_source_type,benefit_source_id)
    values(rw.reward_catalogue_id,rw.restaurant_id,rw.customer_user_id,v_code,0,rw.expires_at,rw.id,
      case when rw.reward_type in ('fixed_discount','voucher') and rw.reward_value<>coalesce(reward_row.fixed_value_pence,0) then rw.reward_value else null end,
      case when rw.reward_type='percentage_discount' and rw.reward_value<>coalesce(reward_row.percentage_basis_points,0) then least(rw.reward_value,10000) else null end,
      rw.source_type,rw.source_id)
    on conflict(reward_issuance_id) where reward_issuance_id is not null do nothing returning id into vid;
    if vid is null then select id into vid from public.customer_reward_vouchers where reward_issuance_id=rw.id; end if;
    update public.customer_reward_issuances set status='available',issued_at=coalesce(issued_at,now()),voucher_id=vid,campaign_cost_pence=case when reward_type in('fixed_discount','voucher') then reward_value else campaign_cost_pence end,updated_at=now() where id=rw.id;
  end if;
  title:=case rw.source_type when 'birthday' then 'Birthday reward available' when 'vip' then 'VIP reward available' else 'Reward earned' end;
  body:=coalesce(rw.metadata->>'campaign_message',case rw.source_type when 'birthday' then 'Happy Birthday! Your reward is ready.' when 'vip' then 'A new VIP reward is ready in your account.' else 'You reached a new milestone. Your reward is ready!' end);
  perform private.queue_campaign_notification(rw.id,case rw.source_type when 'birthday' then 'birthday_reward_available' when 'vip' then 'vip_reward_available' else 'reward_earned' end,title,body);
end $$;
