create or replace function private.challenge_customer_has_relationship(p_restaurant_id uuid,p_customer_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select
    exists(select 1 from public.orders o where o.restaurant_id=p_restaurant_id and o.customer_user_id=p_customer_user_id)
    or exists(select 1 from public.customer_loyalty_accounts a where a.restaurant_id=p_restaurant_id and a.customer_user_id=p_customer_user_id)
    or exists(select 1 from public.customer_credit_accounts a where a.restaurant_id=p_restaurant_id and a.customer_user_id=p_customer_user_id)
    or exists(select 1 from public.customer_stamp_cards s where s.restaurant_id=p_restaurant_id and s.customer_user_id=p_customer_user_id)
    or exists(select 1 from public.customer_referrals r where r.restaurant_id=p_restaurant_id and (r.referrer_user_id=p_customer_user_id or r.referred_user_id=p_customer_user_id))
    or exists(select 1 from public.customer_vip_memberships v where v.restaurant_id=p_restaurant_id and v.customer_user_id=p_customer_user_id)
    or exists(select 1 from public.customer_challenge_progress p where p.restaurant_id=p_restaurant_id and p.customer_user_id=p_customer_user_id)
    or exists(select 1 from public.customer_reward_issuances i where i.restaurant_id=p_restaurant_id and i.customer_user_id=p_customer_user_id)
$$;

create or replace function private.challenge_audience_matches(c public.restaurant_challenges, uid uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare order_count bigint; tier_id uuid; target_tier uuid; dob date; referral_count bigint; completed_count bigint; local_day date;
begin
  if uid is null or not private.challenge_customer_has_relationship(c.restaurant_id,uid) then return false; end if;
  if c.max_completions is not null then
    select count(*) into completed_count from public.customer_challenge_progress p where p.challenge_id=c.id and p.customer_user_id=uid and p.status='completed';
    if completed_count>=c.max_completions then return false; end if;
  end if;
  if c.target_audience='all' then return true; end if;
  if c.target_audience='vip' then return exists(select 1 from public.customer_vip_memberships m where m.restaurant_id=c.restaurant_id and m.customer_user_id=uid and m.current_tier_id is not null); end if;
  if c.target_audience='tier' then target_tier:=nullif(c.target_config->>'tier_id','')::uuid; select current_tier_id into tier_id from public.customer_vip_memberships where restaurant_id=c.restaurant_id and customer_user_id=uid; return target_tier is not null and tier_id=target_tier; end if;
  select count(*) into order_count from public.orders where restaurant_id=c.restaurant_id and customer_user_id=uid and payment_status='paid' and order_status='completed';
  if c.target_audience='new' then return order_count<=1; end if;
  if c.target_audience='returning' then return order_count>1; end if;
  if c.target_audience='birthday' then local_day:=(now() at time zone 'Europe/London')::date; select date_of_birth into dob from public.customer_profiles where user_id=uid; return dob is not null and extract(month from dob)=extract(month from local_day) and extract(day from dob)=extract(day from local_day); end if;
  if c.target_audience='referral' then select count(*) into referral_count from public.customer_referrals where restaurant_id=c.restaurant_id and referrer_user_id=uid and status='qualified'; return referral_count>0; end if;
  if c.target_audience='custom' then return exists(select 1 from public.customer_challenge_custom_metrics m where m.restaurant_id=c.restaurant_id and m.customer_user_id=uid and m.metric_key=coalesce(c.target_config->>'metric_key','') and m.metric_value>=case when coalesce(c.target_config->>'minimum_value','') ~ '^[0-9]+$' then (c.target_config->>'minimum_value')::bigint else 1 end); end if;
  return false;
end $$;

create or replace function private.validate_challenge_reference_ownership()
returns trigger language plpgsql security definer set search_path='' as $$
declare expected_restaurant uuid; tier_id uuid;
begin
  if tg_table_name='restaurant_challenges' then
    if new.target_audience='tier' then
      begin tier_id:=nullif(new.target_config->>'tier_id','')::uuid; exception when invalid_text_representation then raise exception 'Invalid VIP tier reference'; end;
      if tier_id is null or not exists(select 1 from public.restaurant_vip_tiers t where t.id=tier_id and t.restaurant_id=new.restaurant_id) then raise exception 'VIP tier does not belong to this restaurant' using errcode='23514'; end if;
    end if;
    return new;
  end if;

  select restaurant_id into expected_restaurant from public.restaurant_challenges where id=new.challenge_id;
  if expected_restaurant is null or expected_restaurant is distinct from new.restaurant_id then raise exception 'Challenge reference does not belong to this restaurant' using errcode='23514'; end if;

  if tg_table_name='restaurant_challenge_conditions' then
    if new.menu_item_id is not null and not exists(select 1 from public.menu_items m where m.id=new.menu_item_id and m.restaurant_id=new.restaurant_id) then raise exception 'Menu item does not belong to this restaurant' using errcode='23514'; end if;
    if new.category_id is not null and not exists(select 1 from public.menu_categories c where c.id=new.category_id and c.restaurant_id=new.restaurant_id) then raise exception 'Menu category does not belong to this restaurant' using errcode='23514'; end if;
    if new.condition_type='featured_item' and new.menu_item_id is null then raise exception 'Featured item challenges require a menu item' using errcode='23514'; end if;
  elsif tg_table_name='restaurant_challenge_rewards' then
    if new.menu_item_id is not null and not exists(select 1 from public.menu_items m where m.id=new.menu_item_id and m.restaurant_id=new.restaurant_id) then raise exception 'Reward menu item does not belong to this restaurant' using errcode='23514'; end if;
    if new.stamp_program_id is not null and not exists(select 1 from public.restaurant_stamp_programs s where s.id=new.stamp_program_id and s.restaurant_id=new.restaurant_id) then raise exception 'Stamp programme does not belong to this restaurant' using errcode='23514'; end if;
    if new.reward_catalogue_id is not null and not exists(select 1 from public.restaurant_loyalty_rewards r where r.id=new.reward_catalogue_id and r.restaurant_id=new.restaurant_id) then raise exception 'Reward catalogue item does not belong to this restaurant' using errcode='23514'; end if;
    if new.reward_type='free_item' and new.menu_item_id is null then raise exception 'Free item rewards require a menu item' using errcode='23514'; end if;
    if new.reward_type='bonus_stamps' and new.stamp_program_id is null then raise exception 'Bonus stamp rewards require a stamp programme' using errcode='23514'; end if;
  end if;
  return new;
end $$;

drop trigger if exists validate_challenge_reference_ownership on public.restaurant_challenges;
create trigger validate_challenge_reference_ownership before insert or update of restaurant_id,target_audience,target_config on public.restaurant_challenges for each row execute function private.validate_challenge_reference_ownership();
drop trigger if exists validate_challenge_condition_ownership on public.restaurant_challenge_conditions;
create trigger validate_challenge_condition_ownership before insert or update on public.restaurant_challenge_conditions for each row execute function private.validate_challenge_reference_ownership();
drop trigger if exists validate_challenge_reward_ownership on public.restaurant_challenge_rewards;
create trigger validate_challenge_reward_ownership before insert or update on public.restaurant_challenge_rewards for each row execute function private.validate_challenge_reference_ownership();

revoke all on function private.announce_new_challenge() from public, anon, authenticated;
revoke all on function private.challenge_audience_matches(public.restaurant_challenges, uuid) from public, anon, authenticated;
revoke all on function private.challenge_customer_has_relationship(uuid,uuid) from public, anon, authenticated;
revoke all on function private.challenge_cycle_key(public.restaurant_challenges, timestamptz) from public, anon, authenticated;
revoke all on function private.challenge_identity_allowed(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.challenge_metric_value(public.restaurant_challenge_conditions, public.restaurant_challenges, uuid, uuid) from public, anon, authenticated;
revoke all on function private.challenge_restaurant_id(boolean) from public, anon, authenticated;
revoke all on function private.evaluate_customer_challenge(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.issue_challenge_reward(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.process_completed_order_challenges() from public, anon, authenticated;
revoke all on function private.process_loyalty_challenges() from public, anon, authenticated;
revoke all on function private.process_referral_challenges() from public, anon, authenticated;
revoke all on function private.process_stamp_challenges() from public, anon, authenticated;
revoke all on function private.process_vip_challenges() from public, anon, authenticated;
revoke all on function private.queue_challenge_notification(uuid, uuid, uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function private.evaluate_customer_achievements(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.validate_challenge_reference_ownership() from public, anon, authenticated;

revoke all on function public.get_customer_challenges() from public, anon;
grant execute on function public.get_customer_challenges() to authenticated;
revoke all on function public.get_customer_challenge_leaderboards() from public, anon;
grant execute on function public.get_customer_challenge_leaderboards() to authenticated;
revoke all on function public.save_customer_gamification_preferences(uuid, text, text) from public, anon;
grant execute on function public.save_customer_gamification_preferences(uuid, text, text) to authenticated;
revoke all on function public.save_restaurant_challenge(uuid,text,text,text,text,text,timestamptz,timestamptz,boolean,integer,text,text,jsonb,text,boolean,text,integer,jsonb,jsonb) from public, anon;
grant execute on function public.save_restaurant_challenge(uuid,text,text,text,text,text,timestamptz,timestamptz,boolean,integer,text,text,jsonb,text,boolean,text,integer,jsonb,jsonb) to authenticated;
revoke all on function public.clone_restaurant_challenge(uuid,text) from public, anon;
grant execute on function public.clone_restaurant_challenge(uuid,text) to authenticated;
revoke all on function public.delete_restaurant_challenge(uuid) from public, anon;
grant execute on function public.delete_restaurant_challenge(uuid) to authenticated;
revoke all on function public.save_restaurant_achievement(uuid,text,text,text,text,text,bigint,jsonb,boolean) from public, anon;
grant execute on function public.save_restaurant_achievement(uuid,text,text,text,text,text,bigint,jsonb,boolean) to authenticated;
revoke all on function public.save_restaurant_leaderboard_settings(boolean,text,integer) from public, anon;
grant execute on function public.save_restaurant_leaderboard_settings(boolean,text,integer) to authenticated;
revoke all on function public.get_restaurant_challenge_dashboard() from public, anon;
grant execute on function public.get_restaurant_challenge_dashboard() to authenticated;
revoke all on function public.get_restaurant_challenge_leaderboard() from public, anon;
grant execute on function public.get_restaurant_challenge_leaderboard() to authenticated;
revoke all on function public.record_challenge_custom_metric(text,bigint,text,uuid) from public, anon;
grant execute on function public.record_challenge_custom_metric(text,bigint,text,uuid) to authenticated;
revoke all on function public.get_platform_challenge_dashboard() from public, anon;
grant execute on function public.get_platform_challenge_dashboard() to authenticated;
revoke all on function public.platform_set_challenge_disabled(uuid,boolean,text) from public, anon;
grant execute on function public.platform_set_challenge_disabled(uuid,boolean,text) to authenticated;
revoke all on function public.platform_review_challenge_fraud_flag(uuid,text,text) from public, anon;
grant execute on function public.platform_review_challenge_fraud_flag(uuid,text,text) to authenticated;
revoke all on function public.process_challenge_notifications(timestamptz) from public, anon, authenticated;
grant execute on function public.process_challenge_notifications(timestamptz) to service_role;
