-- Phase 5.7 security hardening: privileged challenge internals must never be callable
-- directly by anonymous or ordinary authenticated API clients.

revoke all on function private.announce_new_challenge() from public, anon, authenticated;
revoke all on function private.challenge_audience_matches(public.restaurant_challenges, uuid) from public, anon, authenticated;
revoke all on function private.challenge_cycle_key(public.restaurant_challenges, timestamptz) from public, anon, authenticated;
revoke all on function private.challenge_identity_allowed(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.challenge_metric_value(public.restaurant_challenge_conditions, public.restaurant_challenges, uuid, uuid) from public, anon, authenticated;
revoke all on function private.challenge_restaurant_id(boolean) from public, anon, authenticated;
revoke all on function private.evaluate_customer_challenge(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.issue_challenge_reward(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.process_completed_order_challenges() from public, anon, authenticated;
revoke all on function private.process_loyalty_challenges() from public, anon, authenticated;
revoke all on function private.process_referral_challenges() from public, anon, authenticated;
revoke all on function private.process_stamp_challenges() from public, anon, authenticated;
revoke all on function private.process_vip_challenges() from public, anon, authenticated;
revoke all on function private.queue_challenge_notification(uuid, uuid, uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function private.evaluate_customer_achievements(uuid, uuid, uuid) from public, anon, authenticated;

-- Customer-facing RPCs require an authenticated customer and perform their own auth.uid checks.
revoke all on function public.get_customer_challenges() from public, anon;
grant execute on function public.get_customer_challenges() to authenticated;
revoke all on function public.get_customer_challenge_leaderboards() from public, anon;
grant execute on function public.get_customer_challenge_leaderboards() to authenticated;
revoke all on function public.save_customer_gamification_preferences(uuid, text, text) from public, anon;
grant execute on function public.save_customer_gamification_preferences(uuid, text, text) to authenticated;

-- Restaurant/admin RPCs are authenticated entry points; their bodies enforce membership/admin roles.
revoke all on function public.save_restaurant_challenge(uuid,text,text,text,text,text,timestamptz,timestamptz,boolean,integer,text,text,jsonb,text,boolean,text,integer,jsonb,jsonb) from public, anon;
grant execute on function public.save_restaurant_challenge(uuid,text,text,text,text,text,timestamptz,timestamptz,boolean,integer,text,text,jsonb,text,boolean,text,integer,jsonb,jsonb) to authenticated;
revoke all on function public.clone_restaurant_challenge(uuid,text) from public, anon;
grant execute on function public.clone_restaurant_challenge(uuid,text) to authenticated;
revoke all on function public.delete_restaurant_challenge(uuid) from public, anon;
grant execute on function public.delete_restaurant_challenge(uuid) to authenticated;
revoke all on function public.save_restaurant_achievement(uuid,text,text,text,text,text,bigint,jsonb,boolean) from public, anon;
grant execute on function public.save_restaurant_achievement(uuid,text,text,text,text,text,bigint,jsonb,boolean) to authenticated;
revoke all on function public.save_restaurant_leaderboard_settings(boolean,text,integer) from public, anon;
grant execute on function public.save_restaurant_leaderboard_settings(boolean,text,integer) to authenticated;
revoke all on function public.get_restaurant_challenge_dashboard() from public, anon;
grant execute on function public.get_restaurant_challenge_dashboard() to authenticated;
revoke all on function public.get_restaurant_challenge_leaderboard() from public, anon;
grant execute on function public.get_restaurant_challenge_leaderboard() to authenticated;
revoke all on function public.record_challenge_custom_metric(text,bigint,text,uuid) from public, anon;
grant execute on function public.record_challenge_custom_metric(text,bigint,text,uuid) to authenticated;
revoke all on function public.get_platform_challenge_dashboard() from public, anon;
grant execute on function public.get_platform_challenge_dashboard() to authenticated;
revoke all on function public.platform_set_challenge_disabled(uuid,boolean,text) from public, anon;
grant execute on function public.platform_set_challenge_disabled(uuid,boolean,text) to authenticated;
revoke all on function public.platform_review_challenge_fraud_flag(uuid,text,text) from public, anon;
grant execute on function public.platform_review_challenge_fraud_flag(uuid,text,text) to authenticated;

-- Scheduled notification processing is an internal service operation only.
revoke all on function public.process_challenge_notifications(timestamptz) from public, anon, authenticated;
grant execute on function public.process_challenge_notifications(timestamptz) to service_role;
