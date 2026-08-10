create or replace function private.challenge_cycle_key(p_challenge public.restaurant_challenges,p_at timestamptz)
returns text language sql stable set search_path='' as $$
  select case
    when not p_challenge.repeatable or p_challenge.repeat_period='campaign' then 'campaign'
    when p_challenge.repeat_period='daily' then to_char(p_at at time zone 'Europe/London','YYYY-MM-DD')
    when p_challenge.repeat_period='weekly' then to_char(p_at at time zone 'Europe/London','IYYY-"W"IW')
    else to_char(p_at at time zone 'Europe/London','YYYY-MM') end
$$;

create or replace function private.challenge_identity_allowed(p_restaurant_id uuid,p_customer_user_id uuid,p_order_id uuid default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare normalized_phone text; duplicate_count integer:=0;
begin
  select nullif(regexp_replace(coalesce(phone,''),'\D','','g'),'') into normalized_phone from public.customer_profiles where user_id=p_customer_user_id;
  if normalized_phone is null then return true; end if;
  select count(*) into duplicate_count from public.customer_profiles p where p.user_id<>p_customer_user_id and nullif(regexp_replace(coalesce(p.phone,''),'\D','','g'),'')=normalized_phone;
  if duplicate_count=0 then return true; end if;
  if not exists(select 1 from public.challenge_fraud_flags f where f.restaurant_id=p_restaurant_id and f.customer_user_id=p_customer_user_id and f.flag_type='shared_phone_multiple_accounts' and f.status='open' and f.created_at>now()-interval '30 days') then
    insert into public.challenge_fraud_flags(restaurant_id,customer_user_id,order_id,flag_type,severity,details) values(p_restaurant_id,p_customer_user_id,p_order_id,'shared_phone_multiple_accounts','high',jsonb_build_object('matching_accounts',duplicate_count));
  end if;
  return false;
end $$;

create or replace function private.process_completed_order_challenges()
returns trigger language plpgsql security definer set search_path='' as $$
declare c record; recent_count integer;
begin
 if new.order_status='completed' and new.payment_status='paid' and new.customer_user_id is not null and (old.order_status is distinct from new.order_status or old.payment_status is distinct from new.payment_status) then
   if not private.challenge_identity_allowed(new.restaurant_id,new.customer_user_id,new.id) then return new; end if;
   select count(*) into recent_count from public.orders o where o.restaurant_id=new.restaurant_id and o.customer_user_id=new.customer_user_id and o.id<>new.id and o.payment_status='paid' and o.order_status='completed' and o.total_pence=new.total_pence and coalesce(o.completed_at,o.updated_at)>coalesce(new.completed_at,new.updated_at)-interval '2 minutes';
   if recent_count>0 then
     insert into public.challenge_fraud_flags(restaurant_id,customer_user_id,order_id,flag_type,severity,details) values(new.restaurant_id,new.customer_user_id,new.id,'rapid_duplicate_order','high',jsonb_build_object('matching_recent_orders',recent_count,'total_pence',new.total_pence,'progress_blocked',true));
     return new;
   end if;
   for c in select id from public.restaurant_challenges where restaurant_id=new.restaurant_id and is_active and platform_disabled_at is null and starts_at<=coalesce(new.completed_at,now()) and (ends_at is null or ends_at>=coalesce(new.completed_at,now())) order by priority desc loop perform private.evaluate_customer_challenge(c.id,new.customer_user_id,'order:'||new.id::text,new.id); end loop;
   perform private.evaluate_customer_achievements(new.restaurant_id,new.customer_user_id,new.id);
 end if;
 return new;
end $$;

create or replace function public.platform_set_challenge_disabled(p_challenge_id uuid,p_disabled boolean,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.has_platform_admin_permission('restaurants:manage') then raise exception 'Restaurant management permission required' using errcode='42501'; end if;
  update public.restaurant_challenges set platform_disabled_at=case when p_disabled then now() else null end,platform_disabled_reason=case when p_disabled then nullif(trim(p_reason),'') else null end,updated_at=now() where id=p_challenge_id;
end $$;

create or replace function public.platform_review_challenge_fraud_flag(p_flag_id uuid,p_status text,p_note text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.has_platform_admin_permission('restaurants:manage') then raise exception 'Restaurant management permission required' using errcode='42501'; end if;
  if p_status not in ('reviewed','dismissed','confirmed') then raise exception 'Invalid fraud review status'; end if;
  update public.challenge_fraud_flags set status=p_status,review_note=nullif(trim(p_note),''),reviewed_by=auth.uid(),reviewed_at=now() where id=p_flag_id;
end $$;

create or replace function private.announce_new_challenge()
returns trigger language plpgsql security definer set search_path='' as $$
declare u record; should_announce boolean;
begin
  should_announce:=new.is_active and new.platform_disabled_at is null and new.visibility<>'hidden' and (tg_op='INSERT' or old.is_active is distinct from new.is_active or old.starts_at is distinct from new.starts_at);
  if not should_announce then return new; end if;
  for u in select distinct customer_user_id from (select customer_user_id from public.orders where restaurant_id=new.restaurant_id and customer_user_id is not null union select customer_user_id from public.customer_loyalty_accounts where restaurant_id=new.restaurant_id union select customer_user_id from public.customer_stamp_cards where restaurant_id=new.restaurant_id union select referrer_user_id from public.customer_referrals where restaurant_id=new.restaurant_id union select customer_user_id from public.customer_vip_memberships where restaurant_id=new.restaurant_id) candidates loop
    if private.challenge_identity_allowed(new.restaurant_id,u.customer_user_id,null) and private.challenge_audience_matches(new,u.customer_user_id) then perform private.queue_challenge_notification(new.id,null,null,new.restaurant_id,u.customer_user_id,'challenge_new','New challenge',new.name||' is now available.','challenge-new:'||new.id::text||':'||u.customer_user_id::text); end if;
  end loop;
  return new;
end $$;
drop trigger if exists announce_new_challenge_trigger on public.restaurant_challenges;
create trigger announce_new_challenge_trigger after insert or update of is_active,starts_at on public.restaurant_challenges for each row execute function private.announce_new_challenge();

create or replace function public.process_challenge_notifications(p_now timestamptz default now()) returns jsonb language plpgsql security definer set search_path='' as $$
declare challenge_row record; customer_row record; progress_row record; queued integer:=0;
begin
 if current_user not in ('postgres','service_role') and coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 for challenge_row in select ch.* from public.restaurant_challenges ch where ch.is_active and ch.platform_disabled_at is null and ch.starts_at between p_now and p_now+interval '24 hours' loop
   for customer_row in select distinct customer_user_id from (select customer_user_id from public.orders where restaurant_id=challenge_row.restaurant_id and customer_user_id is not null union select customer_user_id from public.customer_loyalty_accounts where restaurant_id=challenge_row.restaurant_id union select customer_user_id from public.customer_stamp_cards where restaurant_id=challenge_row.restaurant_id union select referrer_user_id from public.customer_referrals where restaurant_id=challenge_row.restaurant_id union select customer_user_id from public.customer_vip_memberships where restaurant_id=challenge_row.restaurant_id) candidates loop
     if private.challenge_identity_allowed(challenge_row.restaurant_id,customer_row.customer_user_id,null) and private.challenge_audience_matches(challenge_row,customer_row.customer_user_id) then perform private.queue_challenge_notification(challenge_row.id,null,null,challenge_row.restaurant_id,customer_row.customer_user_id,'challenge_starting','Challenge starting soon',challenge_row.name||' starts soon.','challenge-starting:'||challenge_row.id::text||':'||customer_row.customer_user_id::text); queued:=queued+1; end if;
   end loop;
 end loop;
 for progress_row in select cp.*,ch.name as challenge_name,ch.ends_at as challenge_ends_at from public.customer_challenge_progress cp join public.restaurant_challenges ch on ch.id=cp.challenge_id where cp.status='active' and ch.ends_at between p_now and p_now+interval '48 hours' loop
   perform private.queue_challenge_notification(progress_row.challenge_id,progress_row.id,null,progress_row.restaurant_id,progress_row.customer_user_id,'challenge_expiring','Challenge ending soon',progress_row.challenge_name||' ends soon.','challenge-expiring:'||progress_row.id::text); queued:=queued+1;
 end loop;
 return jsonb_build_object('queued',queued);
end $$;
