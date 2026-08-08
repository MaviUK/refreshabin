create or replace function private.queue_vip_integrated_reward_notification()
returns trigger language plpgsql security definer set search_path='' as $$
declare event_type text; title text; body text; dedupe text; tier_name text;
begin
  if new.status<>'available' or old.status='available' or new.source_type not in ('birthday','milestone') then return new; end if;
  if new.source_type='birthday' and coalesce((new.metadata->>'vip_multiplier_applied')::boolean,false) then
    event_type:='vip_birthday_bonus'; title:='Your VIP birthday bonus is ready'; body:='Your VIP membership boosted this birthday reward. Open your rewards to see the enhanced benefit.';
  elsif new.source_type='milestone' and exists(select 1 from public.customer_vip_memberships m where m.restaurant_id=new.restaurant_id and m.customer_user_id=new.customer_user_id and m.current_tier_id is not null) then
    select t.name into tier_name from public.customer_vip_memberships m join public.restaurant_vip_tiers t on t.id=m.current_tier_id where m.restaurant_id=new.restaurant_id and m.customer_user_id=new.customer_user_id;
    event_type:='vip_milestone'; title:='VIP milestone reached'; body:='Your '||coalesce(tier_name,'VIP')||' membership and customer milestone have unlocked a new reward.';
  else return new; end if;
  dedupe:='reward:'||new.id::text||':'||event_type;
  insert into public.customer_notifications(customer_user_id,restaurant_id,notification_type,title,body,action_url,metadata,dedupe_key)
  values(new.customer_user_id,new.restaurant_id,event_type,title,body,'/account/vip',jsonb_build_object('reward_issuance_id',new.id,'source_type',new.source_type,'source_id',new.source_id),dedupe) on conflict do nothing;
  insert into public.reward_notification_queue(reward_issuance_id,restaurant_id,customer_user_id,event_type,subject,body,action_url,push_payload,dedupe_key)
  values(new.id,new.restaurant_id,new.customer_user_id,event_type,title,body,'/account/vip',jsonb_build_object('type',event_type,'reward_issuance_id',new.id,'action_url','/account/vip'),dedupe) on conflict do nothing;
  return new;
end $$;
drop trigger if exists customer_reward_issuances_vip_notification_trigger on public.customer_reward_issuances;
create trigger customer_reward_issuances_vip_notification_trigger after update of status on public.customer_reward_issuances for each row execute function private.queue_vip_integrated_reward_notification();

create or replace function public.get_vip_notification_queue_health()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role authorization required' using errcode='42501'; end if;
  return jsonb_build_object('pending',(select count(*) from public.reward_notification_queue where event_type like 'vip_%' and status='pending'),'failed',(select count(*) from public.reward_notification_queue where event_type like 'vip_%' and status='failed'),'oldest_pending_at',(select min(created_at) from public.reward_notification_queue where event_type like 'vip_%' and status='pending'));
end $$;
revoke all on function public.get_vip_notification_queue_health() from public,anon,authenticated;
grant execute on function public.get_vip_notification_queue_health() to service_role;
