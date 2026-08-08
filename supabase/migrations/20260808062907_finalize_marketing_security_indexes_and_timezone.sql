create index if not exists crm_restaurant_marketing_user_fk_idx on public.customer_restaurant_marketing_preferences(customer_user_id);
create index if not exists crm_notes_created_by_fk_idx on public.restaurant_customer_notes(created_by);
create index if not exists crm_notes_customer_fk_idx on public.restaurant_customer_notes(customer_user_id);
create index if not exists crm_segments_created_by_fk_idx on public.restaurant_customer_segments(created_by);
create index if not exists marketing_audit_actor_fk_idx on public.restaurant_marketing_audit_log(actor_user_id);
create index if not exists marketing_audit_restaurant_fk_idx on public.restaurant_marketing_audit_log(restaurant_id);
create index if not exists marketing_automation_runs_customer_fk_idx on public.restaurant_marketing_automation_runs(customer_user_id);
create index if not exists marketing_automation_runs_restaurant_fk_idx on public.restaurant_marketing_automation_runs(restaurant_id);
create index if not exists marketing_automation_steps_promotion_fk_idx on public.restaurant_marketing_automation_steps(promotion_id);
create index if not exists marketing_automation_steps_restaurant_fk_idx on public.restaurant_marketing_automation_steps(restaurant_id);
create index if not exists marketing_automation_steps_reward_fk_idx on public.restaurant_marketing_automation_steps(reward_catalogue_id);
create index if not exists marketing_automations_created_by_fk_idx on public.restaurant_marketing_automations(created_by);
create index if not exists marketing_automations_restaurant_fk_idx on public.restaurant_marketing_automations(restaurant_id);
create index if not exists marketing_campaign_runs_restaurant_fk_idx on public.restaurant_marketing_campaign_runs(restaurant_id);
create index if not exists marketing_campaigns_created_by_fk_idx on public.restaurant_marketing_campaigns(created_by);
create index if not exists marketing_campaigns_segment_fk_idx on public.restaurant_marketing_campaigns(custom_segment_id);
create index if not exists marketing_campaigns_promotion_fk_idx on public.restaurant_marketing_campaigns(promotion_id);
create index if not exists marketing_campaigns_restaurant_fk_idx on public.restaurant_marketing_campaigns(restaurant_id);
create index if not exists marketing_campaigns_reward_fk_idx on public.restaurant_marketing_campaigns(reward_catalogue_id);
create index if not exists marketing_campaigns_template_fk_idx on public.restaurant_marketing_campaigns(template_id);
create index if not exists marketing_conversions_automation_fk_idx on public.restaurant_marketing_conversions(automation_id);
create index if not exists marketing_conversions_campaign_fk_idx on public.restaurant_marketing_conversions(campaign_id);
create index if not exists marketing_conversions_customer_fk_idx on public.restaurant_marketing_conversions(customer_user_id);
create index if not exists marketing_conversions_delivery_fk_idx on public.restaurant_marketing_conversions(delivery_id);
create index if not exists marketing_deliveries_automation_fk_idx on public.restaurant_marketing_deliveries(automation_id);
create index if not exists marketing_deliveries_automation_run_fk_idx on public.restaurant_marketing_deliveries(automation_run_id);
create index if not exists marketing_deliveries_automation_step_fk_idx on public.restaurant_marketing_deliveries(automation_step_id);
create index if not exists marketing_deliveries_campaign_fk_idx on public.restaurant_marketing_deliveries(campaign_id);
create index if not exists marketing_deliveries_campaign_run_fk_idx on public.restaurant_marketing_deliveries(campaign_run_id);
create index if not exists marketing_deliveries_customer_fk_idx on public.restaurant_marketing_deliveries(customer_user_id);
create index if not exists marketing_delivery_events_restaurant_fk_idx on public.restaurant_marketing_delivery_events(restaurant_id);
create index if not exists marketing_suppressions_customer_fk_idx on public.restaurant_marketing_suppressions(customer_user_id);
create index if not exists marketing_templates_created_by_fk_idx on public.restaurant_marketing_templates(created_by);
create index if not exists marketing_unsubscribe_customer_fk_idx on public.restaurant_marketing_unsubscribe_tokens(customer_user_id);
create index if not exists marketing_unsubscribe_restaurant_fk_idx on public.restaurant_marketing_unsubscribe_tokens(restaurant_id);

drop policy if exists customer_restaurant_marketing_preferences_self_write on public.customer_restaurant_marketing_preferences;
drop policy if exists restaurant_customer_notes_member_write on public.restaurant_customer_notes;
drop policy if exists restaurant_customer_segments_member_write on public.restaurant_customer_segments;
drop policy if exists restaurant_marketing_settings_member_write on public.restaurant_marketing_settings;
revoke insert,update,delete on public.customer_marketing_preferences from anon,authenticated;
revoke insert,update,delete on public.customer_restaurant_marketing_preferences from anon,authenticated;

create or replace function public.save_restaurant_marketing_campaign(p_campaign jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare
 v_restaurant uuid:=public.marketing_member_restaurant_id();v_id uuid;
 v_type text:=coalesce(p_campaign->>'campaign_type','one_off');
 v_status text:=coalesce(p_campaign->>'status','draft');
 v_timezone text:=coalesce(nullif(p_campaign->>'timezone',''),'Europe/London');
 v_scheduled timestamptz;
 v_recurrence text:=nullif(p_campaign->>'recurrence_unit','');
begin
 if v_restaurant is null then raise exception 'Restaurant membership not found' using errcode='42501';end if;
 if v_type not in('one_off','scheduled','recurring','triggered') or v_status not in('draft','scheduled','active','paused') then raise exception 'Invalid campaign configuration';end if;
 if not public.marketing_timezone_is_valid(v_timezone) then raise exception 'Invalid timezone';end if;
 if nullif(p_campaign->>'scheduled_local','') is not null then v_scheduled:=(p_campaign->>'scheduled_local')::timestamp at time zone v_timezone; else v_scheduled:=nullif(p_campaign->>'scheduled_at','')::timestamptz; end if;
 if v_status='scheduled' and v_scheduled is null then raise exception 'Scheduled campaigns require a scheduled time';end if;
 if v_type='recurring' and v_recurrence not in('day','week','month') then raise exception 'Recurring campaigns require day, week, or month recurrence';end if;
 if nullif(btrim(p_campaign->>'name'),'') is null then raise exception 'Campaign name is required';end if;
 if nullif(p_campaign->>'id','') is null then
   insert into public.restaurant_marketing_campaigns(restaurant_id,name,campaign_type,status,channels,segment_key,custom_segment_id,subject,preview_text,html_content,text_content,cta_label,cta_url,image_url,promotion_id,reward_catalogue_id,template_id,branding,timezone,scheduled_at,next_run_at,recurrence_unit,recurrence_interval,starts_at,ends_at,created_by)
   values(v_restaurant,btrim(p_campaign->>'name'),v_type,v_status,coalesce(array(select jsonb_array_elements_text(coalesce(p_campaign->'channels','["email"]'))),array['email']),nullif(p_campaign->>'segment_key',''),nullif(p_campaign->>'custom_segment_id','')::uuid,p_campaign->>'subject',p_campaign->>'preview_text',coalesce(p_campaign->>'html_content',''),p_campaign->>'text_content',p_campaign->>'cta_label',p_campaign->>'cta_url',p_campaign->>'image_url',nullif(p_campaign->>'promotion_id','')::uuid,nullif(p_campaign->>'reward_catalogue_id','')::uuid,nullif(p_campaign->>'template_id','')::uuid,coalesce(p_campaign->'branding','{}'),v_timezone,v_scheduled,case when v_status in('scheduled','active') then coalesce(v_scheduled,now()) end,v_recurrence,coalesce(nullif(p_campaign->>'recurrence_interval','')::int,1),nullif(p_campaign->>'starts_at','')::timestamptz,nullif(p_campaign->>'ends_at','')::timestamptz,auth.uid()) returning id into v_id;
 else
   v_id:=(p_campaign->>'id')::uuid;
   update public.restaurant_marketing_campaigns set name=btrim(p_campaign->>'name'),campaign_type=v_type,status=v_status,channels=coalesce(array(select jsonb_array_elements_text(coalesce(p_campaign->'channels','["email"]'))),array['email']),segment_key=nullif(p_campaign->>'segment_key',''),custom_segment_id=nullif(p_campaign->>'custom_segment_id','')::uuid,subject=p_campaign->>'subject',preview_text=p_campaign->>'preview_text',html_content=coalesce(p_campaign->>'html_content',''),text_content=p_campaign->>'text_content',cta_label=p_campaign->>'cta_label',cta_url=p_campaign->>'cta_url',image_url=p_campaign->>'image_url',promotion_id=nullif(p_campaign->>'promotion_id','')::uuid,reward_catalogue_id=nullif(p_campaign->>'reward_catalogue_id','')::uuid,template_id=nullif(p_campaign->>'template_id','')::uuid,branding=coalesce(p_campaign->'branding','{}'),timezone=v_timezone,scheduled_at=v_scheduled,next_run_at=case when v_status in('scheduled','active') then coalesce(v_scheduled,next_run_at,now()) else null end,recurrence_unit=v_recurrence,recurrence_interval=coalesce(nullif(p_campaign->>'recurrence_interval','')::int,1),starts_at=nullif(p_campaign->>'starts_at','')::timestamptz,ends_at=nullif(p_campaign->>'ends_at','')::timestamptz,updated_at=now() where id=v_id and restaurant_id=v_restaurant;
   if not found then raise exception 'Campaign not found';end if;
 end if;
 insert into public.restaurant_marketing_audit_log(restaurant_id,actor_user_id,action,entity_type,entity_id,details) values(v_restaurant,auth.uid(),'campaign_saved','campaign',v_id,jsonb_build_object('status',v_status,'type',v_type));
 return v_id;
end$$;
