create extension if not exists pgcrypto with schema extensions;

create table if not exists public.restaurant_referral_programs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null unique references public.restaurants(id) on delete cascade,
  is_enabled boolean not null default false,
  disabled_by_platform boolean not null default false,
  platform_disable_reason text,
  referrer_reward_type text not null default 'store_credit' check (referrer_reward_type in ('store_credit','loyalty_points','fixed_value_voucher','percentage_voucher','free_delivery')),
  referrer_reward_value integer not null default 500 check (referrer_reward_value >= 0),
  referee_reward_type text not null default 'store_credit' check (referee_reward_type in ('store_credit','loyalty_points','fixed_value_voucher','percentage_voucher','free_delivery')),
  referee_reward_value integer not null default 500 check (referee_reward_value >= 0),
  minimum_qualifying_order_pence integer not null default 0 check (minimum_qualifying_order_pence >= 0),
  qualifying_order_count integer not null default 1 check (qualifying_order_count between 1 and 20),
  reward_delay_hours integer not null default 0 check (reward_delay_hours between 0 and 2160),
  starts_at timestamptz,
  ends_at timestamptz,
  maximum_referrals_per_customer integer check (maximum_referrals_per_customer > 0),
  campaign_referral_cap integer check (campaign_referral_cap > 0),
  terms_text text,
  referrer_reward_catalogue_id uuid references public.restaurant_loyalty_rewards(id) on delete set null,
  referee_reward_catalogue_id uuid references public.restaurant_loyalty_rewards(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check ((referrer_reward_type = 'free_delivery' and referrer_reward_value = 0) or (referrer_reward_type <> 'free_delivery' and referrer_reward_value > 0)),
  check ((referee_reward_type = 'free_delivery' and referee_reward_value = 0) or (referee_reward_type <> 'free_delivery' and referee_reward_value > 0)),
  check (referrer_reward_type <> 'percentage_voucher' or referrer_reward_value between 1 and 10000),
  check (referee_reward_type <> 'percentage_voucher' or referee_reward_value between 1 and 10000)
);

create table if not exists public.customer_referral_codes (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.restaurant_referral_programs(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  code text not null unique,
  is_active boolean not null default true,
  share_count integer not null default 0 check (share_count >= 0),
  created_at timestamptz not null default now(),
  unique (program_id, customer_user_id)
);

alter table public.customer_referrals drop constraint if exists customer_referrals_restaurant_id_referral_code_key;
alter table public.customer_referrals drop constraint if exists customer_referrals_status_check;
update public.customer_referrals set status='invited' where status='pending';
update public.customer_referrals set status='rejected' where status='cancelled';
alter table public.customer_referrals
  add column if not exists program_id uuid references public.restaurant_referral_programs(id) on delete cascade,
  add column if not exists referral_code_id uuid references public.customer_referral_codes(id) on delete set null,
  add column if not exists invited_email_hash text,
  add column if not exists registered_at timestamptz,
  add column if not exists ordered_at timestamptz,
  add column if not exists qualifying_order_count integer not null default 0,
  add column if not exists qualifying_revenue_pence integer not null default 0,
  add column if not exists reward_available_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejection_reason text,
  add column if not exists updated_at timestamptz not null default now();
alter table public.customer_referrals add constraint customer_referrals_status_check check (status in ('invited','registered','ordered','qualified','rewarded','rejected'));
alter table public.customer_referrals add constraint customer_referrals_not_self_check check (referred_user_id is null or referred_user_id <> referrer_user_id);
create index if not exists customer_referrals_referrer_idx on public.customer_referrals (restaurant_id, referrer_user_id, created_at desc);
create index if not exists customer_referrals_referee_idx on public.customer_referrals (restaurant_id, referred_user_id) where referred_user_id is not null;
create index if not exists customer_referrals_program_status_idx on public.customer_referrals (program_id, status, created_at desc);

create table if not exists public.referral_attribution_tokens (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.restaurant_referral_programs(id) on delete cascade,
  referral_code_id uuid not null references public.customer_referral_codes(id) on delete cascade,
  referral_id uuid references public.customer_referrals(id) on delete set null,
  claimed_by_user_id uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now()
);
create index if not exists referral_attribution_tokens_expiry_idx on public.referral_attribution_tokens (expires_at) where claimed_at is null;

create table if not exists public.referral_events (
  id bigint generated always as identity primary key,
  referral_id uuid references public.customer_referrals(id) on delete set null,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  event_type text not null,
  old_status text,
  new_status text,
  order_id uuid references public.orders(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_kind text not null default 'system' check (actor_kind in ('system','customer','restaurant','platform_admin','service')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists referral_events_referral_idx on public.referral_events (referral_id, created_at desc);
create index if not exists referral_events_restaurant_idx on public.referral_events (restaurant_id, created_at desc);

create table if not exists public.referral_rewards (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.customer_referrals(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_role text not null check (recipient_role in ('referrer','referee')),
  reward_type text not null check (reward_type in ('store_credit','loyalty_points','fixed_value_voucher','percentage_voucher','free_delivery')),
  reward_value integer not null check (reward_value >= 0),
  status text not null default 'pending' check (status in ('pending','available','reversed','manual_review')),
  available_at timestamptz not null,
  issued_at timestamptz,
  reversed_at timestamptz,
  reversal_reason text,
  credit_ledger_id uuid references public.customer_credit_ledger(id) on delete set null,
  loyalty_ledger_id uuid references public.customer_loyalty_ledger(id) on delete set null,
  voucher_id uuid references public.customer_reward_vouchers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (referral_id, recipient_role)
);
create index if not exists referral_rewards_due_idx on public.referral_rewards (status, available_at) where status='pending';

alter table public.customer_credit_ledger add column if not exists referral_reward_id uuid references public.referral_rewards(id) on delete set null;
alter table public.customer_loyalty_ledger add column if not exists referral_reward_id uuid references public.referral_rewards(id) on delete set null;
alter table public.customer_reward_vouchers add column if not exists referral_reward_id uuid references public.referral_rewards(id) on delete set null;
create unique index if not exists customer_credit_ledger_referral_reward_idx on public.customer_credit_ledger (referral_reward_id) where referral_reward_id is not null;
create unique index if not exists customer_loyalty_ledger_referral_reward_idx on public.customer_loyalty_ledger (referral_reward_id) where referral_reward_id is not null;
create unique index if not exists customer_reward_vouchers_referral_reward_idx on public.customer_reward_vouchers (referral_reward_id) where referral_reward_id is not null;

do $$
declare r record;
begin
  for r in select conname from pg_constraint where conrelid='public.customer_reward_vouchers'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%points_spent > 0%' loop execute format('alter table public.customer_reward_vouchers drop constraint %I',r.conname); end loop;
  if not exists(select 1 from pg_constraint where conrelid='public.customer_reward_vouchers'::regclass and conname='customer_reward_vouchers_points_spent_nonnegative') then alter table public.customer_reward_vouchers add constraint customer_reward_vouchers_points_spent_nonnegative check(points_spent>=0); end if;
  for r in select conname from pg_constraint where conrelid='public.customer_reward_redemptions'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%points_spent > 0%' loop execute format('alter table public.customer_reward_redemptions drop constraint %I',r.conname); end loop;
  if not exists(select 1 from pg_constraint where conrelid='public.customer_reward_redemptions'::regclass and conname='customer_reward_redemptions_points_spent_nonnegative') then alter table public.customer_reward_redemptions add constraint customer_reward_redemptions_points_spent_nonnegative check(points_spent>=0); end if;
end $$;

create table if not exists public.referral_fraud_flags (
  id uuid primary key default gen_random_uuid(), referral_id uuid references public.customer_referrals(id) on delete set null, restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  flag_type text not null check (flag_type in ('self_referral','duplicate_referee','referral_velocity','shared_delivery_address','shared_contact_pattern','reward_reversal_failed','campaign_cap_attempt')),
  severity text not null default 'medium' check (severity in ('low','medium','high')), status text not null default 'open' check (status in ('open','reviewed','dismissed','confirmed')),
  details jsonb not null default '{}'::jsonb, reviewed_by uuid references auth.users(id) on delete set null, reviewed_at timestamptz, review_note text, created_at timestamptz not null default now()
);
create index if not exists referral_fraud_flags_open_idx on public.referral_fraud_flags (status, severity, created_at desc);
create index if not exists referral_fraud_flags_restaurant_idx on public.referral_fraud_flags (restaurant_id, created_at desc);

create table if not exists public.referral_notification_queue (
  id uuid primary key default gen_random_uuid(), referral_id uuid references public.customer_referrals(id) on delete cascade, referral_reward_id uuid references public.referral_rewards(id) on delete cascade,
  restaurant_id uuid references public.restaurants(id) on delete cascade, customer_user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('invitation_confirmed','friend_registered','friend_qualified','reward_earned','reward_available','referral_rejected')),
  subject text not null, body text not null, action_url text not null default '/account/referrals', status text not null default 'pending' check (status in ('pending','processing','sent','failed')),
  available_at timestamptz not null default now(), attempts integer not null default 0, last_error text, sent_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists referral_notification_queue_pending_idx on public.referral_notification_queue(status,available_at,created_at) where status in ('pending','failed');

alter table public.orders add column if not exists referral_id uuid references public.customer_referrals(id) on delete set null;
create index if not exists orders_referral_idx on public.orders (referral_id) where referral_id is not null;

alter table public.restaurant_referral_programs enable row level security;
alter table public.customer_referral_codes enable row level security;
alter table public.referral_attribution_tokens enable row level security;
alter table public.referral_events enable row level security;
alter table public.referral_rewards enable row level security;
alter table public.referral_fraud_flags enable row level security;
alter table public.referral_notification_queue enable row level security;
revoke all on public.restaurant_referral_programs, public.customer_referral_codes, public.referral_attribution_tokens, public.referral_events, public.referral_rewards, public.referral_fraud_flags, public.referral_notification_queue from public, anon, authenticated;

create or replace function private.block_referral_event_mutation() returns trigger language plpgsql set search_path='' as $$begin raise exception 'Referral events are immutable' using errcode='42501'; end$$;
drop trigger if exists referral_events_immutable on public.referral_events;
create trigger referral_events_immutable before update or delete on public.referral_events for each row execute function private.block_referral_event_mutation();

create or replace function private.referral_reward_label(p_type text,p_value integer) returns text language sql immutable set search_path='' as $$ select case p_type when 'store_credit' then '£'||to_char(p_value/100.0,'FM999999990.00')||' store credit' when 'loyalty_points' then p_value||' loyalty points' when 'fixed_value_voucher' then '£'||to_char(p_value/100.0,'FM999999990.00')||' voucher' when 'percentage_voucher' then trim(trailing '.0' from to_char(p_value/100.0,'FM999990.0'))||'% off voucher' when 'free_delivery' then 'free delivery voucher' else 'reward' end $$;

create or replace function private.queue_referral_notification(p_referral_id uuid,p_reward_id uuid,p_user_id uuid,p_restaurant_id uuid,p_event_type text,p_title text,p_body text) returns void language plpgsql security definer set search_path='' as $$ begin insert into public.customer_notifications(customer_user_id,restaurant_id,notification_type,title,body,action_url,metadata) values(p_user_id,p_restaurant_id,'referral_'||p_event_type,p_title,p_body,'/account/referrals',jsonb_build_object('referral_id',p_referral_id,'referral_reward_id',p_reward_id)) on conflict do nothing; insert into public.referral_notification_queue(referral_id,referral_reward_id,restaurant_id,customer_user_id,event_type,subject,body) values(p_referral_id,p_reward_id,p_restaurant_id,p_user_id,p_event_type,p_title,p_body); end$$;

create or replace function private.sync_referral_catalogue_reward(p_program_id uuid,p_role text,p_type text,p_value integer) returns uuid language plpgsql security definer set search_path='' as $$
declare p public.restaurant_referral_programs%rowtype; reward_id uuid; mapped text;
begin select * into p from public.restaurant_referral_programs where id=p_program_id for update; if p_type not in ('fixed_value_voucher','percentage_voucher','free_delivery') then return null; end if; mapped:=case p_type when 'fixed_value_voucher' then 'fixed_discount' when 'percentage_voucher' then 'percentage_discount' else 'free_delivery' end; reward_id:=case when p_role='referrer' then p.referrer_reward_catalogue_id else p.referee_reward_catalogue_id end; if reward_id is null then insert into public.restaurant_loyalty_rewards(restaurant_id,name,description,reward_type,points_cost,fixed_value_pence,percentage_basis_points,minimum_order_pence,is_active,created_by) values(p.restaurant_id,case when p_role='referrer' then 'Referral reward' else 'Friend referral reward' end,'Automatically issued by the referral programme.',mapped,1,case when mapped='fixed_discount' then p_value else null end,case when mapped='percentage_discount' then p_value else null end,0,false,auth.uid()) returning id into reward_id; else update public.restaurant_loyalty_rewards set reward_type=mapped,fixed_value_pence=case when mapped='fixed_discount' then p_value else null end,percentage_basis_points=case when mapped='percentage_discount' then p_value else null end,menu_item_id=null,is_active=false,updated_at=now() where id=reward_id and restaurant_id=p.restaurant_id; end if; return reward_id; end$$;
