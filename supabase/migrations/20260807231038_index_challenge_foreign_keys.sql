create index if not exists challenge_fraud_flags_challenge_idx on public.challenge_fraud_flags(challenge_id) where challenge_id is not null;
create index if not exists challenge_fraud_flags_customer_idx on public.challenge_fraud_flags(customer_user_id) where customer_user_id is not null;
create index if not exists challenge_fraud_flags_order_idx on public.challenge_fraud_flags(order_id) where order_id is not null;
create index if not exists challenge_fraud_flags_progress_idx on public.challenge_fraud_flags(progress_id) where progress_id is not null;
create index if not exists challenge_fraud_flags_restaurant_idx on public.challenge_fraud_flags(restaurant_id);
create index if not exists challenge_fraud_flags_reviewer_idx on public.challenge_fraud_flags(reviewed_by) where reviewed_by is not null;

create index if not exists challenge_notification_queue_achievement_idx on public.challenge_notification_queue(achievement_id) where achievement_id is not null;
create index if not exists challenge_notification_queue_challenge_idx on public.challenge_notification_queue(challenge_id) where challenge_id is not null;
create index if not exists challenge_notification_queue_customer_idx on public.challenge_notification_queue(customer_user_id);
create index if not exists challenge_notification_queue_progress_idx on public.challenge_notification_queue(progress_id) where progress_id is not null;
create index if not exists challenge_notification_queue_restaurant_idx on public.challenge_notification_queue(restaurant_id);

create index if not exists challenge_progress_events_challenge_idx on public.challenge_progress_events(challenge_id);
create index if not exists challenge_progress_events_restaurant_idx on public.challenge_progress_events(restaurant_id);

create index if not exists achievement_unlock_restaurant_idx on public.customer_achievement_unlocks(restaurant_id);
create index if not exists achievement_unlock_source_order_idx on public.customer_achievement_unlocks(source_order_id) where source_order_id is not null;

create index if not exists challenge_custom_metrics_customer_idx on public.customer_challenge_custom_metrics(customer_user_id);
create index if not exists challenge_progress_completion_order_idx on public.customer_challenge_progress(completion_order_id) where completion_order_id is not null;
create index if not exists gamification_preferences_customer_idx on public.customer_gamification_preferences(customer_user_id);

create index if not exists restaurant_achievements_created_by_idx on public.restaurant_achievements(created_by) where created_by is not null;
create index if not exists challenge_conditions_category_idx on public.restaurant_challenge_conditions(category_id) where category_id is not null;
create index if not exists challenge_conditions_menu_item_idx on public.restaurant_challenge_conditions(menu_item_id) where menu_item_id is not null;
create index if not exists challenge_conditions_restaurant_idx on public.restaurant_challenge_conditions(restaurant_id);
create index if not exists challenge_rewards_menu_item_idx on public.restaurant_challenge_rewards(menu_item_id) where menu_item_id is not null;
create index if not exists challenge_rewards_restaurant_idx on public.restaurant_challenge_rewards(restaurant_id);
create index if not exists challenge_rewards_catalogue_idx on public.restaurant_challenge_rewards(reward_catalogue_id) where reward_catalogue_id is not null;
create index if not exists challenge_rewards_stamp_program_idx on public.restaurant_challenge_rewards(stamp_program_id) where stamp_program_id is not null;
create index if not exists restaurant_challenges_created_by_idx on public.restaurant_challenges(created_by) where created_by is not null;
create index if not exists restaurant_leaderboard_settings_updated_by_idx on public.restaurant_leaderboard_settings(updated_by) where updated_by is not null;
