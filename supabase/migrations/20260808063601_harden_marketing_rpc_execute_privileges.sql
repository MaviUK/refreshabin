-- Phase 5.8 RPCs must not inherit PostgreSQL's default PUBLIC EXECUTE privilege.
-- Client RPCs remain callable only by the roles that actually use them; queue internals are service-role only.

-- Customer-facing preference RPCs.
revoke all on function public.get_customer_marketing_preferences() from public, anon, authenticated;
grant execute on function public.get_customer_marketing_preferences() to authenticated, service_role;
revoke all on function public.update_customer_marketing_preferences(uuid,boolean,boolean,boolean,boolean,boolean,boolean) from public, anon, authenticated;
grant execute on function public.update_customer_marketing_preferences(uuid,boolean,boolean,boolean,boolean,boolean,boolean) to authenticated, service_role;

-- Restaurant CRM and marketing workspace RPCs. Each function also enforces tenant membership internally.
revoke all on function public.add_restaurant_customer_note(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.add_restaurant_customer_note(uuid,uuid,text) to authenticated, service_role;
revoke all on function public.delete_restaurant_customer_note(uuid) from public, anon, authenticated;
grant execute on function public.delete_restaurant_customer_note(uuid) to authenticated, service_role;
revoke all on function public.upsert_restaurant_crm_segment(uuid,uuid,text,text,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.upsert_restaurant_crm_segment(uuid,uuid,text,text,jsonb,boolean) to authenticated, service_role;
revoke all on function public.get_restaurant_customer_crm_metrics(uuid,uuid) from public, anon, authenticated;
grant execute on function public.get_restaurant_customer_crm_metrics(uuid,uuid) to authenticated, service_role;
revoke all on function public.get_restaurant_crm_customers(uuid,text,uuid,text,integer,integer) from public, anon, authenticated;
grant execute on function public.get_restaurant_crm_customers(uuid,text,uuid,text,integer,integer) to authenticated, service_role;
revoke all on function public.get_restaurant_crm_segments(uuid) from public, anon, authenticated;
grant execute on function public.get_restaurant_crm_segments(uuid) to authenticated, service_role;
revoke all on function public.get_restaurant_customer_timeline(uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.get_restaurant_customer_timeline(uuid,uuid,integer) to authenticated, service_role;
revoke all on function public.get_restaurant_crm_customer_profile(uuid,uuid) from public, anon, authenticated;
grant execute on function public.get_restaurant_crm_customer_profile(uuid,uuid) to authenticated, service_role;
revoke all on function public.get_restaurant_marketing_workspace() from public, anon, authenticated;
grant execute on function public.get_restaurant_marketing_workspace() to authenticated, service_role;
revoke all on function public.update_restaurant_marketing_settings(jsonb) from public, anon, authenticated;
grant execute on function public.update_restaurant_marketing_settings(jsonb) to authenticated, service_role;
revoke all on function public.save_restaurant_marketing_template(jsonb) from public, anon, authenticated;
grant execute on function public.save_restaurant_marketing_template(jsonb) to authenticated, service_role;
revoke all on function public.save_restaurant_marketing_campaign(jsonb) from public, anon, authenticated;
grant execute on function public.save_restaurant_marketing_campaign(jsonb) to authenticated, service_role;
revoke all on function public.set_restaurant_marketing_campaign_status(uuid,text) from public, anon, authenticated;
grant execute on function public.set_restaurant_marketing_campaign_status(uuid,text) to authenticated, service_role;
revoke all on function public.save_restaurant_marketing_automation(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.save_restaurant_marketing_automation(jsonb,jsonb) to authenticated, service_role;
revoke all on function public.get_restaurant_marketing_reports(integer) from public, anon, authenticated;
grant execute on function public.get_restaurant_marketing_reports(integer) to authenticated, service_role;

-- Platform-admin analytics is authenticated, then permission-scoped inside the function.
revoke all on function public.get_platform_marketing_analytics(integer) from public, anon, authenticated;
grant execute on function public.get_platform_marketing_analytics(integer) to authenticated, service_role;

-- Unsubscribe must intentionally remain available without login for one-click links in marketing email.
revoke all on function public.unsubscribe_marketing_by_token(text) from public, anon, authenticated;
grant execute on function public.unsubscribe_marketing_by_token(text) to anon, authenticated, service_role;

-- Scheduler/delivery engine internals are callable only by the service role.
revoke all on function public.marketing_channel_allowed(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.marketing_channel_allowed(uuid,uuid,text,text) to service_role;
revoke all on function public.marketing_customer_filter_metrics(uuid,uuid) from public, anon, authenticated;
grant execute on function public.marketing_customer_filter_metrics(uuid,uuid) to service_role;
revoke all on function public.marketing_segment_audience(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.marketing_segment_audience(uuid,text,uuid) to service_role;
revoke all on function public.marketing_next_allowed_at(uuid,timestamp with time zone) from public, anon, authenticated;
grant execute on function public.marketing_next_allowed_at(uuid,timestamp with time zone) to service_role;
revoke all on function public.marketing_enqueue_campaign(uuid,timestamp with time zone) from public, anon, authenticated;
grant execute on function public.marketing_enqueue_campaign(uuid,timestamp with time zone) to service_role;
revoke all on function public.marketing_process_due_campaigns(integer) from public, anon, authenticated;
grant execute on function public.marketing_process_due_campaigns(integer) to service_role;
revoke all on function public.marketing_process_automation_triggers(integer) from public, anon, authenticated;
grant execute on function public.marketing_process_automation_triggers(integer) to service_role;
revoke all on function public.marketing_process_automation_steps(integer) from public, anon, authenticated;
grant execute on function public.marketing_process_automation_steps(integer) to service_role;
revoke all on function public.marketing_claim_deliveries(integer) from public, anon, authenticated;
grant execute on function public.marketing_claim_deliveries(integer) to service_role;
revoke all on function public.marketing_complete_delivery(uuid,text,text) from public, anon, authenticated;
grant execute on function public.marketing_complete_delivery(uuid,text,text) to service_role;
revoke all on function public.marketing_fail_delivery(uuid,text) from public, anon, authenticated;
grant execute on function public.marketing_fail_delivery(uuid,text) to service_role;
revoke all on function public.marketing_record_resend_event(text,text,text,timestamp with time zone,jsonb) from public, anon, authenticated;
grant execute on function public.marketing_record_resend_event(text,text,text,timestamp with time zone,jsonb) to service_role;
revoke all on function public.marketing_register_unsubscribe_token(uuid,text) from public, anon, authenticated;
grant execute on function public.marketing_register_unsubscribe_token(uuid,text) to service_role;
revoke all on function public.marketing_service_or_tenant_access(uuid) from public, anon, authenticated;
grant execute on function public.marketing_service_or_tenant_access(uuid) to service_role;

-- Internal helpers / trigger functions are not direct API endpoints.
revoke all on function public.marketing_member_restaurant_id() from public, anon, authenticated;
revoke all on function public.marketing_segment_filter_matches(jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.marketing_timezone_is_valid(text) from public, anon, authenticated;
revoke all on function public.attribute_marketing_order_conversion() from public, anon, authenticated;
revoke all on function public.validate_marketing_tenant_references() from public, anon, authenticated;
