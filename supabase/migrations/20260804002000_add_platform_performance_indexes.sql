begin;

-- Add indexes only when the relevant table and columns exist so this migration
-- remains safe across fresh installs and older development databases.
do $migration$
begin
  if to_regclass('public.orders') is not null then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='restaurant_id')
       and exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='created_at') then
      execute 'create index if not exists orders_restaurant_created_idx on public.orders (restaurant_id, created_at desc)';
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='order_status')
       and exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='created_at') then
      execute 'create index if not exists orders_status_created_idx on public.orders (order_status, created_at desc)';
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='payment_status')
       and exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='created_at') then
      execute 'create index if not exists orders_payment_status_created_idx on public.orders (payment_status, created_at desc)';
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='customer_user_id')
       and exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='created_at') then
      execute 'create index if not exists orders_customer_created_idx on public.orders (customer_user_id, created_at desc) where customer_user_id is not null';
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='customer_email')
       and exists (select 1 from information_schema.columns where table_schema='public' and table_name='orders' and column_name='created_at') then
      execute 'create index if not exists orders_customer_email_created_idx on public.orders (lower(customer_email), created_at desc) where customer_email is not null';
    end if;
  end if;

  if to_regclass('public.order_status_history') is not null
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='order_status_history' and column_name='order_id')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='order_status_history' and column_name='created_at') then
    execute 'create index if not exists order_status_history_order_created_idx on public.order_status_history (order_id, created_at desc)';
  end if;

  if to_regclass('public.print_jobs') is not null then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='print_jobs' and column_name='restaurant_id')
       and exists (select 1 from information_schema.columns where table_schema='public' and table_name='print_jobs' and column_name='created_at') then
      execute 'create index if not exists print_jobs_restaurant_created_idx on public.print_jobs (restaurant_id, created_at desc)';
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='print_jobs' and column_name='status')
       and exists (select 1 from information_schema.columns where table_schema='public' and table_name='print_jobs' and column_name='created_at') then
      execute 'create index if not exists print_jobs_status_created_idx on public.print_jobs (status, created_at desc)';
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='print_jobs' and column_name='order_id')
       and exists (select 1 from information_schema.columns where table_schema='public' and table_name='print_jobs' and column_name='created_at') then
      execute 'create index if not exists print_jobs_order_created_idx on public.print_jobs (order_id, created_at desc) where order_id is not null';
    end if;
  end if;

  if to_regclass('public.platform_support_cases') is not null then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='platform_support_cases' and column_name='status')
       and exists (select 1 from information_schema.columns where table_schema='public' and table_name='platform_support_cases' and column_name='updated_at') then
      execute 'create index if not exists platform_support_cases_status_updated_idx on public.platform_support_cases (status, updated_at desc)';
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='platform_support_cases' and column_name='assigned_to')
       and exists (select 1 from information_schema.columns where table_schema='public' and table_name='platform_support_cases' and column_name='updated_at') then
      execute 'create index if not exists platform_support_cases_assigned_updated_idx on public.platform_support_cases (assigned_to, updated_at desc) where assigned_to is not null';
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='platform_support_cases' and column_name='priority')
       and exists (select 1 from information_schema.columns where table_schema='public' and table_name='platform_support_cases' and column_name='resolution_due_at') then
      execute 'create index if not exists platform_support_cases_priority_resolution_idx on public.platform_support_cases (priority, resolution_due_at) where status not in (''resolved'',''closed'')';
    end if;
  end if;

  if to_regclass('public.platform_support_activities') is not null
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='platform_support_activities' and column_name='case_id')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='platform_support_activities' and column_name='created_at') then
    execute 'create index if not exists platform_support_activities_case_created_idx on public.platform_support_activities (case_id, created_at desc)';
  end if;

  if to_regclass('public.platform_payouts') is not null then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='platform_payouts' and column_name='restaurant_id')
       and exists (select 1 from information_schema.columns where table_schema='public' and table_name='platform_payouts' and column_name='created_at') then
      execute 'create index if not exists platform_payouts_restaurant_created_idx on public.platform_payouts (restaurant_id, created_at desc)';
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='platform_payouts' and column_name='status')
       and exists (select 1 from information_schema.columns where table_schema='public' and table_name='platform_payouts' and column_name='created_at') then
      execute 'create index if not exists platform_payouts_status_created_idx on public.platform_payouts (status, created_at desc)';
    end if;
  end if;

  if to_regclass('public.platform_risk_reviews') is not null
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='platform_risk_reviews' and column_name='status')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='platform_risk_reviews' and column_name='created_at') then
    execute 'create index if not exists platform_risk_reviews_status_created_idx on public.platform_risk_reviews (status, created_at desc)';
  end if;

  if to_regclass('public.platform_report_runs') is not null
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='platform_report_runs' and column_name='status')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='platform_report_runs' and column_name='created_at') then
    execute 'create index if not exists platform_report_runs_status_created_idx on public.platform_report_runs (status, created_at)';
  end if;

  if to_regclass('public.menu_imports') is not null
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='menu_imports' and column_name='restaurant_id')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='menu_imports' and column_name='created_at') then
    execute 'create index if not exists menu_imports_restaurant_created_idx on public.menu_imports (restaurant_id, created_at desc)';
  end if;
end
$migration$;

commit;
