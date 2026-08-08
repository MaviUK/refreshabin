create or replace function private.evaluate_customer_challenge(p_challenge_id uuid,p_customer_user_id uuid,p_event_key text,p_order_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.restaurant_challenges%rowtype; cycle text; cp public.customer_challenge_progress%rowtype; cond public.restaurant_challenge_conditions%rowtype; reward public.restaurant_challenge_rewards%rowtype; vals jsonb:='{}'::jsonb; met integer:=0; total integer:=0; pct numeric:=0; val bigint; completed boolean:=false; previous numeric:=0;
begin
 select * into c from public.restaurant_challenges where id=p_challenge_id and is_active and platform_disabled_at is null;
 if not found or now()<c.starts_at or (c.ends_at is not null and now()>c.ends_at) or not private.challenge_audience_matches(c,p_customer_user_id) then return jsonb_build_object('eligible',false); end if;
 if not private.challenge_identity_allowed(c.restaurant_id,p_customer_user_id,p_order_id) then return jsonb_build_object('eligible',false,'reason','identity_risk'); end if;
 cycle:=private.challenge_cycle_key(c,now());
 insert into public.customer_challenge_progress(challenge_id,restaurant_id,customer_user_id,cycle_key) values(c.id,c.restaurant_id,p_customer_user_id,cycle) on conflict(challenge_id,customer_user_id,cycle_key) do nothing;
 select * into cp from public.customer_challenge_progress where challenge_id=c.id and customer_user_id=p_customer_user_id and cycle_key=cycle for update; previous:=cp.progress_percent;
 if exists(select 1 from public.challenge_progress_events where progress_id=cp.id and event_key=p_event_key) then return jsonb_build_object('eligible',true,'progress_id',cp.id,'progress_percent',cp.progress_percent,'status',cp.status,'idempotent',true); end if;
 if cp.status='completed' then return jsonb_build_object('eligible',true,'progress_id',cp.id,'progress_percent',100,'status','completed'); end if;
 for cond in select cc.* from public.restaurant_challenge_conditions cc where cc.challenge_id=c.id order by cc.sort_order,cc.created_at loop
   total:=total+1; val:=private.challenge_metric_value(cond,c,p_customer_user_id,p_order_id);
   vals:=vals||jsonb_build_object(cond.id::text,jsonb_build_object('type',cond.condition_type,'value',val,'target',cond.target_value,'percent',least(100,round(100.0*val/cond.target_value,2))));
   if val>=cond.target_value then met:=met+1; end if; pct:=pct+least(100,100.0*val/cond.target_value);
 end loop;
 if total=0 then return jsonb_build_object('eligible',false,'reason','no_conditions'); end if;
 if c.condition_match='any' then completed:=met>0; pct:=case when completed then 100 else pct/total end; else completed:=met=total; pct:=pct/total; end if; pct:=least(100,round(pct,2));
 update public.customer_challenge_progress set progress_percent=pct,progress=vals,last_progress_at=now(),estimated_completion_at=case when pct>0 and pct<100 and c.ends_at is not null then least(c.ends_at,now()+((c.ends_at-c.starts_at)*(100-pct)/greatest(pct,1))) else estimated_completion_at end,status=case when completed then 'completed' else status end,completed_at=case when completed then coalesce(completed_at,now()) else completed_at end,completion_order_id=case when completed then coalesce(completion_order_id,p_order_id) else completion_order_id end,completion_number=case when completed then completion_number+1 else completion_number end,updated_at=now() where id=cp.id returning * into cp;
 insert into public.challenge_progress_events(progress_id,challenge_id,restaurant_id,customer_user_id,order_id,event_key,event_type,previous_percent,new_percent,details) values(cp.id,c.id,c.restaurant_id,p_customer_user_id,p_order_id,p_event_key,case when completed then 'completed' else 'progress' end,previous,pct,jsonb_build_object('conditions',vals)) on conflict(progress_id,event_key) do nothing;
 if previous<80 and pct>=80 and not completed then perform private.queue_challenge_notification(c.id,cp.id,null,c.restaurant_id,p_customer_user_id,'challenge_nearly_complete','Almost there',c.name||' is nearly complete.','challenge-near:'||cp.id::text||':'||cycle); end if;
 if completed then
   for reward in select rr.* from public.restaurant_challenge_rewards rr where rr.challenge_id=c.id order by rr.sort_order loop perform private.issue_challenge_reward(cp.id,reward.id,p_order_id); end loop;
   perform private.queue_challenge_notification(c.id,cp.id,null,c.restaurant_id,p_customer_user_id,'challenge_completed','Challenge completed','You completed '||c.name||'. Your rewards are ready.','challenge-complete:'||cp.id::text);
 end if;
 return jsonb_build_object('eligible',true,'progress_id',cp.id,'progress_percent',pct,'status',cp.status,'completed',completed,'conditions',vals);
end $$;
