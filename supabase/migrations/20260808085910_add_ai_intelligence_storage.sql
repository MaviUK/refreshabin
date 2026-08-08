create table public.restaurant_ai_runs(
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references public.restaurants(id) on delete cascade,
  run_type text not null check(run_type in('refresh','daily','weekly','monthly')),
  provider text not null default 'internal',
  model text not null default 'ordered-intelligence-v1',
  methodology_version text not null default '5.9.1',
  input_window_days int not null default 90,
  status text not null default 'running' check(status in('running','completed','failed')),
  trace jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.restaurant_ai_customer_scores(
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  lifetime_value_pence bigint not null default 0,
  predicted_future_value_pence bigint not null default 0,
  churn_risk numeric(5,2) not null default 0 check(churn_risk between 0 and 100),
  engagement_score numeric(5,2) not null default 0 check(engagement_score between 0 and 100),
  loyalty_score numeric(5,2) not null default 0 check(loyalty_score between 0 and 100),
  vip_potential numeric(5,2) not null default 0 check(vip_potential between 0 and 100),
  referral_potential numeric(5,2) not null default 0 check(referral_potential between 0 and 100),
  campaign_responsiveness numeric(5,2) not null default 0 check(campaign_responsiveness between 0 and 100),
  return_probability numeric(5,2) not null default 0 check(return_probability between 0 and 100),
  evidence jsonb not null default '{}'::jsonb,
  methodology_version text not null default '5.9.1',
  computed_at timestamptz not null default now(),
  primary key(restaurant_id,customer_user_id)
);

create table public.restaurant_ai_forecasts(
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  metric text not null check(metric in('revenue_pence','customer_growth_count','repeat_customer_percent','campaign_revenue_pence','delivery_orders_count','collection_orders_count')),
  horizon text not null check(horizon in('weekly','monthly')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  predicted_value numeric not null,
  lower_bound numeric not null,
  upper_bound numeric not null,
  confidence numeric(5,4) not null check(confidence between 0 and 1),
  explanation text not null,
  evidence jsonb not null default '{}'::jsonb,
  run_id uuid references public.restaurant_ai_runs(id) on delete set null,
  generated_at timestamptz not null default now(),
  unique(restaurant_id,metric,horizon,period_start)
);

create table public.restaurant_ai_insights(
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_user_id uuid references auth.users(id) on delete cascade,
  category text not null check(category in('revenue','customer','marketing','menu','operations','growth','loyalty','vip','referral','challenge','birthday','fraud','inventory')),
  insight_type text not null,
  severity text not null default 'info' check(severity in('info','opportunity','warning','critical')),
  title text not null,
  summary text not null,
  explanation text not null,
  confidence numeric(5,4) not null default .5 check(confidence between 0 and 1),
  evidence jsonb not null default '{}'::jsonb,
  suggested_action jsonb not null default '{}'::jsonb,
  fingerprint text not null,
  status text not null default 'active' check(status in('active','seen','dismissed','expired')),
  seen_at timestamptz,
  dismissed_at timestamptz,
  valid_until timestamptz,
  run_id uuid references public.restaurant_ai_runs(id) on delete set null,
  methodology_version text not null default '5.9.1',
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(restaurant_id,fingerprint)
);

create table public.restaurant_ai_reports(
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  report_type text not null check(report_type in('daily','weekly','monthly')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  restaurant_health_score numeric(5,2) not null check(restaurant_health_score between 0 and 100),
  growth_score numeric(5,2) not null check(growth_score between 0 and 100),
  customer_health_score numeric(5,2) not null check(customer_health_score between 0 and 100),
  marketing_score numeric(5,2) not null check(marketing_score between 0 and 100),
  operations_score numeric(5,2) not null check(operations_score between 0 and 100),
  summary text not null,
  sections jsonb not null default '{}'::jsonb,
  run_id uuid references public.restaurant_ai_runs(id) on delete set null,
  generated_at timestamptz not null default now(),
  unique(restaurant_id,report_type,period_start)
);

alter table public.restaurant_ai_runs enable row level security;
alter table public.restaurant_ai_customer_scores enable row level security;
alter table public.restaurant_ai_forecasts enable row level security;
alter table public.restaurant_ai_insights enable row level security;
alter table public.restaurant_ai_reports enable row level security;

revoke all on public.restaurant_ai_runs,public.restaurant_ai_customer_scores,public.restaurant_ai_forecasts,public.restaurant_ai_insights,public.restaurant_ai_reports from anon,authenticated;
grant select,insert,update,delete on public.restaurant_ai_runs,public.restaurant_ai_customer_scores,public.restaurant_ai_forecasts,public.restaurant_ai_insights,public.restaurant_ai_reports to service_role;

create index restaurant_ai_runs_restaurant_created_idx on public.restaurant_ai_runs(restaurant_id,created_at desc);
create index restaurant_ai_scores_churn_idx on public.restaurant_ai_customer_scores(restaurant_id,churn_risk desc,predicted_future_value_pence desc);
create index restaurant_ai_scores_value_idx on public.restaurant_ai_customer_scores(restaurant_id,lifetime_value_pence desc);
create index restaurant_ai_forecasts_lookup_idx on public.restaurant_ai_forecasts(restaurant_id,horizon,period_start desc);
create index restaurant_ai_insights_active_idx on public.restaurant_ai_insights(restaurant_id,status,severity,generated_at desc) where status in('active','seen');
create index restaurant_ai_reports_lookup_idx on public.restaurant_ai_reports(restaurant_id,report_type,period_start desc);
