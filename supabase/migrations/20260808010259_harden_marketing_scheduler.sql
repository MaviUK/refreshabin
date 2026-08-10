create or replace function public.marketing_timezone_is_valid(p_timezone text)
returns boolean
language sql
stable
set search_path=''
as $$
  select exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone)
$$;

create or replace function public.save_restaurant_marketing_campaign(p_campaign jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare
 v_restaurant uuid:=public.marketing_member_restaurant_id();v_id uuid;
 v_type text:=coalesce(p_campaign->>'campaign_type','one_off');
 v_status text:=coalesce(p_campaign->>'status','draft');
 v_scheduled timestamptz:=nullif(p_campaign->>'scheduled_at','')::timestamptz;
 v_timezone text:=coalesce(nullif(p_campaign->>'timezone',''),'Europe/London');
begin
 if v_restaurant is null then raise exception 'Restaurant membership not found' using errcode='42501';end if;
 if v_type not in('one_off','scheduled','recurring','triggered') or v_status not in('draft','scheduled','active','paused') then raise exception 'Invalid campaign configuration';end if;
 if not public.marketing_timezone_is_valid(v_timezone) then raise exception 'Invalid timezone';end if;
 if nullif(p_campaign->>'id','') is null then
   insert into public.restaurant_marketing_campaigns(restaurant_id,name,campaign_type,status,channels,segment_key,custom_segment_id,subject,preview_text,html_content,text_content,cta_label,cta_url,image_url,promotion_id,reward_catalogue_id,template_id,branding,timezone,scheduled_at,next_run_at,recurrence_unit,recurrence_interval,starts_at,ends_at,created_by)
   values(v_restaurant,btrim(p_campaign->>'name'),v_type,v_status,coalesce(array(select jsonb_array_elements_text(coalesce(p_campaign->'channels','["email"]'))),array['email']),nullif(p_campaign->>'segment_key',''),nullif(p_campaign->>'custom_segment_id','')::uuid,p_campaign->>'subject',p_campaign->>'preview_text',coalesce(p_campaign->>'html_content',''),p_campaign->>'text_content',p_campaign->>'cta_label',p_campaign->>'cta_url',p_campaign->>'image_url',nullif(p_campaign->>'promotion_id','')::uuid,nullif(p_campaign->>'reward_catalogue_id','')::uuid,nullif(p_campaign->>'template_id','')::uuid,coalesce(p_campaign->'branding','{}'),v_timezone,v_scheduled,case when v_status in('scheduled','active') then coalesce(v_scheduled,now()) end,nullif(p_campaign->>'recurrence_unit',''),coalesce(nullif(p_campaign->>'recurrence_interval','')::int,1),nullif(p_campaign->>'starts_at','')::timestamptz,nullif(p_campaign->>'ends_at','')::timestamptz,auth.uid()) returning id into v_id;
 else
   v_id:=(p_campaign->>'id')::uuid;
   update public.restaurant_marketing_campaigns set name=btrim(p_campaign->>'name'),campaign_type=v_type,status=v_status,channels=coalesce(array(select jsonb_array_elements_text(coalesce(p_campaign->'channels','["email"]'))),array['email']),segment_key=nullif(p_campaign->>'segment_key',''),custom_segment_id=nullif(p_campaign->>'custom_segment_id','')::uuid,subject=p_campaign->>'subject',preview_text=p_campaign->>'preview_text',html_content=coalesce(p_campaign->>'html_content',''),text_content=p_campaign->>'text_content',cta_label=p_campaign->>'cta_label',cta_url=p_campaign->>'cta_url',image_url=p_campaign->>'image_url',promotion_id=nullif(p_campaign->>'promotion_id','')::uuid,reward_catalogue_id=nullif(p_campaign->>'reward_catalogue_id','')::uuid,template_id=nullif(p_campaign->>'template_id','')::uuid,branding=coalesce(p_campaign->'branding','{}'),timezone=v_timezone,scheduled_at=v_scheduled,next_run_at=case when v_status in('scheduled','active') then coalesce(v_scheduled,next_run_at,now()) else null end,recurrence_unit=nullif(p_campaign->>'recurrence_unit',''),recurrence_interval=coalesce(nullif(p_campaign->>'recurrence_interval','')::int,1),starts_at=nullif(p_campaign->>'starts_at','')::timestamptz,ends_at=nullif(p_campaign->>'ends_at','')::timestamptz,updated_at=now() where id=v_id and restaurant_id=v_restaurant;
   if not found then raise exception 'Campaign not found';end if;
 end if;
 insert into public.restaurant_marketing_audit_log(restaurant_id,actor_user_id,action,entity_type,entity_id,details) values(v_restaurant,auth.uid(),'campaign_saved','campaign',v_id,jsonb_build_object('status',v_status,'type',v_type));
 return v_id;
end$$;

create or replace function public.update_restaurant_marketing_settings(p_settings jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_restaurant uuid:=public.marketing_member_restaurant_id();v_result jsonb;v_timezone text:=coalesce(nullif(p_settings->>'timezone',''),'Europe/London');
begin
 if v_restaurant is null then raise exception 'Restaurant membership not found' using errcode='42501';end if;
 if not public.marketing_timezone_is_valid(v_timezone) then raise exception 'Invalid timezone';end if;
 insert into public.restaurant_marketing_settings(restaurant_id,timezone,quiet_hours_start,quiet_hours_end,high_spender_pence,low_spender_pence,referral_champion_threshold,max_email_sends_per_day,max_notification_sends_per_day,max_sends_per_customer_per_day,rate_limit_per_minute,attribution_window_days,updated_at)
 values(v_restaurant,v_timezone,coalesce(nullif(p_settings->>'quiet_hours_start','')::time,'21:00'),coalesce(nullif(p_settings->>'quiet_hours_end','')::time,'08:00'),coalesce(nullif(p_settings->>'high_spender_pence','')::int,10000),coalesce(nullif(p_settings->>'low_spender_pence','')::int,3000),coalesce(nullif(p_settings->>'referral_champion_threshold','')::int,3),coalesce(nullif(p_settings->>'max_email_sends_per_day','')::int,5000),coalesce(nullif(p_settings->>'max_notification_sends_per_day','')::int,10000),coalesce(nullif(p_settings->>'max_sends_per_customer_per_day','')::int,3),coalesce(nullif(p_settings->>'rate_limit_per_minute','')::int,250),coalesce(nullif(p_settings->>'attribution_window_days','')::int,7),now())
 on conflict(restaurant_id) do update set timezone=excluded.timezone,quiet_hours_start=excluded.quiet_hours_start,quiet_hours_end=excluded.quiet_hours_end,high_spender_pence=excluded.high_spender_pence,low_spender_pence=excluded.low_spender_pence,referral_champion_threshold=excluded.referral_champion_threshold,max_email_sends_per_day=excluded.max_email_sends_per_day,max_notification_sends_per_day=excluded.max_notification_sends_per_day,max_sends_per_customer_per_day=excluded.max_sends_per_customer_per_day,rate_limit_per_minute=excluded.rate_limit_per_minute,attribution_window_days=excluded.attribution_window_days,updated_at=now();
 select to_jsonb(s) into v_result from public.restaurant_marketing_settings s where s.restaurant_id=v_restaurant;return v_result;
end$$;

create or replace function public.marketing_process_due_campaigns(p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c record;v_count int:=0;v_next timestamptz;v_local timestamp;
begin
 if auth.role()<>'service_role' then raise exception 'Service role required' using errcode='42501';end if;
 for c in select * from public.restaurant_marketing_campaigns where status in('scheduled','active') and next_run_at is not null and next_run_at<=now() and coalesce(starts_at,next_run_at)<=now() and(ends_at is null or ends_at>now()) order by next_run_at for update skip locked limit least(greatest(p_limit,1),100) loop
   perform public.marketing_enqueue_campaign(c.id,c.next_run_at);v_count:=v_count+1;
   if c.campaign_type='recurring' then
     v_local:=c.next_run_at at time zone c.timezone;
     v_local:=case c.recurrence_unit when 'week' then v_local+make_interval(weeks=>coalesce(c.recurrence_interval,1)) when 'month' then v_local+make_interval(months=>coalesce(c.recurrence_interval,1)) else v_local+make_interval(days=>coalesce(c.recurrence_interval,1)) end;
     v_next:=v_local at time zone c.timezone;
     update public.restaurant_marketing_campaigns set status='active',last_run_at=now(),next_run_at=v_next,updated_at=now() where id=c.id;
   else
     update public.restaurant_marketing_campaigns set status='completed',last_run_at=now(),next_run_at=null,updated_at=now() where id=c.id;
   end if;
 end loop;
 return jsonb_build_object('processed',v_count);
end$$;

revoke all on function public.marketing_timezone_is_valid(text) from public;
