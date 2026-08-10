begin;

create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_-]+$'),
  name text not null,
  description text not null default '',
  monthly_price_pence integer not null check (monthly_price_pence >= 0),
  annual_price_pence integer check (annual_price_pence is null or annual_price_pence >= 0),
  stripe_monthly_price_id text,
  stripe_annual_price_id text,
  trial_days integer not null default 14 check (trial_days between 0 and 90),
  features jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.subscription_plans (code,name,description,monthly_price_pence,annual_price_pence,trial_days,features,sort_order)
values
  ('starter','Starter','Essential online ordering for independent restaurants',2900,29000,14,'{"locations":1,"staff_users":3,"advanced_reporting":false,"marketing":false,"priority_support":false}'::jsonb,10),
  ('growth','Growth','Advanced tools for growing restaurants',5900,59000,14,'{"locations":3,"staff_users":10,"advanced_reporting":true,"marketing":true,"priority_support":false}'::jsonb,20),
  ('pro','Pro','Full platform access for high-volume operators',9900,99000,14,'{"locations":10,"staff_users":50,"advanced_reporting":true,"marketing":true,"priority_support":true}'::jsonb,30)
on conflict (code) do nothing;

create table public.restaurant_subscriptions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null unique references public.restaurants(id) on delete cascade,
  plan_id uuid references public.subscription_plans(id) on delete restrict,
  status text not null default 'trialing' check (status in ('incomplete','trialing','active','past_due','paused','cancelled','unpaid')),
  billing_interval text not null default 'monthly' check (billing_interval in ('monthly','annual')),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_latest_invoice_id text,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_at timestamptz,
  grace_period_ends_at timestamptz,
  last_payment_failed_at timestamptz,
  last_payment_succeeded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index restaurant_subscriptions_status_idx on public.restaurant_subscriptions (status,current_period_end);

create table public.restaurant_subscription_events (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  subscription_id uuid references public.restaurant_subscriptions(id) on delete set null,
  event_type text not null,
  stripe_event_id text unique,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.subscription_plans enable row level security;
alter table public.restaurant_subscriptions enable row level security;
alter table public.restaurant_subscription_events enable row level security;
revoke all on public.subscription_plans,public.restaurant_subscriptions,public.restaurant_subscription_events from public,anon,authenticated;

grant select on public.subscription_plans to authenticated;

create policy subscription_plans_read on public.subscription_plans for select to authenticated using (is_active = true);

create or replace function public.get_restaurant_subscription_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  restaurant_id uuid;
  result jsonb;
begin
  select rm.restaurant_id into restaurant_id
  from public.restaurant_members rm
  where rm.user_id = auth.uid()
  order by rm.created_at
  limit 1;

  if restaurant_id is null then
    raise exception 'Restaurant membership not found' using errcode='42501';
  end if;

  select jsonb_build_object(
    'restaurant_id', restaurant_id,
    'subscription', case when s.id is null then null else jsonb_build_object(
      'id',s.id,'status',s.status,'billing_interval',s.billing_interval,
      'trial_ends_at',s.trial_ends_at,'current_period_start',s.current_period_start,
      'current_period_end',s.current_period_end,'cancel_at_period_end',s.cancel_at_period_end,
      'grace_period_ends_at',s.grace_period_ends_at,'last_payment_failed_at',s.last_payment_failed_at,
      'plan',jsonb_build_object('id',p.id,'code',p.code,'name',p.name,'monthly_price_pence',p.monthly_price_pence,'annual_price_pence',p.annual_price_pence,'features',p.features)
    ) end,
    'plans',coalesce((select jsonb_agg(jsonb_build_object('id',sp.id,'code',sp.code,'name',sp.name,'description',sp.description,'monthly_price_pence',sp.monthly_price_pence,'annual_price_pence',sp.annual_price_pence,'trial_days',sp.trial_days,'features',sp.features) order by sp.sort_order,sp.monthly_price_pence) from public.subscription_plans sp where sp.is_active),'[]'::jsonb),
    'access',jsonb_build_object(
      'allowed',coalesce(s.status in ('trialing','active') or (s.status='past_due' and s.grace_period_ends_at>now()),false),
      'reason',case when s.id is null then 'subscription_required' when s.status='past_due' and s.grace_period_ends_at<=now() then 'payment_overdue' else s.status end
    )
  ) into result
  from (select restaurant_id) r
  left join public.restaurant_subscriptions s on s.restaurant_id=r.restaurant_id
  left join public.subscription_plans p on p.id=s.plan_id;

  return result;
end;
$function$;

create or replace function public.restaurant_has_subscription_feature(p_feature text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare allowed boolean;
begin
  select coalesce((p.features->>p_feature)::boolean,false)
  into allowed
  from public.restaurant_members rm
  join public.restaurant_subscriptions s on s.restaurant_id=rm.restaurant_id
  join public.subscription_plans p on p.id=s.plan_id
  where rm.user_id=auth.uid()
    and (s.status in ('trialing','active') or (s.status='past_due' and s.grace_period_ends_at>now()))
  order by rm.created_at
  limit 1;
  return coalesce(allowed,false);
end;
$function$;

revoke all on function public.get_restaurant_subscription_status(),public.restaurant_has_subscription_feature(text) from public,anon,authenticated;
grant execute on function public.get_restaurant_subscription_status(),public.restaurant_has_subscription_feature(text) to authenticated;

commit;
