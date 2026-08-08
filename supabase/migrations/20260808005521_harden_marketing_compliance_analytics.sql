-- Phase 5.8 hardening: tenant integrity, RPC-only writes, complete preferences,
-- marketing timeline reconciliation, retention analytics, local-day throttling,
-- pre-send unsubscribe registration and provider suppression semantics.

create or replace function public.validate_marketing_tenant_references()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_table_name='restaurant_marketing_campaigns' then
    if new.custom_segment_id is not null and not exists(select 1 from public.restaurant_customer_segments x where x.id=new.custom_segment_id and x.restaurant_id=new.restaurant_id) then raise exception 'Segment does not belong to restaurant' using errcode='42501'; end if;
    if new.promotion_id is not null and not exists(select 1 from public.restaurant_promotions x where x.id=new.promotion_id and x.restaurant_id=new.restaurant_id) then raise exception 'Promotion does not belong to restaurant' using errcode='42501'; end if;
    if new.reward_catalogue_id is not null and not exists(select 1 from public.restaurant_loyalty_rewards x where x.id=new.reward_catalogue_id and x.restaurant_id=new.restaurant_id) then raise exception 'Reward does not belong to restaurant' using errcode='42501'; end if;
    if new.template_id is not null and not exists(select 1 from public.restaurant_marketing_templates x where x.id=new.template_id and x.restaurant_id=new.restaurant_id) then raise exception 'Template does not belong to restaurant' using errcode='42501'; end if;
  elsif tg_table_name='restaurant_marketing_automation_steps' then
    if not exists(select 1 from public.restaurant_marketing_automations x where x.id=new.automation_id and x.restaurant_id=new.restaurant_id) then raise exception 'Automation does not belong to restaurant' using errcode='42501'; end if;
    if new.promotion_id is not null and not exists(select 1 from public.restaurant_promotions x where x.id=new.promotion_id and x.restaurant_id=new.restaurant_id) then raise exception 'Promotion does not belong to restaurant' using errcode='42501'; end if;
    if new.reward_catalogue_id is not null and not exists(select 1 from public.restaurant_loyalty_rewards x where x.id=new.reward_catalogue_id and x.restaurant_id=new.restaurant_id) then raise exception 'Reward does not belong to restaurant' using errcode='42501'; end if;
  end if;
  return new;
end $$;

drop trigger if exists marketing_campaign_tenant_refs on public.restaurant_marketing_campaigns;
create trigger marketing_campaign_tenant_refs before insert or update on public.restaurant_marketing_campaigns for each row execute function public.validate_marketing_tenant_references();
drop trigger if exists marketing_automation_step_tenant_refs on public.restaurant_marketing_automation_steps;
create trigger marketing_automation_step_tenant_refs before insert or update on public.restaurant_marketing_automation_steps for each row execute function public.validate_marketing_tenant_references();

revoke insert,update,delete,truncate on public.restaurant_marketing_settings,public.customer_marketing_preferences,public.customer_restaurant_marketing_preferences,public.restaurant_customer_notes,public.restaurant_customer_segments from anon,authenticated;
grant select on public.customer_marketing_preferences,public.customer_restaurant_marketing_preferences to authenticated;

create or replace function public.get_customer_marketing_preferences()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_result jsonb;
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select jsonb_build_object(
    'global',coalesce((select to_jsonb(g)-'customer_user_id'-'created_at'-'updated_at' from public.customer_marketing_preferences g where g.customer_user_id=v_user),jsonb_build_object('marketing_emails',false,'promotional_notifications',false,'loyalty_notifications',true,'referral_notifications',true,'birthday_notifications',true,'global_opt_out',false)),
    'restaurants',coalesce((select jsonb_agg(jsonb_build_object('restaurant_id',r.id,'restaurant_name',r.name,'marketing_emails',coalesce(rp.marketing_emails,true),'promotional_notifications',coalesce(rp.promotional_notifications,true),'loyalty_notifications',coalesce(rp.loyalty_notifications,true),'referral_notifications',coalesce(rp.referral_notifications,true),'birthday_notifications',coalesce(rp.birthday_notifications,true),'restaurant_opt_out',coalesce(rp.restaurant_opt_out,false),'consent_updated_at',rp.consent_updated_at) order by r.name) from (select distinct o.restaurant_id from public.orders o where o.customer_user_id=v_user) x join public.restaurants r on r.id=x.restaurant_id left join public.customer_restaurant_marketing_preferences rp on rp.restaurant_id=r.id and rp.customer_user_id=v_user),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

create or replace function public.get_restaurant_customer_timeline(p_restaurant_id uuid,p_customer_user_id uuid,p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  if auth.role()<>'service_role' and not public.is_restaurant_member(p_restaurant_id) and not public.is_platform_admin() then raise exception 'Restaurant access denied' using errcode='42501'; end if;
  with events as(
    select o.created_at event_at,'order'::text event_type,o.id source_id,jsonb_build_object('order_number',o.order_number,'status',o.order_status,'total_pence',o.total_pence) details from public.orders o where o.restaurant_id=p_restaurant_id and o.customer_user_id=p_customer_user_id
    union all select l.created_at,'loyalty',l.id,jsonb_build_object('points_delta',l.points_delta,'entry_type',l.entry_type,'note',l.note) from public.customer_loyalty_ledger l where l.restaurant_id=p_restaurant_id and l.customer_user_id=p_customer_user_id
    union all select c.created_at,'wallet',c.id,jsonb_build_object('amount_pence',c.amount_pence,'entry_type',c.entry_type,'note',c.note) from public.customer_credit_ledger c where c.restaurant_id=p_restaurant_id and c.customer_user_id=p_customer_user_id
    union all select s.created_at,'stamp',s.id,jsonb_build_object('stamps_delta',s.stamps_delta,'event_type',s.event_type,'program_id',s.program_id) from public.customer_stamp_events s where s.restaurant_id=p_restaurant_id and s.customer_user_id=p_customer_user_id
    union all select r.created_at,'referral',r.id,jsonb_build_object('status',r.status,'referred_user_id',r.referred_user_id,'qualified_at',r.qualified_at,'rewarded_at',r.rewarded_at) from public.customer_referrals r where r.restaurant_id=p_restaurant_id and r.referrer_user_id=p_customer_user_id
    union all select vh.created_at,'vip',vh.id,jsonb_build_object('from_tier_id',vh.from_tier_id,'to_tier_id',vh.to_tier_id,'change_type',vh.change_type,'reason',vh.reason) from public.customer_vip_tier_history vh where vh.restaurant_id=p_restaurant_id and vh.customer_user_id=p_customer_user_id
    union all select coalesce(ccp.completed_at,ccp.last_progress_at,ccp.created_at),'challenge',ccp.id,jsonb_build_object('challenge_id',ccp.challenge_id,'status',ccp.status,'progress_percent',ccp.progress_percent) from public.customer_challenge_progress ccp where ccp.restaurant_id=p_restaurant_id and ccp.customer_user_id=p_customer_user_id
    union all select ri.created_at,'reward',ri.id,jsonb_build_object('source_type',ri.source_type,'reward_type',ri.reward_type,'status',ri.status,'issued_at',ri.issued_at,'redeemed_at',ri.redeemed_at) from public.customer_reward_issuances ri where ri.restaurant_id=p_restaurant_id and ri.customer_user_id=p_customer_user_id
    union all select n.created_at,'notification',n.id,jsonb_build_object('notification_type',n.notification_type,'title',n.title,'read_at',n.read_at) from public.customer_notifications n where n.restaurant_id=p_restaurant_id and n.customer_user_id=p_customer_user_id
    union all select rn.created_at,'support_note',rn.id,jsonb_build_object('note',rn.note,'created_by',rn.created_by) from public.restaurant_customer_notes rn where rn.restaurant_id=p_restaurant_id and rn.customer_user_id=p_customer_user_id
    union all select d.created_at,case when d.channel='email' then 'email' else 'campaign_interaction' end,d.id,jsonb_build_object('campaign_id',d.campaign_id,'automation_id',d.automation_id,'channel',d.channel,'subject',d.subject,'status',d.status,'sent_at',d.sent_at,'delivered_at',d.delivered_at,'opened_at',d.opened_at,'clicked_at',d.clicked_at) from public.restaurant_marketing_deliveries d where d.restaurant_id=p_restaurant_id and d.customer_user_id=p_customer_user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('event_at',event_at,'event_type',event_type,'source_id',source_id,'details',details) order by event_at desc),'[]'::jsonb) into v_result from(select * from events order by event_at desc limit least(greatest(coalesce(p_limit,100),1),250))x;
  return v_result;
end $$;

create or replace function public.get_restaurant_marketing_reports(p_days integer default 90)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_restaurant uuid:=public.marketing_member_restaurant_id();v_period integer:=least(greatest(coalesce(p_days,90),1),730);v_since timestamptz:=now()-(v_period||' days')::interval;v_prev timestamptz:=now()-(v_period*2||' days')::interval;v_result jsonb;
begin
  if v_restaurant is null then raise exception 'Restaurant membership not found' using errcode='42501'; end if;
  with stats as(select d.campaign_id,count(*) filter(where d.sent_at is not null) sent,count(*) filter(where d.delivered_at is not null) delivered,count(*) filter(where d.opened_at is not null) opened,count(*) filter(where d.clicked_at is not null) clicked from public.restaurant_marketing_deliveries d where d.restaurant_id=v_restaurant and d.created_at>=v_since group by d.campaign_id),
  conv as(select campaign_id,count(*) orders,coalesce(sum(revenue_pence),0) revenue,coalesce(sum(reward_cost_pence),0) cost from public.restaurant_marketing_conversions where restaurant_id=v_restaurant and attributed_at>=v_since group by campaign_id),
  current_customers as(select customer_user_id,count(*) orders,min(created_at) first_in_period from public.orders where restaurant_id=v_restaurant and customer_user_id is not null and payment_status='paid' and order_status<>'rejected' and created_at>=v_since group by customer_user_id),
  historic as(select customer_user_id,max(created_at) before_current from public.orders where restaurant_id=v_restaurant and customer_user_id is not null and payment_status='paid' and order_status<>'rejected' and created_at<v_since group by customer_user_id),
  previous_customers as(select distinct customer_user_id from public.orders where restaurant_id=v_restaurant and customer_user_id is not null and payment_status='paid' and order_status<>'rejected' and created_at>=v_prev and created_at<v_since),
  retained as(select count(*)::numeric n from previous_customers p where exists(select 1 from current_customers c where c.customer_user_id=p.customer_user_id)),
  previous_count as(select count(*)::numeric n from previous_customers),
  reactivation as(select count(distinct mc.customer_user_id)::numeric converted from public.restaurant_marketing_conversions mc join historic h on h.customer_user_id=mc.customer_user_id where mc.restaurant_id=v_restaurant and mc.attributed_at>=v_since and h.before_current<=mc.attributed_at-interval '30 days'),
  winback_targets as(select count(distinct d.customer_user_id)::numeric targeted from public.restaurant_marketing_deliveries d join public.restaurant_marketing_campaigns ca on ca.id=d.campaign_id where d.restaurant_id=v_restaurant and d.created_at>=v_since and ca.segment_key in('inactive_30_days','inactive_60_days','inactive_90_plus_days'))
  select jsonb_build_object('summary',jsonb_build_object('sent',coalesce(sum(s.sent),0),'delivered',coalesce(sum(s.delivered),0),'opened',coalesce(sum(s.opened),0),'clicked',coalesce(sum(s.clicked),0),'orders_generated',coalesce(sum(c.orders),0),'revenue_generated_pence',coalesce(sum(c.revenue),0),'reward_cost_pence',coalesce(sum(c.cost),0),'customer_growth',(select count(*) from current_customers cc left join historic h on h.customer_user_id=cc.customer_user_id where h.customer_user_id is null),'repeat_customer_percent',coalesce((select round(100.0*count(*) filter(where orders>=2)/nullif(count(*),0),1) from current_customers),0),'retention_percent',coalesce((select round(100.0*r.n/nullif(p.n,0),1) from retained r cross join previous_count p),0),'reactivation_percent',coalesce((select round(100.0*r.converted/nullif(w.targeted,0),1) from reactivation r cross join winback_targets w),0)),'campaigns',coalesce(jsonb_agg(jsonb_build_object('id',ca.id,'name',ca.name,'sent',coalesce(s.sent,0),'delivered',coalesce(s.delivered,0),'opened',coalesce(s.opened,0),'clicked',coalesce(s.clicked,0),'conversion_orders',coalesce(c.orders,0),'revenue_pence',coalesce(c.revenue,0),'reward_cost_pence',coalesce(c.cost,0)) order by coalesce(c.revenue,0) desc) filter(where ca.id is not null),'[]'::jsonb)) into v_result from public.restaurant_marketing_campaigns ca left join stats s on s.campaign_id=ca.id left join conv c on c.campaign_id=ca.id where ca.restaurant_id=v_restaurant;
  return v_result;
end $$;

create or replace function public.get_platform_marketing_analytics(p_days integer default 90)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_period integer:=least(greatest(coalesce(p_days,90),1),730);v_since timestamptz:=now()-(v_period||' days')::interval;v_prev timestamptz:=now()-(v_period*2||' days')::interval;v_result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'Platform admin access required' using errcode='42501'; end if;
  with current_active as(select distinct restaurant_id,customer_user_id from public.orders where customer_user_id is not null and payment_status='paid' and order_status<>'rejected' and created_at>=v_since),previous_active as(select distinct restaurant_id,customer_user_id from public.orders where customer_user_id is not null and payment_status='paid' and order_status<>'rejected' and created_at>=v_prev and created_at<v_since),retained as(select count(*)::numeric n from previous_active p where exists(select 1 from current_active c where c.restaurant_id=p.restaurant_id and c.customer_user_id=p.customer_user_id)),previous_count as(select count(*)::numeric n from previous_active)
  select jsonb_build_object('restaurants_adopted',(select count(distinct restaurant_id) from public.restaurant_marketing_campaigns),'campaign_volume',(select count(*) from public.restaurant_marketing_campaign_runs where created_at>=v_since),'email_volume',(select count(*) from public.restaurant_marketing_deliveries where channel='email' and created_at>=v_since),'notifications_volume',(select count(*) from public.restaurant_marketing_deliveries where channel='in_app' and created_at>=v_since),'revenue_generated_pence',(select coalesce(sum(revenue_pence),0) from public.restaurant_marketing_conversions where attributed_at>=v_since),'reward_cost_pence',(select coalesce(sum(reward_cost_pence),0) from public.restaurant_marketing_conversions where attributed_at>=v_since),'engaged_customers',(select count(distinct customer_user_id) from public.restaurant_marketing_deliveries where created_at>=v_since and(opened_at is not null or clicked_at is not null)),'automation_usage',(select count(distinct restaurant_id) from public.restaurant_marketing_automations where status='active'),'active_automations',(select count(*) from public.restaurant_marketing_automations where status='active'),'retention_percent',coalesce((select round(100.0*r.n/nullif(p.n,0),1) from retained r cross join previous_count p),0),'customer_growth',(select count(*) from current_active c where not exists(select 1 from previous_active p where p.restaurant_id=c.restaurant_id and p.customer_user_id=c.customer_user_id))) into v_result;
  return v_result;
end $$;

create or replace function public.marketing_claim_deliveries(p_limit integer default 100)
returns setof public.restaurant_marketing_deliveries language plpgsql security definer set search_path='' as $$
begin
  if auth.role()<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  return query with eligible as(
    select d.id from public.restaurant_marketing_deliveries d left join public.restaurant_marketing_settings s on s.restaurant_id=d.restaurant_id
    where d.status in('queued','failed') and d.available_at<=now() and d.attempts<5
      and(select count(*) from public.restaurant_marketing_deliveries x where x.restaurant_id=d.restaurant_id and x.channel=d.channel and (x.sent_at at time zone coalesce(s.timezone,'Europe/London'))::date=(now() at time zone coalesce(s.timezone,'Europe/London'))::date)<case when d.channel='email' then coalesce(s.max_email_sends_per_day,5000) else coalesce(s.max_notification_sends_per_day,10000) end
      and(select count(*) from public.restaurant_marketing_deliveries x where x.restaurant_id=d.restaurant_id and x.customer_user_id=d.customer_user_id and (x.sent_at at time zone coalesce(s.timezone,'Europe/London'))::date=(now() at time zone coalesce(s.timezone,'Europe/London'))::date)<coalesce(s.max_sends_per_customer_per_day,3)
      and(select count(*) from public.restaurant_marketing_deliveries x where x.restaurant_id=d.restaurant_id and x.sent_at>=now()-interval '1 minute')<coalesce(s.rate_limit_per_minute,250)
    order by d.available_at,d.created_at for update of d skip locked limit least(greatest(p_limit,1),500)
  ),claimed as(update public.restaurant_marketing_deliveries d set status='processing',attempts=d.attempts+1,updated_at=now(),last_error=null from eligible e where d.id=e.id returning d.*)
  select * from claimed;
end $$;

create or replace function public.marketing_register_unsubscribe_token(p_delivery_id uuid,p_token_hash text)
returns boolean language plpgsql security definer set search_path='' as $$
declare d public.restaurant_marketing_deliveries%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  select * into d from public.restaurant_marketing_deliveries where id=p_delivery_id and channel='email'; if d.id is null then return false; end if;
  insert into public.restaurant_marketing_unsubscribe_tokens(delivery_id,restaurant_id,customer_user_id,token_hash) values(d.id,d.restaurant_id,d.customer_user_id,p_token_hash) on conflict(delivery_id) do update set token_hash=excluded.token_hash,expires_at=now()+interval '180 days',used_at=null;
  return true;
end $$;

create or replace function public.marketing_record_resend_event(p_provider_message_id text,p_event_type text,p_provider_event_id text,p_event_at timestamptz,p_metadata jsonb default '{}'::jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare d public.restaurant_marketing_deliveries%rowtype;v_status text;v_reason text;
begin
  if auth.role()<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  select * into d from public.restaurant_marketing_deliveries where provider_message_id=p_provider_message_id; if d.id is null then return false; end if;
  insert into public.restaurant_marketing_delivery_events(delivery_id,restaurant_id,event_type,provider_event_id,event_at,metadata) values(d.id,d.restaurant_id,p_event_type,p_provider_event_id,coalesce(p_event_at,now()),coalesce(p_metadata,'{}')) on conflict(provider_event_id) do nothing; if not found then return true; end if;
  v_status:=case p_event_type when 'email.delivered' then 'delivered' when 'email.opened' then 'opened' when 'email.clicked' then 'clicked' when 'email.failed' then 'failed' when 'email.bounced' then 'failed' when 'email.complained' then 'failed' when 'email.suppressed' then 'failed' else d.status end;
  update public.restaurant_marketing_deliveries set status=v_status,delivered_at=case when p_event_type='email.delivered' then coalesce(p_event_at,now()) else delivered_at end,opened_at=case when p_event_type='email.opened' then coalesce(opened_at,p_event_at,now()) else opened_at end,clicked_at=case when p_event_type='email.clicked' then coalesce(clicked_at,p_event_at,now()) else clicked_at end,failed_at=case when p_event_type in('email.failed','email.bounced','email.complained','email.suppressed') then coalesce(p_event_at,now()) else failed_at end,updated_at=now() where id=d.id;
  if p_event_type in('email.bounced','email.complained','email.suppressed') then v_reason:=case p_event_type when 'email.complained' then 'complaint' when 'email.suppressed' then 'invalid' else 'bounce' end; insert into public.restaurant_marketing_suppressions(restaurant_id,customer_user_id,email,channel,reason,source) values(d.restaurant_id,d.customer_user_id,d.recipient_email,'email',v_reason,'resend_webhook') on conflict do nothing; end if;
  return true;
end $$;

revoke all on function public.validate_marketing_tenant_references(),public.marketing_register_unsubscribe_token(uuid,text) from public;
