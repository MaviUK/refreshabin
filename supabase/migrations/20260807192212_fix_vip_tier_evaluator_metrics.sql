create or replace function private.evaluate_customer_vip_tier(p_restaurant_id uuid,p_customer_user_id uuid,p_reason text default 'automatic',p_actor_kind text default 'system',p_actor_user_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.restaurant_vip_programs%rowtype; m public.customer_vip_memberships%rowtype; v_metrics jsonb; candidate uuid; current_priority integer; candidate_priority integer; current_active boolean; next_tier uuid; change_kind text; history_id uuid; next_version integer; recent_changes integer;
begin
  select * into p from public.restaurant_vip_programs where restaurant_id=p_restaurant_id;
  if not found then return jsonb_build_object('changed',false,'tier_id',null); end if;
  v_metrics:=private.calculate_customer_vip_metrics(p_restaurant_id,p_customer_user_id);
  candidate:=private.resolve_customer_vip_tier(p_restaurant_id,v_metrics);
  insert into public.customer_vip_memberships(restaurant_id,customer_user_id,metrics,evaluated_at) values(p_restaurant_id,p_customer_user_id,v_metrics,now()) on conflict(restaurant_id,customer_user_id) do nothing;
  select * into m from public.customer_vip_memberships where restaurant_id=p_restaurant_id and customer_user_id=p_customer_user_id for update;
  if m.current_tier_id is not null then select priority,(archived_at is null and is_active) into current_priority,current_active from public.restaurant_vip_tiers where id=m.current_tier_id; end if;
  if candidate is not null then select priority into candidate_priority from public.restaurant_vip_tiers where id=candidate; end if;
  next_tier:=candidate;
  if m.current_tier_id is not null and candidate is distinct from m.current_tier_id and coalesce(candidate_priority,-1)<coalesce(current_priority,0) and coalesce(current_active,false) and not (p.qualification_window='rolling' and p.allow_downgrades) then next_tier:=m.current_tier_id; end if;
  if m.current_tier_id is not distinct from next_tier then
    update public.customer_vip_memberships set metrics=v_metrics,evaluated_at=now(),updated_at=now() where id=m.id;
    return jsonb_build_object('changed',false,'membership_id',m.id,'tier_id',next_tier,'metrics',v_metrics);
  end if;
  change_kind:=case when m.current_tier_id is null and next_tier is not null then 'initial' when next_tier is null then 'removed' when coalesce(candidate_priority,-1)>coalesce(current_priority,-1) then 'upgrade' else 'downgrade' end;
  next_version:=m.membership_version+1;
  update public.customer_vip_memberships set current_tier_id=next_tier,metrics=v_metrics,membership_version=next_version,qualified_at=case when next_tier is null then qualified_at else coalesce(qualified_at,now()) end,evaluated_at=now(),tier_changed_at=now(),updated_at=now() where id=m.id;
  insert into public.customer_vip_tier_history(membership_id,membership_version,restaurant_id,customer_user_id,from_tier_id,to_tier_id,change_type,reason,metrics_snapshot,actor_kind,actor_user_id)
  values(m.id,next_version,p_restaurant_id,p_customer_user_id,m.current_tier_id,next_tier,change_kind,coalesce(nullif(trim(p_reason),''),'automatic'),v_metrics,case when p_actor_kind in ('system','restaurant','platform') then p_actor_kind else 'system' end,p_actor_user_id) returning id into history_id;
  perform private.queue_vip_tier_notification(history_id);
  if change_kind in ('initial','upgrade') then perform private.issue_vip_exclusive_rewards(history_id); end if;
  select count(*) into recent_changes from public.customer_vip_tier_history where membership_id=m.id and created_at>=now()-interval '24 hours';
  if recent_changes>=4 then insert into public.vip_fraud_flags(restaurant_id,customer_user_id,membership_id,tier_history_id,flag_type,severity,details) select p_restaurant_id,p_customer_user_id,m.id,history_id,'rapid_tier_changes','high',jsonb_build_object('changes_24h',recent_changes) where not exists(select 1 from public.vip_fraud_flags f where f.membership_id=m.id and f.flag_type='rapid_tier_changes' and f.status='open' and f.created_at>=now()-interval '24 hours'); end if;
  return jsonb_build_object('changed',true,'membership_id',m.id,'history_id',history_id,'change_type',change_kind,'tier_id',next_tier,'metrics',v_metrics);
end $$;
