alter table public.customer_credit_ledger add column if not exists reward_issuance_id uuid references public.customer_reward_issuances(id) on delete set null;
create unique index if not exists customer_credit_ledger_reward_issuance_unique on public.customer_credit_ledger(reward_issuance_id) where reward_issuance_id is not null;
alter table public.customer_credit_ledger drop constraint if exists customer_credit_ledger_entry_type_check;
alter table public.customer_credit_ledger add constraint customer_credit_ledger_entry_type_check check (entry_type = any(array['gift_card'::text,'refund_credit'::text,'manual_credit'::text,'order_redemption'::text,'referral_credit'::text,'birthday_credit'::text,'milestone_credit'::text]));

create or replace function private.queue_campaign_notification(p_issuance_id uuid,p_event_type text,p_title text,p_body text)
returns void language plpgsql security definer set search_path='' as $$
declare rw public.customer_reward_issuances%rowtype;
begin
  select * into rw from public.customer_reward_issuances where id=p_issuance_id;
  if not found then return; end if;
  insert into public.customer_notifications(customer_user_id,restaurant_id,notification_type,title,body,action_url,metadata)
  values(rw.customer_user_id,rw.restaurant_id,p_event_type,p_title,p_body,'/account/milestones',jsonb_build_object('reward_issuance_id',rw.id,'source_type',rw.source_type,'source_id',rw.source_id))
  on conflict do nothing;
  insert into public.reward_notification_queue(reward_issuance_id,restaurant_id,customer_user_id,event_type,subject,body,push_payload)
  values(rw.id,rw.restaurant_id,rw.customer_user_id,p_event_type,p_title,p_body,jsonb_build_object('type',p_event_type,'reward_issuance_id',rw.id,'action_url','/account/milestones'))
  on conflict(reward_issuance_id,event_type) do nothing;
end $$;

create or replace function private.flag_campaign_fraud(p_restaurant_id uuid,p_customer_user_id uuid,p_issuance_id uuid,p_source_type text,p_flag_type text,p_severity text,p_details jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.customer_reward_fraud_flags where reward_issuance_id=p_issuance_id and flag_type=p_flag_type and status='open') then return; end if;
  insert into public.customer_reward_fraud_flags(restaurant_id,customer_user_id,reward_issuance_id,source_type,flag_type,severity,details)
  values(p_restaurant_id,p_customer_user_id,p_issuance_id,p_source_type,p_flag_type,p_severity,coalesce(p_details,'{}'::jsonb));
end $$;

create or replace function private.issue_campaign_reward(p_issuance_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare rw public.customer_reward_issuances%rowtype; acct public.customer_credit_accounts%rowtype; lacct public.customer_loyalty_accounts%rowtype; ledger uuid; vid uuid; code text; title text; body text; duplicate_accounts integer:=0; dob_changed timestamptz;
begin
  select * into rw from public.customer_reward_issuances where id=p_issuance_id for update;
  if not found or rw.status<>'pending' then return; end if;
  if rw.source_type='birthday' then
    select p.date_of_birth_last_changed_at into dob_changed from public.customer_profiles p where p.user_id=rw.customer_user_id;
    if dob_changed is not null and dob_changed > now()-interval '30 days' then
      perform private.flag_campaign_fraud(rw.restaurant_id,rw.customer_user_id,rw.id,'birthday','recent_dob_change','high',jsonb_build_object('changed_at',dob_changed));
    end if;
    select count(*) into duplicate_accounts
    from public.customer_profiles p
    join public.customer_profiles self on self.user_id=rw.customer_user_id
    where p.user_id<>self.user_id and p.date_of_birth=self.date_of_birth and self.phone is not null and p.phone is not null
      and regexp_replace(p.phone,'\D','','g')=regexp_replace(self.phone,'\D','','g');
    if duplicate_accounts>0 then
      perform private.flag_campaign_fraud(rw.restaurant_id,rw.customer_user_id,rw.id,'birthday','shared_phone_and_dob','high',jsonb_build_object('matching_accounts',duplicate_accounts));
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
    loop code:=case when rw.source_type='birthday' then 'BD-' else 'MS-' end||upper(substr(encode(extensions.gen_random_bytes(10),'hex'),1,14)); exit when not exists(select 1 from public.customer_reward_vouchers where restaurant_id=rw.restaurant_id and code=code); end loop;
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
declare prog public.restaurant_birthday_programs%rowtype; rid uuid; dob date; source_key text; issuance uuid;
begin
  select * into prog from public.restaurant_birthday_programs where id=p_program_id and is_enabled and not disabled_by_platform;
  if not found then return null; end if;
  select date_of_birth into dob from public.customer_profiles where user_id=p_customer_user_id;
  if dob is null then return null; end if;
  source_key:=p_year::text;
  insert into public.customer_reward_issuances(restaurant_id,customer_user_id,source_type,source_id,source_key,reward_type,reward_value,reward_catalogue_id,expires_at,metadata)
  values(prog.restaurant_id,p_customer_user_id,'birthday',prog.id,source_key,prog.reward_type,prog.reward_value,prog.reward_catalogue_id,now()+make_interval(days=>prog.validity_days),jsonb_build_object('campaign_message',prog.campaign_message,'date_of_birth_month',extract(month from dob),'date_of_birth_day',extract(day from dob),'fulfilment_methods',prog.fulfilment_methods,'minimum_spend_pence',prog.minimum_spend_pence))
  on conflict(restaurant_id,customer_user_id,source_type,source_id,source_key) do nothing returning id into issuance;
  if issuance is null then select id into issuance from public.customer_reward_issuances where restaurant_id=prog.restaurant_id and customer_user_id=p_customer_user_id and source_type='birthday' and source_id=prog.id and source_key=source_key; end if;
  perform private.issue_campaign_reward(issuance);
  perform private.queue_campaign_notification(issuance,'happy_birthday','Happy Birthday!',prog.campaign_message);
  return issuance;
end $$;

create or replace function private.evaluate_customer_milestones(p_restaurant_id uuid,p_customer_user_id uuid,p_trigger_order_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare order_count integer; lifetime_spend bigint; prog record; issuance uuid; created_count integer:=0;
begin
  if p_customer_user_id is null then return 0; end if;
  select count(*),coalesce(sum(total_pence+customer_credit_used_pence+gift_card_used_pence+reward_discount_pence),0)
  into order_count,lifetime_spend from public.orders where restaurant_id=p_restaurant_id and customer_user_id=p_customer_user_id and payment_status='paid' and order_status='completed';
  for prog in select * from public.restaurant_milestone_programs where restaurant_id=p_restaurant_id and is_enabled and not disabled_by_platform and ((milestone_type='order_count' and threshold_value<=order_count) or (milestone_type='lifetime_spend' and threshold_value<=lifetime_spend)) order by threshold_value loop
    insert into public.customer_reward_issuances(restaurant_id,customer_user_id,source_type,source_id,source_key,triggering_order_id,reward_type,reward_value,reward_catalogue_id,expires_at,metadata)
    values(p_restaurant_id,p_customer_user_id,'milestone',prog.id,'once',p_trigger_order_id,prog.reward_type,prog.reward_value,prog.reward_catalogue_id,now()+make_interval(days=>prog.validity_days),jsonb_build_object('program_name',prog.name,'milestone_type',prog.milestone_type,'threshold_value',prog.threshold_value,'campaign_message',prog.campaign_message,'order_count',order_count,'lifetime_spend_pence',lifetime_spend,'fulfilment_methods',prog.fulfilment_methods,'minimum_spend_pence',prog.minimum_spend_pence))
    on conflict(restaurant_id,customer_user_id,source_type,source_id,source_key) do nothing returning id into issuance;
    if issuance is not null then
      created_count:=created_count+1;
      perform private.queue_campaign_notification(issuance,'milestone_reached','Milestone reached',prog.name||' reached.');
      perform private.issue_campaign_reward(issuance);
    end if;
  end loop;
  return created_count;
end $$;

create or replace function public.process_birthday_rewards(p_run_date date default current_date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rec record; count_issued integer:=0; iid uuid;
begin
  if current_user not in ('postgres','service_role') and coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  for rec in
    select bp.id as program_id,cp.user_id
    from public.restaurant_birthday_programs bp
    join public.customer_profiles cp on cp.date_of_birth is not null
    where bp.is_enabled and not bp.disabled_by_platform
      and extract(month from cp.date_of_birth)=extract(month from p_run_date)
      and extract(day from cp.date_of_birth)=extract(day from p_run_date)
  loop
    iid:=private.ensure_birthday_reward(rec.program_id,rec.user_id,extract(year from p_run_date)::integer);
    if iid is not null then count_issued:=count_issued+1; end if;
  end loop;
  return jsonb_build_object('run_date',p_run_date,'processed',count_issued);
end $$;

create or replace function public.process_reward_expiry_and_reminders(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path='' as $$
declare rec record; expired_count integer:=0; reminder_count integer:=0;
begin
  if current_user not in ('postgres','service_role') and coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  for rec in select * from public.customer_reward_issuances where status='available' and expires_at is not null and expires_at<=p_now for update skip locked loop
    update public.customer_reward_issuances set status='expired',updated_at=p_now where id=rec.id;
    if rec.voucher_id is not null then update public.customer_reward_vouchers set status='expired' where id=rec.voucher_id and status='available'; end if;
    expired_count:=expired_count+1;
  end loop;
  for rec in select * from public.customer_reward_issuances where source_type='birthday' and status='available' and expires_at between p_now+interval '2 days' and p_now+interval '3 days' loop
    perform private.queue_campaign_notification(rec.id,'birthday_reward_expiring','Birthday reward expiring','Your birthday reward expires soon.');
    reminder_count:=reminder_count+1;
  end loop;
  return jsonb_build_object('expired',expired_count,'reminders_queued',reminder_count);
end $$;

create or replace function private.process_order_campaign_milestones()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.order_status='completed' and new.payment_status='paid' and (old.order_status is distinct from new.order_status or old.payment_status is distinct from new.payment_status) and new.customer_user_id is not null then
    perform private.evaluate_customer_milestones(new.restaurant_id,new.customer_user_id,new.id);
    update public.customer_reward_issuances rw set converted_at=coalesce(rw.converted_at,new.completed_at,now()),converted_order_id=coalesce(rw.converted_order_id,new.id),revenue_generated_pence=case when rw.converted_order_id is null then new.total_pence else rw.revenue_generated_pence end,updated_at=now()
    where rw.restaurant_id=new.restaurant_id and rw.customer_user_id=new.customer_user_id and rw.issued_at is not null and rw.issued_at<coalesce(new.completed_at,now()) and rw.converted_order_id is null;
  end if;
  return new;
end $$;
drop trigger if exists process_order_campaign_milestones on public.orders;
create trigger process_order_campaign_milestones after update of order_status,payment_status on public.orders for each row execute function private.process_order_campaign_milestones();

create or replace function private.sync_reward_issuance_redemption()
returns trigger language plpgsql security definer set search_path='' as $$
declare iid uuid;
begin
  select reward_issuance_id into iid from public.customer_reward_vouchers where id=new.voucher_id;
  if iid is not null then update public.customer_reward_issuances set status='redeemed',redeemed_at=new.redeemed_at,redemption_order_id=new.order_id,campaign_cost_pence=greatest(campaign_cost_pence,new.discount_pence),revenue_generated_pence=case when new.order_id is null then revenue_generated_pence else coalesce((select total_pence+reward_discount_pence from public.orders where id=new.order_id),revenue_generated_pence) end,updated_at=now() where id=iid; end if;
  return new;
end $$;
drop trigger if exists sync_reward_issuance_redemption on public.customer_reward_redemptions;
create trigger sync_reward_issuance_redemption after insert on public.customer_reward_redemptions for each row execute function private.sync_reward_issuance_redemption();

create or replace function public.get_customer_milestone_dashboard()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid(); orders_count integer; spend bigint; dob date; result jsonb;
begin
  if uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select count(*),coalesce(sum(total_pence+customer_credit_used_pence+gift_card_used_pence+reward_discount_pence),0) into orders_count,spend from public.orders where customer_user_id=uid and payment_status='paid' and order_status='completed';
  select date_of_birth into dob from public.customer_profiles where user_id=uid;
  select jsonb_build_object(
    'date_of_birth',dob,
    'can_change_date_of_birth',coalesce((select date_of_birth_change_count<1 from public.customer_profiles where user_id=uid),true),
    'order_count',orders_count,'lifetime_spend_pence',spend,
    'upcoming',coalesce((select jsonb_agg(x order by (x->>'progress_percent')::numeric desc) from (
      select jsonb_build_object('program_id',m.id,'restaurant_id',m.restaurant_id,'restaurant_name',r.name,'name',m.name,'milestone_type',m.milestone_type,'threshold_value',m.threshold_value,'current_value',case when m.milestone_type='order_count' then coalesce((select count(*) from public.orders o where o.restaurant_id=m.restaurant_id and o.customer_user_id=uid and o.payment_status='paid' and o.order_status='completed'),0) else coalesce((select sum(o.total_pence+o.customer_credit_used_pence+o.gift_card_used_pence+o.reward_discount_pence) from public.orders o where o.restaurant_id=m.restaurant_id and o.customer_user_id=uid and o.payment_status='paid' and o.order_status='completed'),0) end,'progress_percent',least(100,round(100.0*(case when m.milestone_type='order_count' then coalesce((select count(*) from public.orders o where o.restaurant_id=m.restaurant_id and o.customer_user_id=uid and o.payment_status='paid' and o.order_status='completed'),0) else coalesce((select sum(o.total_pence+o.customer_credit_used_pence+o.gift_card_used_pence+o.reward_discount_pence) from public.orders o where o.restaurant_id=m.restaurant_id and o.customer_user_id=uid and o.payment_status='paid' and o.order_status='completed'),0) end)/m.threshold_value,1))) x
      from public.restaurant_milestone_programs m join public.restaurants r on r.id=m.restaurant_id where m.is_enabled and not m.disabled_by_platform and not exists(select 1 from public.customer_reward_issuances i where i.customer_user_id=uid and i.source_type='milestone' and i.source_id=m.id)
    ) s),'[]'::jsonb),
    'completed',coalesce((select jsonb_agg(jsonb_build_object('issuance_id',i.id,'restaurant_name',r.name,'program_name',coalesce(i.metadata->>'program_name','Milestone'),'status',i.status,'issued_at',i.issued_at,'redeemed_at',i.redeemed_at,'expires_at',i.expires_at,'reward_type',i.reward_type,'reward_value',i.reward_value) order by i.created_at desc) from public.customer_reward_issuances i join public.restaurants r on r.id=i.restaurant_id where i.customer_user_id=uid and i.source_type='milestone'),'[]'::jsonb),
    'birthday_rewards',coalesce((select jsonb_agg(jsonb_build_object('issuance_id',i.id,'restaurant_name',r.name,'status',i.status,'issued_at',i.issued_at,'redeemed_at',i.redeemed_at,'expires_at',i.expires_at,'reward_type',i.reward_type,'reward_value',i.reward_value) order by i.created_at desc) from public.customer_reward_issuances i join public.restaurants r on r.id=i.restaurant_id where i.customer_user_id=uid and i.source_type='birthday'),'[]'::jsonb),
    'reward_history',coalesce((select jsonb_agg(jsonb_build_object('issuance_id',i.id,'source_type',i.source_type,'restaurant_name',r.name,'status',i.status,'issued_at',i.issued_at,'redeemed_at',i.redeemed_at,'expires_at',i.expires_at,'reward_type',i.reward_type,'reward_value',i.reward_value) order by i.created_at desc) from public.customer_reward_issuances i join public.restaurants r on r.id=i.restaurant_id where i.customer_user_id=uid),'[]'::jsonb)
  ) into result;
  return result;
end $$;

create or replace function public.get_restaurant_milestone_dashboard()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rid uuid; result jsonb;
begin
  select restaurant_id into rid from public.restaurant_members where user_id=auth.uid() order by created_at limit 1;
  if rid is null then raise exception 'Restaurant membership not found' using errcode='42501'; end if;
  select jsonb_build_object(
    'birthday_program',coalesce((select to_jsonb(b)-'created_by' from public.restaurant_birthday_programs b where b.restaurant_id=rid),'{}'::jsonb),
    'milestones',coalesce((select jsonb_agg(to_jsonb(m)-'created_by' order by m.milestone_type,m.threshold_value) from public.restaurant_milestone_programs m where m.restaurant_id=rid),'[]'::jsonb),
    'summary',jsonb_build_object(
      'birthdays_this_month',(select count(distinct customer_user_id) from public.customer_reward_issuances where restaurant_id=rid and source_type='birthday' and date_trunc('month',created_at)=date_trunc('month',now())),
      'rewards_issued',(select count(*) from public.customer_reward_issuances where restaurant_id=rid and status in('available','redeemed','expired')),
      'rewards_redeemed',(select count(*) from public.customer_reward_issuances where restaurant_id=rid and status='redeemed'),
      'birthday_redemption_rate',case when (select count(*) from public.customer_reward_issuances where restaurant_id=rid and source_type='birthday')=0 then 0 else round(100.0*(select count(*) from public.customer_reward_issuances where restaurant_id=rid and source_type='birthday' and status='redeemed')/(select count(*) from public.customer_reward_issuances where restaurant_id=rid and source_type='birthday'),1) end,
      'milestone_completion',(select count(*) from public.customer_reward_issuances where restaurant_id=rid and source_type='milestone'),
      'repeat_visits_generated',(select count(*) from public.customer_reward_issuances where restaurant_id=rid and converted_order_id is not null),
      'revenue_generated_pence',coalesce((select sum(revenue_generated_pence) from public.customer_reward_issuances where restaurant_id=rid),0),
      'campaign_cost_pence',coalesce((select sum(campaign_cost_pence) from public.customer_reward_issuances where restaurant_id=rid),0)
    ),
    'recent_customers',coalesce((select jsonb_agg(jsonb_build_object('issuance_id',i.id,'source_type',i.source_type,'program_name',i.metadata->>'program_name','status',i.status,'issued_at',i.issued_at,'redeemed_at',i.redeemed_at,'revenue_generated_pence',i.revenue_generated_pence) order by i.created_at desc) from (select * from public.customer_reward_issuances where restaurant_id=rid order by created_at desc limit 100)i),'[]'::jsonb)
  ) into result;
  return result;
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
      'redemption_rate',case when (select count(*) from public.customer_reward_issuances)=0 then 0 else round(100.0*(select count(*) from public.customer_reward_issuances where status='redeemed')/(select count(*) from public.customer_reward_issuances),1) end,
      'open_fraud_flags',(select count(*) from public.customer_reward_fraud_flags where status='open'),
      'revenue_generated_pence',coalesce((select sum(revenue_generated_pence) from public.customer_reward_issuances),0),
      'campaign_cost_pence',coalesce((select sum(campaign_cost_pence) from public.customer_reward_issuances),0)
    ),
    'restaurants',coalesce((select jsonb_agg(jsonb_build_object('restaurant_id',r.id,'restaurant_name',r.name,'birthday_enabled',coalesce(b.is_enabled,false),'milestones_enabled',coalesce((select count(*) from public.restaurant_milestone_programs m where m.restaurant_id=r.id and m.is_enabled),0),'rewards_issued',(select count(*) from public.customer_reward_issuances i where i.restaurant_id=r.id),'redemptions',(select count(*) from public.customer_reward_issuances i where i.restaurant_id=r.id and i.status='redeemed'),'revenue_generated_pence',coalesce((select sum(revenue_generated_pence) from public.customer_reward_issuances i where i.restaurant_id=r.id),0),'campaign_cost_pence',coalesce((select sum(campaign_cost_pence) from public.customer_reward_issuances i where i.restaurant_id=r.id),0)) order by r.name) from public.restaurants r left join public.restaurant_birthday_programs b on b.restaurant_id=r.id),'[]'::jsonb),
    'fraud_flags',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'restaurant_id',f.restaurant_id,'restaurant_name',r.name,'customer_user_id',f.customer_user_id,'reward_issuance_id',f.reward_issuance_id,'source_type',f.source_type,'flag_type',f.flag_type,'severity',f.severity,'status',f.status,'details',f.details,'created_at',f.created_at) order by f.created_at desc) from (select * from public.customer_reward_fraud_flags order by created_at desc limit 200) f join public.restaurants r on r.id=f.restaurant_id),'[]'::jsonb)
  ) into result;
  return result;
end $$;

create or replace function public.platform_review_reward_fraud_flag(p_flag_id uuid,p_status text,p_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); f public.customer_reward_fraud_flags%rowtype;
begin
  if not private.has_platform_admin_permission('moderation:manage') then raise exception 'Moderation permission required' using errcode='42501'; end if;
  if p_status not in('reviewed','dismissed','confirmed') then raise exception 'Invalid review status'; end if;
  update public.customer_reward_fraud_flags set status=p_status,reviewed_by=actor,reviewed_at=now(),review_note=left(coalesce(p_note,''),500) where id=p_flag_id returning * into f;
  if not found then raise exception 'Fraud flag not found'; end if;
  insert into public.platform_admin_audit_log(actor_user_id,action,target_type,target_id,details) values(actor,'reward_fraud_reviewed','reward_fraud_flag',f.id,jsonb_build_object('status',p_status,'note',p_note));
  return to_jsonb(f);
end $$;

create or replace function public.platform_set_birthday_program_disabled(p_restaurant_id uuid,p_disabled boolean,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
  if not private.has_platform_admin_permission('moderation:manage') then raise exception 'Moderation permission required' using errcode='42501'; end if;
  update public.restaurant_birthday_programs set disabled_by_platform=p_disabled,platform_disable_reason=case when p_disabled then left(coalesce(p_reason,'Platform moderation'),500) else null end,is_enabled=case when p_disabled then false else is_enabled end,updated_at=now() where restaurant_id=p_restaurant_id;
  insert into public.platform_admin_audit_log(actor_user_id,action,target_type,target_id,details) values(actor,'birthday_program_platform_toggle','restaurant',p_restaurant_id,jsonb_build_object('disabled',p_disabled,'reason',p_reason));
end $$;

create or replace function public.get_restaurant_birthday_milestone_settings()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rid uuid;
begin
  select restaurant_id into rid from public.restaurant_members where user_id=auth.uid() order by created_at limit 1;
  if rid is null then raise exception 'Restaurant membership not found' using errcode='42501'; end if;
  return jsonb_build_object('sells_alcohol',(select sells_alcohol from public.restaurants where id=rid),'birthday_program',coalesce((select to_jsonb(b)-'created_by' from public.restaurant_birthday_programs b where restaurant_id=rid),'{}'::jsonb),'milestones',coalesce((select jsonb_agg(to_jsonb(m)-'created_by' order by m.milestone_type,m.threshold_value) from public.restaurant_milestone_programs m where restaurant_id=rid),'[]'::jsonb),'menu_items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name) from public.menu_items where restaurant_id=rid and is_active),'[]'::jsonb));
end $$;

grant execute on function public.process_birthday_rewards(date) to service_role;
grant execute on function public.process_reward_expiry_and_reminders(timestamptz) to service_role;
grant execute on function public.get_customer_milestone_dashboard() to authenticated;
grant execute on function public.get_restaurant_milestone_dashboard() to authenticated;
grant execute on function public.get_restaurant_birthday_milestone_settings() to authenticated;
grant execute on function public.get_platform_milestone_dashboard() to authenticated;
grant execute on function public.platform_review_reward_fraud_flag(uuid,text,text) to authenticated;
grant execute on function public.platform_set_birthday_program_disabled(uuid,boolean,text) to authenticated;
