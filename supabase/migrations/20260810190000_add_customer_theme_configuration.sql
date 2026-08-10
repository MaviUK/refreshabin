alter table public.platform_configuration
  add column if not exists theme_settings jsonb not null default jsonb_build_object(
    'primary', '#FF78AC', 'secondary', '#A8D5E3', 'header', '#FDF6EC',
    'surface', '#FFFDF9', 'background', '#DCEFF4', 'text', '#2F2930', 'style', 'sharp'
  );

update public.platform_configuration
set theme_settings = coalesce(theme_settings, '{}'::jsonb) || jsonb_build_object(
  'primary', coalesce(theme_settings->>'primary', '#FF78AC'),
  'secondary', coalesce(theme_settings->>'secondary', '#A8D5E3'),
  'header', coalesce(theme_settings->>'header', '#FDF6EC'),
  'surface', coalesce(theme_settings->>'surface', '#FFFDF9'),
  'background', coalesce(theme_settings->>'background', '#DCEFF4'),
  'text', coalesce(theme_settings->>'text', '#2F2930'),
  'style', coalesce(theme_settings->>'style', 'sharp')
) where singleton;

create or replace function private.public_platform_configuration() returns jsonb language sql stable security definer set search_path to '' as $function$
  select jsonb_build_object('maintenance_mode',c.maintenance_mode,'maintenance_title',c.maintenance_title,'maintenance_message',c.maintenance_message,'ordering_enabled',c.ordering_enabled,'ordering_pause_message',c.ordering_pause_message,'feature_flags',c.feature_flags,'theme_settings',c.theme_settings,'updated_at',c.updated_at) from public.platform_configuration c where c.singleton;
$function$;

create or replace function public.get_platform_configuration() returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare result jsonb;
begin
  if not private.has_platform_admin_permission('settings:view') then raise exception 'You do not have permission to view platform configuration' using errcode='42501'; end if;
  select jsonb_build_object('configuration',jsonb_build_object('maintenance_mode',c.maintenance_mode,'maintenance_title',c.maintenance_title,'maintenance_message',c.maintenance_message,'ordering_enabled',c.ordering_enabled,'ordering_pause_message',c.ordering_pause_message,'notification_preferences',c.notification_preferences,'feature_flags',c.feature_flags,'theme_settings',c.theme_settings,'updated_at',c.updated_at,'updated_by_name',coalesce(pa.display_name,'System')),'history',coalesce((select jsonb_agg(entry order by entry.created_at desc) from (select h.id,h.reason,h.previous_configuration,h.next_configuration,h.created_at,coalesce(a.display_name,'Removed administrator') actor_name from public.platform_configuration_history h left join public.platform_admins a on a.user_id=h.actor_user_id order by h.created_at desc limit 20) entry),'[]'::jsonb)) into result from public.platform_configuration c left join public.platform_admins pa on pa.user_id=c.updated_by where c.singleton;
  return result;
end;$function$;

create or replace function public.update_platform_configuration(p_maintenance_mode boolean,p_maintenance_title text,p_maintenance_message text,p_ordering_enabled boolean,p_ordering_pause_message text,p_notification_preferences jsonb,p_feature_flags jsonb,p_reason text,p_expected_updated_at timestamptz default null,p_theme_settings jsonb default null) returns jsonb language plpgsql security definer set search_path to '' as $function$
declare actor_id uuid:=(select auth.uid()); current_row public.platform_configuration%rowtype; previous_value jsonb; next_notifications jsonb; next_flags jsonb; next_theme jsonb; next_value jsonb; clean_reason text:=nullif(trim(coalesce(p_reason,'')),''); refund_threshold integer; theme_style text; theme_key text; theme_value text;
begin
 if not private.has_platform_admin_permission('settings:manage') then raise exception 'You do not have permission to change platform configuration' using errcode='42501'; end if;
 if clean_reason is null or length(clean_reason) not between 5 and 500 then raise exception 'Enter a reason between 5 and 500 characters' using errcode='22023'; end if;
 if p_maintenance_mode is null or p_ordering_enabled is null then raise exception 'Operational switches must have a value' using errcode='22023'; end if;
 if length(trim(coalesce(p_maintenance_title,''))) not between 3 and 120 or length(trim(coalesce(p_maintenance_message,''))) not between 10 and 500 or length(trim(coalesce(p_ordering_pause_message,''))) not between 10 and 500 then raise exception 'Provide valid customer-facing status messages' using errcode='22023'; end if;
 if jsonb_typeof(coalesce(p_notification_preferences,'{}'::jsonb))<>'object' or jsonb_typeof(coalesce(p_feature_flags,'{}'::jsonb))<>'object' or (p_theme_settings is not null and jsonb_typeof(p_theme_settings)<>'object') then raise exception 'Settings payloads must be objects' using errcode='22023'; end if;
 select * into current_row from public.platform_configuration where singleton for update;
 if p_expected_updated_at is not null and current_row.updated_at<>p_expected_updated_at then raise exception 'Platform configuration changed since you opened it. Refresh before saving.' using errcode='40001'; end if;
 begin refund_threshold:=coalesce((p_notification_preferences->>'high_value_refund_threshold_pence')::integer,(current_row.notification_preferences->>'high_value_refund_threshold_pence')::integer,10000); exception when invalid_text_representation then raise exception 'High-value refund threshold must be a whole number of pence' using errcode='22023'; end;
 if refund_threshold<0 or refund_threshold>10000000 then raise exception 'High-value refund threshold must be between £0 and £100,000' using errcode='22023'; end if;
 next_notifications:=jsonb_build_object('new_restaurant_applications',coalesce((p_notification_preferences->>'new_restaurant_applications')::boolean,false),'failed_payments',coalesce((p_notification_preferences->>'failed_payments')::boolean,false),'high_value_refunds',coalesce((p_notification_preferences->>'high_value_refunds')::boolean,false),'restaurants_going_offline',coalesce((p_notification_preferences->>'restaurants_going_offline')::boolean,false),'high_value_refund_threshold_pence',refund_threshold);
 next_flags:=jsonb_build_object('scheduled_orders',coalesce((p_feature_flags->>'scheduled_orders')::boolean,false),'customer_favourites',coalesce((p_feature_flags->>'customer_favourites')::boolean,false),'restaurant_quick_availability',coalesce((p_feature_flags->>'restaurant_quick_availability')::boolean,false));
 next_theme:=coalesce(p_theme_settings,current_row.theme_settings,'{}'::jsonb); theme_style:=coalesce(next_theme->>'style','sharp'); if theme_style not in ('soft','sharp') then raise exception 'Theme style must be soft or sharp' using errcode='22023'; end if;
 foreach theme_key in array array['primary','secondary','header','surface','background','text'] loop theme_value:=next_theme->>theme_key; if theme_value is null or theme_value !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Theme colour % must be a six-digit hex colour',theme_key using errcode='22023'; end if; end loop;
 next_theme:=jsonb_build_object('primary',upper(next_theme->>'primary'),'secondary',upper(next_theme->>'secondary'),'header',upper(next_theme->>'header'),'surface',upper(next_theme->>'surface'),'background',upper(next_theme->>'background'),'text',upper(next_theme->>'text'),'style',theme_style);
 previous_value:=jsonb_build_object('maintenance_mode',current_row.maintenance_mode,'maintenance_title',current_row.maintenance_title,'maintenance_message',current_row.maintenance_message,'ordering_enabled',current_row.ordering_enabled,'ordering_pause_message',current_row.ordering_pause_message,'notification_preferences',current_row.notification_preferences,'feature_flags',current_row.feature_flags,'theme_settings',current_row.theme_settings);
 next_value:=jsonb_build_object('maintenance_mode',p_maintenance_mode,'maintenance_title',trim(p_maintenance_title),'maintenance_message',trim(p_maintenance_message),'ordering_enabled',p_ordering_enabled,'ordering_pause_message',trim(p_ordering_pause_message),'notification_preferences',next_notifications,'feature_flags',next_flags,'theme_settings',next_theme);
 if previous_value=next_value then raise exception 'No configuration changes were provided' using errcode='22023'; end if;
 update public.platform_configuration set maintenance_mode=p_maintenance_mode,maintenance_title=trim(p_maintenance_title),maintenance_message=trim(p_maintenance_message),ordering_enabled=p_ordering_enabled,ordering_pause_message=trim(p_ordering_pause_message),notification_preferences=next_notifications,feature_flags=next_flags,theme_settings=next_theme,updated_by=actor_id,updated_at=now() where singleton returning updated_at into current_row.updated_at;
 insert into public.platform_configuration_history(actor_user_id,reason,previous_configuration,next_configuration) values(actor_id,clean_reason,previous_value,next_value);
 insert into public.platform_admin_audit_log(actor_user_id,action,target_type,target_id,details) values(actor_id,'platform_configuration_updated','platform_configuration',null,jsonb_build_object('reason',clean_reason,'before',previous_value,'after',next_value));
 return next_value||jsonb_build_object('updated_at',current_row.updated_at);
end;$function$;

grant execute on function public.update_platform_configuration(boolean,text,text,boolean,text,jsonb,jsonb,text,timestamptz,jsonb) to authenticated;