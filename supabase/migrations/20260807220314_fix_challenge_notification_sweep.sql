create or replace function public.process_challenge_notifications(p_now timestamptz default now()) returns jsonb language plpgsql security definer set search_path='' as $$
declare challenge_row record; progress_row record; queued integer:=0;
begin
 if current_user not in ('postgres','service_role') and coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 for challenge_row in select ch.* from public.restaurant_challenges ch where ch.is_active and ch.platform_disabled_at is null and ch.starts_at between p_now and p_now+interval '24 hours' loop
   for progress_row in select distinct o.customer_user_id from public.orders o where o.restaurant_id=challenge_row.restaurant_id and o.customer_user_id is not null loop
     if private.challenge_audience_matches(challenge_row,progress_row.customer_user_id) then
       perform private.queue_challenge_notification(challenge_row.id,null,null,challenge_row.restaurant_id,progress_row.customer_user_id,'challenge_starting','Challenge starting soon',challenge_row.name||' starts soon.','challenge-starting:'||challenge_row.id::text||':'||progress_row.customer_user_id::text);
       queued:=queued+1;
     end if;
   end loop;
 end loop;
 for progress_row in select cp.*,ch.name as challenge_name,ch.ends_at as challenge_ends_at from public.customer_challenge_progress cp join public.restaurant_challenges ch on ch.id=cp.challenge_id where cp.status='active' and ch.ends_at between p_now and p_now+interval '48 hours' loop
   perform private.queue_challenge_notification(progress_row.challenge_id,progress_row.id,null,progress_row.restaurant_id,progress_row.customer_user_id,'challenge_expiring','Challenge ending soon',progress_row.challenge_name||' ends soon.','challenge-expiring:'||progress_row.id::text);
   queued:=queued+1;
 end loop;
 return jsonb_build_object('queued',queued);
end $$;
