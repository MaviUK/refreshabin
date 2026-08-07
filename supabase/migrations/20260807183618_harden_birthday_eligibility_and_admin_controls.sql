create or replace function private.issue_campaign_reward(p_issuance_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare rw public.customer_reward_issuances%rowtype; acct public.customer_credit_accounts%rowtype; lacct public.customer_loyalty_accounts%rowtype; ledger uuid; vid uuid; code text; title text; body text; duplicate_accounts integer:=0; dob_changed timestamptz; dob_set timestamptz;
begin
  select * into rw from public.customer_reward_issuances where id=p_issuance_id for update;
  if not found or rw.status<>'pending' then return; end if;
  if rw.source_type='birthday' then
    select p.date_of_birth_set_at,p.date_of_birth_last_changed_at into dob_set,dob_changed from public.customer_profiles p where p.user_id=rw.customer_user_id;
    if dob_set is not null and dob_set > now()-interval '14 days' then
      perform private.flag_campaign_fraud(rw.restaurant_id,rw.customer_user_id,rw.id,'birthday','recent_dob_set','high',jsonb_build_object('set_at',dob_set));
      update public.customer_reward_issuances set status='blocked',metadata=metadata||jsonb_build_object('blocked_reason','recent_dob_set'),updated_at=now() where id=rw.id;
      return;
    end if;
    if dob_changed is not null and dob_changed > now()-interval '30 days' then
      perform private.flag_campaign_fraud(rw.restaurant_id,rw.customer_user_id,rw.id,'birthday','recent_dob_change','high',jsonb_build_object('changed_at',dob_changed));
      update public.customer_reward_issuances set status='blocked',metadata=metadata||jsonb_build_object('blocked_reason','recent_dob_change'),updated_at=now() where id=rw.id;
      return;
    end if;
    select count(*) into duplicate_accounts
    from public.customer_profiles p
    join public.customer_profiles self on self.user_id=rw.customer_user_id
    where p.user_id<>self.user_id and p.date_of_birth=self.date_of_birth and self.phone is not null and p.phone is not null
      and regexp_replace(p.phone,'\D','','g')=regexp_replace(self.phone,'\D','','g');
    if duplicate_accounts>0 then
      perform private.flag_campaign_fraud(rw.restaurant_id,rw.customer_user_id,rw.id,'birthday','shared_phone_and_dob','high',jsonb_build_object('matching_accounts',duplicate_accounts));
      update public.customer_reward_issuances set status='blocked',metadata=metadata||jsonb_build_object('blocked_reason','shared_phone_and_dob','matching_accounts',duplicate_accounts),updated_at=now() where id=rw.id;
      return;
    end if;
  end if;

  if rw.reward_type='wallet_credit' then
    insert into public.customer_credit_accounts(restaurant_id,customer_user_id,balance_pence) values(rw.restaurant_id,rw.customer_user_id,0) on conflict(restaurant_id,customer_user_id) do nothing;
    select * into acct from public.customer_credit_accounts where restaurant_id=rw.restaurant_id and customer_user_id=rw.customer_user_id for update;
    insert into public.customer_credit_ledger(credit_account_id,restaurant_id,customer_user_id,amount_pence,entry_type,note,reward_issuance_id)
    values(acct.id,rw.restaurant_id,rw.customer_user_id,rw.reward_value,case when rw.source_type='birthday' then 'birthday_credit' else 'milestone_credit' end,case when rw.source_type='birthday' then 'Birthday reward' else 'Milestone reward' end,rw.id)
    on conflict(reward_issuance_id) where reward_issuance_id is not null do nothing returning id into ledger;
    if ledger is not null then update public.customer_credit_accounts set balance_pence=balance_pence+rw.reward_value,updated_at=now() where id=acct.id; end if;
    update public.customer_reward_issuances set status='available',issued_at=coalesce(issued_at,now()),campaign_cost_pence=reward_value,metadata=metadata||jsonb_build_object('credit_ledger_id',ledger),updated_at=now() where id=rw.id;
  elsif rw.reward_type='loyalty_points' then
    insert into public.customer_loyalty_accounts(restaurant_id,customer_user_id,points_balance,lifetime_points_earned,lifetime_points_redeemed) values(rw.restaurant_id,rw.customer_user_id,0,0,0) on conflict(restaurant_id,customer_user_id) do nothing;
    select * into lacct from public.customer_loyalty_accounts where restaurant_id=rw.restaurant_id and customer_user_id=rw.customer_user_id for update;
    insert into public.customer_loyalty_ledger(loyalty_account_id,restaurant_id,customer_user_id,points_delta,entry_type,note,reward_issuance_id)
    values(lacct.id,rw.restaurant_id,rw.customer_user_id,rw.reward_value,case when rw.source_type='birthday' then 'birthday_bonus' else 'milestone_bonus' end,case when rw.source_type='birthday' then 'Birthday reward' else 'Milestone reward' end,rw.id)
    on conflict(reward_issuance_id) where reward_issuance_id is not null do nothing returning id into ledger;
    if ledger is not null then update public.customer_loyalty_accounts set points_balance=points_balance+rw.reward_value,lifetime_points_earned=lifetime_points_earned+rw.reward_value,updated_at=now() where id=lacct.id; end if;
    update public.customer_reward_issuances set status='available',issued_at=coalesce(issued_at,now()),loyalty_ledger_id=coalesce(loyalty_ledger_id,ledger),updated_at=now() where id=rw.id;
  else
    if rw.reward_catalogue_id is null then raise exception 'Reward catalogue entry is missing'; end if;
    loop code:=case when rw.source_type='birthday' then 'BD-' else 'MS-' end||upper(substr(encode(extensions.gen_random_bytes(10),'hex'),1,14)); exit when not exists(select 1 from public.customer_reward_vouchers v where v.restaurant_id=rw.restaurant_id and v.code=code); end loop;
    insert into public.customer_reward_vouchers(reward_id,restaurant_id,customer_user_id,code,points_spent,expires_at,reward_issuance_id)
    values(rw.reward_catalogue_id,rw.restaurant_id,rw.customer_user_id,code,0,rw.expires_at,rw.id)
    on conflict(reward_issuance_id) where reward_issuance_id is not null do nothing returning id into vid;
    if vid is null then select id into vid from public.customer_reward_vouchers where reward_issuance_id=rw.id; end if;
    update public.customer_reward_issuances set status='available',issued_at=coalesce(issued_at,now()),voucher_id=vid,campaign_cost_pence=case when reward_type in('fixed_discount','voucher') then reward_value else campaign_cost_pence end,updated_at=now() where id=rw.id;
  end if;
  title:=case when rw.source_type='birthday' then 'Birthday reward available' else 'Reward earned' end;
  body:=coalesce(rw.metadata->>'campaign_message',case when rw.source_type='birthday' then 'Happy Birthday! Your reward is ready.' else 'You reached a new milestone. Your reward is ready!' end);
  perform private.queue_campaign_notification(rw.id,case when rw.source_type='birthday' then 'birthday_reward_available' else 'reward_earned' end,title,body);
end $$;

create or replace function private.ensure_birthday_reward(p_program_id uuid,p_customer_user_id uuid,p_year integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare prog public.restaurant_birthday_programs%rowtype; issuance_id uuid; dob date; year_key text; issuance_status text;
begin
  select * into prog from public.restaurant_birthday_programs where id=p_program_id and is_enabled and not disabled_by_platform;
  if not found then return null; end if;
  select date_of_birth into dob from public.customer_profiles where user_id=p_customer_user_id;
  if dob is null then return null; end if;
  year_key:=p_year::text;
  insert into public.customer_reward_issuances(restaurant_id,customer_user_id,source_type,source_id,source_key,reward_type,reward_value,reward_catalogue_id,expires_at,metadata)
  values(prog.restaurant_id,p_customer_user_id,'birthday',prog.id,year_key,prog.reward_type,prog.reward_value,prog.reward_catalogue_id,now()+make_interval(days=>prog.validity_days),jsonb_build_object('campaign_message',prog.campaign_message,'date_of_birth_month',extract(month from dob),'date_of_birth_day',extract(day from dob),'fulfilment_methods',prog.fulfilment_methods,'minimum_spend_pence',prog.minimum_spend_pence))
  on conflict(restaurant_id,customer_user_id,source_type,source_id,source_key) do nothing returning id into issuance_id;
  if issuance_id is null then
    select i.id into issuance_id from public.customer_reward_issuances i
    where i.restaurant_id=prog.restaurant_id and i.customer_user_id=p_customer_user_id and i.source_type='birthday' and i.source_id=prog.id and i.source_key=year_key;
  end if;
  perform private.issue_campaign_reward(issuance_id);
  select status into issuance_status from public.customer_reward_issuances where id=issuance_id;
  if issuance_status='available' then perform private.queue_campaign_notification(issuance_id,'happy_birthday','Happy Birthday!',prog.campaign_message); end if;
  return issuance_id;
end $$;

create or replace function public.process_birthday_rewards(p_run_date date default current_date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rec record; count_processed integer:=0; iid uuid;
begin
  if current_user not in ('postgres','service_role') and coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  for rec in
    select bp.id as program_id,cp.user_id
    from public.restaurant_birthday_programs bp
    join public.customer_profiles cp on cp.date_of_birth is not null
    where bp.is_enabled and not bp.disabled_by_platform
      and extract(month from cp.date_of_birth)=extract(month from p_run_date)
      and extract(day from cp.date_of_birth)=extract(day from p_run_date)
      and exists(select 1 from public.orders o where o.restaurant_id=bp.restaurant_id and o.customer_user_id=cp.user_id and o.payment_status='paid' and o.order_status='completed')
  loop
    iid:=private.ensure_birthday_reward(rec.program_id,rec.user_id,extract(year from p_run_date)::integer);
    if iid is not null then count_processed:=count_processed+1; end if;
  end loop;
  return jsonb_build_object('run_date',p_run_date,'processed',count_processed);
end $$;

create or replace function public.get_platform_milestone_dashboard()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.has_platform_admin_permission('overview:view') then raise exception 'Platform overview permission required' using errcode='42501'; end if;
  select jsonb_build_object(
    'summary',jsonb_build_object(
      'birthday_adoption',(select count(*) from public.restaurant_birthday_programs where is_enabled and not disabled_by_platform),
      'milestone_adoption',(select count(distinct restaurant_id) from public.restaurant_milestone_programs where is_enabled and not disabled_by_platform),
      'rewards_issued',(select count(*) from public.customer_reward_issuances where status in('available','redeemed','expired')),
      'redemption_rate',case when (select count(*) from public.customer_reward_issuances where status in('available','redeemed','expired'))=0 then 0 else round(100.0*(select count(*) from public.customer_reward_issuances where status='redeemed' or converted_order_id is not null)/(select count(*) from public.customer_reward_issuances where status in('available','redeemed','expired')),1) end,
      'open_fraud_flags',(select count(*) from public.customer_reward_fraud_flags where status='open'),
      'revenue_generated_pence',coalesce((select sum(revenue_generated_pence) from public.customer_reward_issuances),0),
      'campaign_cost_pence',coalesce((select sum(campaign_cost_pence) from public.customer_reward_issuances),0)
    ),
    'restaurants',coalesce((select jsonb_agg(jsonb_build_object('restaurant_id',r.id,'restaurant_name',r.name,'birthday_enabled',coalesce(b.is_enabled,false),'birthday_disabled_by_platform',coalesce(b.disabled_by_platform,false),'milestones_enabled',coalesce((select count(*) from public.restaurant_milestone_programs m where m.restaurant_id=r.id and m.is_enabled and not m.disabled_by_platform),0),'rewards_issued',(select count(*) from public.customer_reward_issuances i where i.restaurant_id=r.id),'redemptions',(select count(*) from public.customer_reward_issuances i where i.restaurant_id=r.id and (i.status='redeemed' or i.converted_order_id is not null)),'revenue_generated_pence',coalesce((select sum(revenue_generated_pence) from public.customer_reward_issuances i where i.restaurant_id=r.id),0),'campaign_cost_pence',coalesce((select sum(campaign_cost_pence) from public.customer_reward_issuances i where i.restaurant_id=r.id),0)) order by r.name) from public.restaurants r left join public.restaurant_birthday_programs b on b.restaurant_id=r.id),'[]'::jsonb),
    'fraud_flags',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'restaurant_id',f.restaurant_id,'restaurant_name',r.name,'customer_user_id',f.customer_user_id,'reward_issuance_id',f.reward_issuance_id,'source_type',f.source_type,'flag_type',f.flag_type,'severity',f.severity,'status',f.status,'details',f.details,'created_at',f.created_at) order by f.created_at desc) from (select * from public.customer_reward_fraud_flags order by created_at desc limit 200) f join public.restaurants r on r.id=f.restaurant_id),'[]'::jsonb)
  ) into result;
  return result;
end $$;

create or replace function public.platform_set_milestone_program_disabled(p_program_id uuid,p_disabled boolean,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); rid uuid;
begin
  if not private.has_platform_admin_permission('moderation:manage') then raise exception 'Moderation permission required' using errcode='42501'; end if;
  update public.restaurant_milestone_programs set disabled_by_platform=p_disabled,platform_disable_reason=case when p_disabled then left(coalesce(p_reason,'Platform moderation'),500) else null end,is_enabled=case when p_disabled then false else is_enabled end,updated_at=now() where id=p_program_id returning restaurant_id into rid;
  if rid is null then raise exception 'Milestone programme not found'; end if;
  insert into public.platform_admin_audit_log(actor_user_id,action,target_type,target_id,details) values(actor,'milestone_program_platform_toggle','milestone_program',p_program_id,jsonb_build_object('restaurant_id',rid,'disabled',p_disabled,'reason',p_reason));
end $$;
grant execute on function public.platform_set_milestone_program_disabled(uuid,boolean,text) to authenticated;
