begin;

do $block$
declare
  table_name text;
  sensitive_tables text[] := array[
    'platform_admins',
    'platform_admin_invites',
    'platform_admin_audit_log',
    'platform_configuration',
    'platform_configuration_history',
    'platform_fee_settings',
    'platform_fee_setting_history',
    'platform_content_reports',
    'platform_content_report_activity',
    'platform_customer_notes',
    'platform_restaurant_notes',
    'platform_order_actions',
    'platform_support_cases',
    'platform_support_activities',
    'platform_refunds',
    'platform_payouts',
    'platform_restaurant_payouts',
    'platform_risk_reviews',
    'platform_alert_rules',
    'platform_alerts',
    'platform_alert_events',
    'platform_report_schedules',
    'platform_report_runs',
    'edge_function_rate_limits',
    'stripe_webhook_events'
  ];
begin
  foreach table_name in array sensitive_tables loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('alter table public.%I enable row level security', table_name);
      execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    end if;
  end loop;
end
$block$;

comment on table public.platform_admin_audit_log is
  'Immutable platform administrator audit data. Direct client access is revoked; use permission-checked RPCs.';

commit;
