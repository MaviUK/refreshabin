create or replace function public.get_restaurant_referral_dashboard() returns jsonb language plpgsql security definer set search_path='' as $$
declare rid uuid; result jsonb;
begin
  select restaurant_id into rid from public.restaurant_members where user_id=auth.uid() order by created_at limit 1;
  if rid is null then raise exception 'Restaurant membership not found' using errcode='42501'; end if;
  select jsonb_build_object(
    'program',coalesce((select to_jsonb(p) - 'created_by' from public.restaurant_referral_programs p where p.restaurant_id=rid),'{}'::jsonb),
    'summary',jsonb_build_object('invited',coalesce((select sum(c.share_count) from public.customer_referral_codes c where c.restaurant_id=rid),0),'registered',(select count(*) from public.customer_referrals where restaurant_id=rid and status in ('registered','ordered','qualified','rewarded')),'ordered',(select count(*) from public.customer_referrals where restaurant_id=rid and status in ('ordered','qualified','rewarded')),'qualified',(select count(*) from public.customer_referrals where restaurant_id=rid and status in ('qualified','rewarded')),'rewarded',(select count(*) from public.customer_referrals where restaurant_id=rid and status='rewarded'),'rejected',(select count(*) from public.customer_referrals where restaurant_id=rid and status='rejected'),'conversion_rate',case when (select count(*) from public.customer_referrals where restaurant_id=rid and status in ('registered','ordered','qualified','rewarded'))=0 then 0 else round(100.0*(select count(*) from public.customer_referrals where restaurant_id=rid and status in ('qualified','rewarded'))/(select count(*) from public.customer_referrals where restaurant_id=rid and status in ('registered','ordered','qualified','rewarded')),1) end,'referred_revenue_pence',coalesce((select sum(o.total_pence+o.customer_credit_used_pence+o.gift_card_used_pence+coalesce(o.reward_discount_pence,0)) from public.orders o where o.restaurant_id=rid and o.referral_id is not null and o.payment_status='paid' and o.order_status='completed'),0),'reward_cost_pence',coalesce((select sum(case when rw.reward_type='store_credit' and rw.status='available' then rw.reward_value when rw.reward_type='fixed_value_voucher' and rw.status='available' then rw.reward_value else 0 end) from public.referral_rewards rw where rw.restaurant_id=rid),0)+coalesce((select sum(rr.discount_pence) from public.customer_reward_redemptions rr join public.customer_reward_vouchers v on v.id=rr.voucher_id where rr.restaurant_id=rid and v.referral_reward_id is not null and exists(select 1 from public.referral_rewards rw where rw.id=v.referral_reward_id and rw.reward_type in ('percentage_voucher','free_delivery'))),0),'loyalty_points_issued',coalesce((select sum(reward_value) from public.referral_rewards where restaurant_id=rid and reward_type='loyalty_points' and status='available'),0)),
    'referrals',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'status',x.status,'qualifying_order_count',x.qualifying_order_count,'qualifying_revenue_pence',x.qualifying_revenue_pence,'registered_at',x.registered_at,'qualified_at',x.qualified_at,'rewarded_at',x.rewarded_at,'rejection_reason',x.rejection_reason,'created_at',x.created_at) order by x.created_at desc) from (select * from public.customer_referrals where restaurant_id=rid order by created_at desc limit 200)x),'[]'::jsonb),
    'fraud_flags',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'referral_id',f.referral_id,'flag_type',f.flag_type,'severity',f.severity,'status',f.status,'created_at',f.created_at) order by f.created_at desc) from (select * from public.referral_fraud_flags where restaurant_id=rid order by created_at desc limit 100)f),'[]'::jsonb)
  ) into result;
  return result;
end$$;

create or replace function public.get_platform_referral_dashboard() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.has_platform_admin_permission('overview:view') then raise exception 'Platform overview permission required' using errcode='42501'; end if;
  select jsonb_build_object(
    'summary',jsonb_build_object('restaurant_adoption',(select count(*) from public.restaurant_referral_programs where is_enabled and not disabled_by_platform),'total_programmes',(select count(*) from public.restaurant_referral_programs),'referrals',(select count(*) from public.customer_referrals),'qualified',(select count(*) from public.customer_referrals where status in ('qualified','rewarded')),'rewarded',(select count(*) from public.customer_referrals where status='rewarded'),'conversion_rate',case when (select count(*) from public.customer_referrals where status in ('registered','ordered','qualified','rewarded'))=0 then 0 else round(100.0*(select count(*) from public.customer_referrals where status in ('qualified','rewarded'))/(select count(*) from public.customer_referrals where status in ('registered','ordered','qualified','rewarded')),1) end,'referred_revenue_pence',coalesce((select sum(o.total_pence+o.customer_credit_used_pence+o.gift_card_used_pence+coalesce(o.reward_discount_pence,0)) from public.orders o where o.referral_id is not null and o.payment_status='paid' and o.order_status='completed'),0),'reward_cost_pence',coalesce((select sum(case when rw.reward_type='store_credit' and rw.status='available' then rw.reward_value when rw.reward_type='fixed_value_voucher' and rw.status='available' then rw.reward_value else 0 end) from public.referral_rewards rw),0)+coalesce((select sum(rr.discount_pence) from public.customer_reward_redemptions rr join public.customer_reward_vouchers v on v.id=rr.voucher_id where v.referral_reward_id is not null and exists(select 1 from public.referral_rewards rw where rw.id=v.referral_reward_id and rw.reward_type in ('percentage_voucher','free_delivery'))),0),'open_fraud_flags',(select count(*) from public.referral_fraud_flags where status='open')),
    'restaurants',coalesce((select jsonb_agg(jsonb_build_object('restaurant_id',r.id,'restaurant_name',r.name,'enabled',p.is_enabled,'disabled_by_platform',p.disabled_by_platform,'referrals',count(x.id),'qualified',count(x.id) filter(where x.status in ('qualified','rewarded')),'rewarded',count(x.id) filter(where x.status='rewarded'),'revenue_pence',coalesce((select sum(o.total_pence+o.customer_credit_used_pence+o.gift_card_used_pence+coalesce(o.reward_discount_pence,0)) from public.orders o where o.restaurant_id=r.id and o.referral_id is not null and o.payment_status='paid' and o.order_status='completed'),0)) order by count(x.id) desc) from public.restaurant_referral_programs p join public.restaurants r on r.id=p.restaurant_id left join public.customer_referrals x on x.program_id=p.id group by r.id,r.name,p.is_enabled,p.disabled_by_platform),'[]'::jsonb),
    'fraud_flags',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'restaurant_id',f.restaurant_id,'restaurant_name',r.name,'referral_id',f.referral_id,'flag_type',f.flag_type,'severity',f.severity,'status',f.status,'details',f.details,'created_at',f.created_at) order by f.created_at desc) from (select * from public.referral_fraud_flags order by created_at desc limit 200)f join public.restaurants r on r.id=f.restaurant_id),'[]'::jsonb)
  ) into result;
  return result;
end$$;

create or replace function public.platform_set_referral_program_disabled(p_restaurant_id uuid,p_disabled boolean,p_reason text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.restaurant_referral_programs%rowtype;
begin
  if not private.has_platform_admin_permission('restaurants:manage') then raise exception 'Restaurant manage permission required' using errcode='42501'; end if;
  update public.restaurant_referral_programs set disabled_by_platform=p_disabled,platform_disable_reason=case when p_disabled then nullif(trim(p_reason),'') else null end,updated_at=now() where restaurant_id=p_restaurant_id returning * into p;
  if not found then raise exception 'Referral programme not found'; end if;
  insert into public.platform_admin_audit_log(actor_user_id,action,target_type,target_id,details) values(auth.uid(),case when p_disabled then 'referral_program.disabled' else 'referral_program.enabled' end,'restaurant',p_restaurant_id,jsonb_build_object('reason',p_reason));
  return jsonb_build_object('restaurant_id',p_restaurant_id,'disabled_by_platform',p.disabled_by_platform,'reason',p.platform_disable_reason);
end$$;

create or replace function public.record_referral_share(p_program_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); c public.customer_referral_codes%rowtype; p public.restaurant_referral_programs%rowtype;
begin
  if uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into c from public.customer_referral_codes where program_id=p_program_id and customer_user_id=uid and is_active;
  if not found then raise exception 'Referral code not found' using errcode='42501'; end if;
  select * into p from public.restaurant_referral_programs where id=c.program_id and is_enabled and not disabled_by_platform;
  if not found then raise exception 'Referral programme is not available'; end if;
  if not exists(select 1 from public.referral_events e where e.restaurant_id=p.restaurant_id and e.actor_user_id=uid and e.event_type='invitation_shared' and e.created_at>=now()-interval '5 minutes') then
    insert into public.referral_events(restaurant_id,event_type,actor_user_id,actor_kind,metadata) values(p.restaurant_id,'invitation_shared',uid,'customer',jsonb_build_object('program_id',p.id,'code_id',c.id));
    perform private.queue_referral_notification(null,null,uid,p.restaurant_id,'invitation_confirmed','Referral link shared','Your referral link is ready. We will let you know when a friend joins and qualifies.');
  end if;
  return jsonb_build_object('recorded',true);
end$$;

create or replace function public.platform_review_referral_fraud_flag(p_flag_id uuid,p_status text,p_note text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.referral_fraud_flags%rowtype;
begin
  if not private.has_platform_admin_permission('moderation:manage') then raise exception 'Moderation manage permission required' using errcode='42501'; end if;
  if p_status not in ('reviewed','dismissed','confirmed') then raise exception 'Invalid fraud review status'; end if;
  update public.referral_fraud_flags set status=p_status,reviewed_by=auth.uid(),reviewed_at=now(),review_note=nullif(trim(p_note),'') where id=p_flag_id returning * into f;
  if not found then raise exception 'Referral fraud flag not found'; end if;
  insert into public.platform_admin_audit_log(actor_user_id,action,target_type,target_id,details) values(auth.uid(),'referral_fraud.reviewed','referral_fraud_flag',f.id,jsonb_build_object('status',p_status,'note',p_note,'referral_id',f.referral_id,'restaurant_id',f.restaurant_id));
  return jsonb_build_object('id',f.id,'status',f.status,'reviewed_at',f.reviewed_at);
end$$;

grant select,update on public.referral_notification_queue to service_role;
revoke all on function public.save_restaurant_referral_program(boolean,text,integer,text,integer,integer,integer,integer,timestamptz,timestamptz,integer,integer,text) from public,anon,authenticated;
revoke all on function public.get_customer_referral_dashboard() from public,anon,authenticated;
revoke all on function public.get_referral_program_by_code(text) from public,anon,authenticated;
revoke all on function public.create_referral_attribution(text) from public,anon,authenticated;
revoke all on function public.claim_referral_attribution(uuid) from public,anon,authenticated;
revoke all on function public.process_due_referral_rewards(integer) from public,anon,authenticated;
revoke all on function public.get_restaurant_referral_dashboard() from public,anon,authenticated;
revoke all on function public.get_platform_referral_dashboard() from public,anon,authenticated;
revoke all on function public.platform_set_referral_program_disabled(uuid,boolean,text) from public,anon,authenticated;
revoke all on function public.record_referral_share(uuid) from public,anon,authenticated;
revoke all on function public.platform_review_referral_fraud_flag(uuid,text,text) from public,anon,authenticated;
grant execute on function public.save_restaurant_referral_program(boolean,text,integer,text,integer,integer,integer,integer,timestamptz,timestamptz,integer,integer,text) to authenticated;
grant execute on function public.get_customer_referral_dashboard() to authenticated;
grant execute on function public.get_referral_program_by_code(text) to anon,authenticated;
grant execute on function public.create_referral_attribution(text) to anon,authenticated;
grant execute on function public.claim_referral_attribution(uuid) to authenticated;
grant execute on function public.process_due_referral_rewards(integer) to service_role;
grant execute on function public.get_restaurant_referral_dashboard() to authenticated;
grant execute on function public.get_platform_referral_dashboard() to authenticated;
grant execute on function public.platform_set_referral_program_disabled(uuid,boolean,text) to authenticated;
grant execute on function public.record_referral_share(uuid) to authenticated;
grant execute on function public.platform_review_referral_fraud_flag(uuid,text,text) to authenticated;
