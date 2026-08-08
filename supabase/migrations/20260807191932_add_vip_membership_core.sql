create table public.restaurant_vip_programs (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  is_enabled boolean not null default false,
  qualification_window text not null default 'lifetime' check (qualification_window in ('lifetime','rolling')),
  rolling_days integer not null default 365 check (rolling_days between 30 and 3650),
  allow_downgrades boolean not null default false,
  disabled_by_platform boolean not null default false,
  platform_disable_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.restaurant_vip_tiers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  colour text not null default '#111827' check (colour ~ '^#[0-9A-Fa-f]{6}$'),
  icon text not null default 'star' check (char_length(icon) between 1 and 48),
  description text,
  priority integer not null check (priority between 0 and 1000000),
  qualification_match text not null default 'all' check (qualification_match in ('all','any')),
  is_active boolean not null default true,
  archived_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index restaurant_vip_tiers_priority_unique on public.restaurant_vip_tiers(restaurant_id,priority) where archived_at is null;
create index restaurant_vip_tiers_restaurant_active_idx on public.restaurant_vip_tiers(restaurant_id,is_active,priority desc) where archived_at is null;

create table public.restaurant_vip_tier_rules (
  id uuid primary key default gen_random_uuid(),
  tier_id uuid not null references public.restaurant_vip_tiers(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  metric_type text not null check (metric_type in ('lifetime_spend','orders_completed','loyalty_points','stamp_cards_completed','referral_count','custom_metric')),
  custom_metric_key text,
  threshold_value bigint not null check (threshold_value >= 0),
  created_at timestamptz not null default now(),
  check ((metric_type='custom_metric' and custom_metric_key is not null and custom_metric_key ~ '^[a-z0-9_]{1,64}$') or (metric_type<>'custom_metric' and custom_metric_key is null))
);
create index restaurant_vip_tier_rules_tier_idx on public.restaurant_vip_tier_rules(tier_id);

create table public.restaurant_vip_tier_benefits (
  id uuid primary key default gen_random_uuid(),
  tier_id uuid not null references public.restaurant_vip_tiers(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  benefit_type text not null check (benefit_type in ('bonus_loyalty_points','bonus_stamps','percentage_discount','fixed_discount','free_delivery','free_menu_item','birthday_bonus_multiplier','referral_multiplier','exclusive_reward','early_access_promotions','priority_customer_support')),
  value integer,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  reward_catalogue_id uuid references public.restaurant_loyalty_rewards(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (value is null or value >= 0),
  check (benefit_type <> 'percentage_discount' or (value between 1 and 10000)),
  check (benefit_type not in ('birthday_bonus_multiplier','referral_multiplier') or (value between 10000 and 100000)),
  check (benefit_type <> 'free_menu_item' or menu_item_id is not null),
  check (benefit_type <> 'exclusive_reward' or reward_catalogue_id is not null)
);
create index restaurant_vip_tier_benefits_tier_idx on public.restaurant_vip_tier_benefits(tier_id,is_active);

create table public.customer_vip_memberships (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  current_tier_id uuid references public.restaurant_vip_tiers(id) on delete set null,
  metrics jsonb not null default '{}'::jsonb,
  membership_version integer not null default 0 check (membership_version >= 0),
  qualified_at timestamptz,
  evaluated_at timestamptz not null default now(),
  tier_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id,customer_user_id)
);
create index customer_vip_memberships_customer_idx on public.customer_vip_memberships(customer_user_id,updated_at desc);
create index customer_vip_memberships_tier_idx on public.customer_vip_memberships(restaurant_id,current_tier_id) where current_tier_id is not null;

create table public.customer_vip_tier_history (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.customer_vip_memberships(id) on delete cascade,
  membership_version integer not null check (membership_version > 0),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  from_tier_id uuid references public.restaurant_vip_tiers(id) on delete set null,
  to_tier_id uuid references public.restaurant_vip_tiers(id) on delete set null,
  change_type text not null check (change_type in ('initial','upgrade','downgrade','removed')),
  reason text not null,
  metrics_snapshot jsonb not null default '{}'::jsonb,
  actor_kind text not null default 'system' check (actor_kind in ('system','restaurant','platform')),
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (membership_id,membership_version)
);
create index customer_vip_tier_history_customer_idx on public.customer_vip_tier_history(customer_user_id,created_at desc);
create index customer_vip_tier_history_restaurant_idx on public.customer_vip_tier_history(restaurant_id,created_at desc);

create table public.customer_vip_custom_metrics (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  metric_key text not null check (metric_key ~ '^[a-z0-9_]{1,64}$'),
  metric_value bigint not null default 0 check (metric_value >= 0),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id,customer_user_id,metric_key)
);
create index customer_vip_custom_metrics_customer_idx on public.customer_vip_custom_metrics(restaurant_id,customer_user_id);

create table public.customer_vip_custom_metric_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  metric_key text not null,
  previous_value bigint not null,
  new_value bigint not null,
  note text,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index customer_vip_custom_metric_events_restaurant_idx on public.customer_vip_custom_metric_events(restaurant_id,created_at desc);

create table public.customer_vip_benefit_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  tier_id uuid references public.restaurant_vip_tiers(id) on delete set null,
  benefit_id uuid references public.restaurant_vip_tier_benefits(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  reward_issuance_id uuid references public.customer_reward_issuances(id) on delete set null,
  event_type text not null check (event_type in ('applied','earned','issued','reversed')),
  amount integer not null default 0,
  source_key text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (restaurant_id,customer_user_id,source_key)
);
create index customer_vip_benefit_events_order_idx on public.customer_vip_benefit_events(order_id) where order_id is not null;
create index customer_vip_benefit_events_customer_idx on public.customer_vip_benefit_events(customer_user_id,created_at desc);

create table public.vip_fraud_flags (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_user_id uuid references auth.users(id) on delete cascade,
  membership_id uuid references public.customer_vip_memberships(id) on delete set null,
  tier_history_id uuid references public.customer_vip_tier_history(id) on delete set null,
  flag_type text not null,
  severity text not null check (severity in ('low','medium','high','critical')),
  status text not null default 'open' check (status in ('open','reviewed','dismissed','actioned')),
  details jsonb not null default '{}'::jsonb,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index vip_fraud_flags_status_idx on public.vip_fraud_flags(status,severity,created_at desc);
create index vip_fraud_flags_restaurant_idx on public.vip_fraud_flags(restaurant_id,created_at desc);

alter table public.customer_notifications add column if not exists dedupe_key text;
create unique index if not exists customer_notifications_dedupe_unique on public.customer_notifications(customer_user_id,dedupe_key) where dedupe_key is not null;

alter table public.reward_notification_queue alter column reward_issuance_id drop not null;
alter table public.reward_notification_queue add column if not exists vip_tier_history_id uuid references public.customer_vip_tier_history(id) on delete cascade;
alter table public.reward_notification_queue add column if not exists dedupe_key text;
create unique index if not exists reward_notification_queue_dedupe_unique on public.reward_notification_queue(customer_user_id,dedupe_key) where dedupe_key is not null;
alter table public.reward_notification_queue drop constraint if exists reward_notification_queue_event_type_check;
alter table public.reward_notification_queue add constraint reward_notification_queue_event_type_check check (event_type in ('happy_birthday','birthday_reward_available','birthday_reward_expiring','milestone_reached','reward_earned','vip_tier_upgraded','vip_tier_downgraded','vip_reward_available','vip_birthday_bonus','vip_milestone'));

alter table public.customer_reward_issuances drop constraint if exists customer_reward_issuances_source_type_check;
alter table public.customer_reward_issuances add constraint customer_reward_issuances_source_type_check check (source_type in ('birthday','milestone','vip'));
alter table public.customer_loyalty_ledger drop constraint if exists customer_loyalty_ledger_entry_type_check;
alter table public.customer_loyalty_ledger add constraint customer_loyalty_ledger_entry_type_check check (entry_type in ('order_earned','reward_redeemed','manual_adjustment','refund_reversal','birthday_bonus','referral_bonus','milestone_bonus','vip_bonus'));
alter table public.customer_credit_ledger drop constraint if exists customer_credit_ledger_entry_type_check;
alter table public.customer_credit_ledger add constraint customer_credit_ledger_entry_type_check check (entry_type in ('gift_card','refund_credit','manual_credit','order_redemption','referral_credit','birthday_credit','milestone_credit','vip_credit'));
alter table public.customer_stamp_events drop constraint if exists customer_stamp_events_event_type_check;
alter table public.customer_stamp_events add constraint customer_stamp_events_event_type_check check (event_type in ('earned','manual_adjustment','reversal','completion','qr_claim','vip_bonus'));

alter table public.customer_reward_vouchers add column if not exists override_fixed_value_pence integer check (override_fixed_value_pence is null or override_fixed_value_pence >= 0);
alter table public.customer_reward_vouchers add column if not exists override_percentage_basis_points integer check (override_percentage_basis_points is null or override_percentage_basis_points between 1 and 10000);
alter table public.customer_reward_vouchers add column if not exists benefit_source_type text;
alter table public.customer_reward_vouchers add column if not exists benefit_source_id uuid;

alter table public.restaurant_vip_programs enable row level security;
alter table public.restaurant_vip_tiers enable row level security;
alter table public.restaurant_vip_tier_rules enable row level security;
alter table public.restaurant_vip_tier_benefits enable row level security;
alter table public.customer_vip_memberships enable row level security;
alter table public.customer_vip_tier_history enable row level security;
alter table public.customer_vip_custom_metrics enable row level security;
alter table public.customer_vip_custom_metric_events enable row level security;
alter table public.customer_vip_benefit_events enable row level security;
alter table public.vip_fraud_flags enable row level security;

revoke all on public.restaurant_vip_programs, public.restaurant_vip_tiers, public.restaurant_vip_tier_rules, public.restaurant_vip_tier_benefits, public.customer_vip_memberships, public.customer_vip_tier_history, public.customer_vip_custom_metrics, public.customer_vip_custom_metric_events, public.customer_vip_benefit_events, public.vip_fraud_flags from anon, authenticated;

grant select, insert, update, delete on public.restaurant_vip_programs, public.restaurant_vip_tiers, public.restaurant_vip_tier_rules, public.restaurant_vip_tier_benefits, public.customer_vip_memberships, public.customer_vip_tier_history, public.customer_vip_custom_metrics, public.customer_vip_custom_metric_events, public.customer_vip_benefit_events, public.vip_fraud_flags to service_role;

create or replace function private.vip_metric_value(p_metrics jsonb,p_metric_type text,p_custom_metric_key text default null)
returns bigint language sql immutable set search_path='' as $$
  select case p_metric_type
    when 'lifetime_spend' then coalesce((p_metrics->>'lifetime_spend_pence')::bigint,0)
    when 'orders_completed' then coalesce((p_metrics->>'orders_completed')::bigint,0)
    when 'loyalty_points' then coalesce((p_metrics->>'loyalty_points')::bigint,0)
    when 'stamp_cards_completed' then coalesce((p_metrics->>'stamp_cards_completed')::bigint,0)
    when 'referral_count' then coalesce((p_metrics->>'referral_count')::bigint,0)
    when 'custom_metric' then coalesce((p_metrics->'custom_metrics'->>p_custom_metric_key)::bigint,0)
    else 0 end;
$$;

create or replace function private.calculate_customer_vip_metrics(p_restaurant_id uuid,p_customer_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.restaurant_vip_programs%rowtype; cutoff timestamptz; spend bigint:=0; orders_count bigint:=0; points bigint:=0; stamps bigint:=0; referrals bigint:=0; custom jsonb:='{}'::jsonb;
begin
  select * into p from public.restaurant_vip_programs where restaurant_id=p_restaurant_id;
  if not found then return jsonb_build_object('lifetime_spend_pence',0,'orders_completed',0,'loyalty_points',0,'stamp_cards_completed',0,'referral_count',0,'custom_metrics','{}'::jsonb); end if;
  if p.qualification_window='rolling' then cutoff:=now()-make_interval(days=>p.rolling_days); end if;
  select count(*),coalesce(sum(o.total_pence+o.customer_credit_used_pence+o.gift_card_used_pence),0)
    into orders_count,spend from public.orders o
    where o.restaurant_id=p_restaurant_id and o.customer_user_id=p_customer_user_id and o.order_status='completed' and o.payment_status in ('paid','partially_refunded') and (cutoff is null or coalesce(o.completed_at,o.updated_at)>=cutoff);
  if cutoff is null then
    select coalesce(a.lifetime_points_earned,0) into points from public.customer_loyalty_accounts a where a.restaurant_id=p_restaurant_id and a.customer_user_id=p_customer_user_id;
    select coalesce(sum(c.completed_cycles),0) into stamps from public.customer_stamp_cards c where c.restaurant_id=p_restaurant_id and c.customer_user_id=p_customer_user_id;
  else
    select coalesce(sum(greatest(l.points_delta,0)),0) into points from public.customer_loyalty_ledger l where l.restaurant_id=p_restaurant_id and l.customer_user_id=p_customer_user_id and l.created_at>=cutoff;
    select count(*) into stamps from public.customer_stamp_events e where e.restaurant_id=p_restaurant_id and e.customer_user_id=p_customer_user_id and e.event_type='completion' and e.created_at>=cutoff;
  end if;
  select count(*) into referrals from public.customer_referrals r where r.restaurant_id=p_restaurant_id and r.referrer_user_id=p_customer_user_id and r.status in ('qualified','rewarded') and (cutoff is null or coalesce(r.qualified_at,r.updated_at)>=cutoff);
  select coalesce(jsonb_object_agg(m.metric_key,m.metric_value),'{}'::jsonb) into custom from public.customer_vip_custom_metrics m where m.restaurant_id=p_restaurant_id and m.customer_user_id=p_customer_user_id;
  return jsonb_build_object('lifetime_spend_pence',spend,'orders_completed',orders_count,'loyalty_points',points,'stamp_cards_completed',stamps,'referral_count',referrals,'custom_metrics',custom,'qualification_window',p.qualification_window,'rolling_days',case when p.qualification_window='rolling' then p.rolling_days else null end);
end $$;

create or replace function private.resolve_customer_vip_tier(p_restaurant_id uuid,p_metrics jsonb)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare p public.restaurant_vip_programs%rowtype; t public.restaurant_vip_tiers%rowtype; rule_count integer; matched_count integer;
begin
  select * into p from public.restaurant_vip_programs where restaurant_id=p_restaurant_id;
  if not found or not p.is_enabled or p.disabled_by_platform then return null; end if;
  for t in select * from public.restaurant_vip_tiers where restaurant_id=p_restaurant_id and archived_at is null and is_active order by priority desc,id loop
    select count(*),count(*) filter(where private.vip_metric_value(p_metrics,r.metric_type,r.custom_metric_key)>=r.threshold_value)
      into rule_count,matched_count from public.restaurant_vip_tier_rules r where r.tier_id=t.id;
    if rule_count=0 or (t.qualification_match='all' and matched_count=rule_count) or (t.qualification_match='any' and matched_count>0) then return t.id; end if;
  end loop;
  return null;
end $$;

create or replace function private.get_customer_vip_multiplier(p_restaurant_id uuid,p_customer_user_id uuid,p_benefit_type text)
returns integer language sql stable security definer set search_path='' as $$
  select coalesce(max(b.value),10000)
  from public.customer_vip_memberships m
  join public.restaurant_vip_programs p on p.restaurant_id=m.restaurant_id and p.is_enabled and not p.disabled_by_platform
  join public.restaurant_vip_tier_benefits b on b.tier_id=m.current_tier_id and b.is_active and b.benefit_type=p_benefit_type
  where m.restaurant_id=p_restaurant_id and m.customer_user_id=p_customer_user_id;
$$;

create or replace function private.queue_campaign_notification(p_issuance_id uuid,p_event_type text,p_title text,p_body text)
returns void language plpgsql security definer set search_path='' as $$
declare rw public.customer_reward_issuances%rowtype; action text; dedupe text;
begin
  select * into rw from public.customer_reward_issuances where id=p_issuance_id;
  if not found then return; end if;
  action:=case when rw.source_type='vip' then '/account/vip' else '/account/milestones' end;
  dedupe:='reward:'||rw.id::text||':'||p_event_type;
  insert into public.customer_notifications(customer_user_id,restaurant_id,notification_type,title,body,action_url,metadata,dedupe_key)
  values(rw.customer_user_id,rw.restaurant_id,p_event_type,p_title,p_body,action,jsonb_build_object('reward_issuance_id',rw.id,'source_type',rw.source_type,'source_id',rw.source_id),dedupe)
  on conflict do nothing;
  insert into public.reward_notification_queue(reward_issuance_id,restaurant_id,customer_user_id,event_type,subject,body,action_url,push_payload,dedupe_key)
  values(rw.id,rw.restaurant_id,rw.customer_user_id,p_event_type,p_title,p_body,action,jsonb_build_object('type',p_event_type,'reward_issuance_id',rw.id,'action_url',action),dedupe)
  on conflict do nothing;
end $$;

create or replace function private.issue_campaign_reward(p_issuance_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare rw public.customer_reward_issuances%rowtype; acct public.customer_credit_accounts%rowtype; lacct public.customer_loyalty_accounts%rowtype; ledger uuid; vid uuid; code text; title text; body text; duplicate_accounts integer:=0; dob_changed timestamptz; dob_set timestamptz; multiplier integer:=10000; base_value integer; reward_row public.restaurant_loyalty_rewards%rowtype;
begin
  select * into rw from public.customer_reward_issuances where id=p_issuance_id for update;
  if not found or rw.status<>'pending' then return; end if;
  if rw.source_type='birthday' then
    select p.date_of_birth_set_at,p.date_of_birth_last_changed_at into dob_set,dob_changed from public.customer_profiles p where p.user_id=rw.customer_user_id;
    if dob_set is not null and dob_set > now()-interval '14 days' then
      perform private.flag_campaign_fraud(rw.restaurant_id,rw.customer_user_id,rw.id,'birthday','recent_dob_set','high',jsonb_build_object('set_at',dob_set));
      update public.customer_reward_issuances set status='blocked',metadata=metadata||jsonb_build_object('blocked_reason','recent_dob_set'),updated_at=now() where id=rw.id; return;
    end if;
    if dob_changed is not null and dob_changed > now()-interval '30 days' then
      perform private.flag_campaign_fraud(rw.restaurant_id,rw.customer_user_id,rw.id,'birthday','recent_dob_change','high',jsonb_build_object('changed_at',dob_changed));
      update public.customer_reward_issuances set status='blocked',metadata=metadata||jsonb_build_object('blocked_reason','recent_dob_change'),updated_at=now() where id=rw.id; return;
    end if;
    select count(*) into duplicate_accounts from public.customer_profiles p join public.customer_profiles self on self.user_id=rw.customer_user_id where p.user_id<>self.user_id and p.date_of_birth=self.date_of_birth and self.phone is not null and p.phone is not null and regexp_replace(p.phone,'\D','','g')=regexp_replace(self.phone,'\D','','g');
    if duplicate_accounts>0 then
      perform private.flag_campaign_fraud(rw.restaurant_id,rw.customer_user_id,rw.id,'birthday','shared_phone_and_dob','high',jsonb_build_object('matching_accounts',duplicate_accounts));
      update public.customer_reward_issuances set status='blocked',metadata=metadata||jsonb_build_object('blocked_reason','shared_phone_and_dob','matching_accounts',duplicate_accounts),updated_at=now() where id=rw.id; return;
    end if;
    multiplier:=private.get_customer_vip_multiplier(rw.restaurant_id,rw.customer_user_id,'birthday_bonus_multiplier');
    if multiplier>10000 and coalesce((rw.metadata->>'vip_multiplier_applied')::boolean,false)=false and rw.reward_type not in ('free_item','free_delivery') then
      base_value:=rw.reward_value; rw.reward_value:=round(base_value*multiplier/10000.0);
      update public.customer_reward_issuances set reward_value=rw.reward_value,metadata=metadata||jsonb_build_object('vip_multiplier_applied',true,'vip_multiplier_basis_points',multiplier,'base_reward_value',base_value),updated_at=now() where id=rw.id;
    end if;
  end if;
  if rw.reward_type='wallet_credit' then
    insert into public.customer_credit_accounts(restaurant_id,customer_user_id,balance_pence) values(rw.restaurant_id,rw.customer_user_id,0) on conflict(restaurant_id,customer_user_id) do nothing;
    select * into acct from public.customer_credit_accounts where restaurant_id=rw.restaurant_id and customer_user_id=rw.customer_user_id for update;
    insert into public.customer_credit_ledger(credit_account_id,restaurant_id,customer_user_id,amount_pence,entry_type,note,reward_issuance_id)
    values(acct.id,rw.restaurant_id,rw.customer_user_id,rw.reward_value,case rw.source_type when 'birthday' then 'birthday_credit' when 'vip' then 'vip_credit' else 'milestone_credit' end,case rw.source_type when 'birthday' then 'Birthday reward' when 'vip' then 'VIP reward' else 'Milestone reward' end,rw.id)
    on conflict(reward_issuance_id) where reward_issuance_id is not null do nothing returning id into ledger;
    if ledger is not null then update public.customer_credit_accounts set balance_pence=balance_pence+rw.reward_value,updated_at=now() where id=acct.id; end if;
    update public.customer_reward_issuances set status='available',issued_at=coalesce(issued_at,now()),campaign_cost_pence=reward_value,metadata=metadata||jsonb_build_object('credit_ledger_id',ledger),updated_at=now() where id=rw.id;
  elsif rw.reward_type='loyalty_points' then
    insert into public.customer_loyalty_accounts(restaurant_id,customer_user_id,points_balance,lifetime_points_earned,lifetime_points_redeemed) values(rw.restaurant_id,rw.customer_user_id,0,0,0) on conflict(restaurant_id,customer_user_id) do nothing;
    select * into lacct from public.customer_loyalty_accounts where restaurant_id=rw.restaurant_id and customer_user_id=rw.customer_user_id for update;
    insert into public.customer_loyalty_ledger(loyalty_account_id,restaurant_id,customer_user_id,points_delta,entry_type,note,reward_issuance_id)
    values(lacct.id,rw.restaurant_id,rw.customer_user_id,rw.reward_value,case rw.source_type when 'birthday' then 'birthday_bonus' when 'vip' then 'vip_bonus' else 'milestone_bonus' end,case rw.source_type when 'birthday' then 'Birthday reward' when 'vip' then 'VIP reward' else 'Milestone reward' end,rw.id)
    on conflict(reward_issuance_id) where reward_issuance_id is not null do nothing returning id into ledger;
    if ledger is not null then update public.customer_loyalty_accounts set points_balance=points_balance+rw.reward_value,lifetime_points_earned=lifetime_points_earned+rw.reward_value,updated_at=now() where id=lacct.id; end if;
    update public.customer_reward_issuances set status='available',issued_at=coalesce(issued_at,now()),loyalty_ledger_id=coalesce(loyalty_ledger_id,ledger),updated_at=now() where id=rw.id;
  else
    if rw.reward_catalogue_id is null then raise exception 'Reward catalogue entry is missing'; end if;
    select * into reward_row from public.restaurant_loyalty_rewards where id=rw.reward_catalogue_id;
    loop code:=case rw.source_type when 'birthday' then 'BD-' when 'vip' then 'VIP-' else 'MS-' end||upper(substr(encode(extensions.gen_random_bytes(10),'hex'),1,14)); exit when not exists(select 1 from public.customer_reward_vouchers v where v.restaurant_id=rw.restaurant_id and v.code=code); end loop;
    insert into public.customer_reward_vouchers(reward_id,restaurant_id,customer_user_id,code,points_spent,expires_at,reward_issuance_id,override_fixed_value_pence,override_percentage_basis_points,benefit_source_type,benefit_source_id)
    values(rw.reward_catalogue_id,rw.restaurant_id,rw.customer_user_id,code,0,rw.expires_at,rw.id,
      case when rw.reward_type in ('fixed_discount','voucher') and rw.reward_value<>coalesce(reward_row.fixed_value_pence,0) then rw.reward_value else null end,
      case when rw.reward_type='percentage_discount' and rw.reward_value<>coalesce(reward_row.percentage_basis_points,0) then least(rw.reward_value,10000) else null end,
      rw.source_type,rw.source_id)
    on conflict(reward_issuance_id) where reward_issuance_id is not null do nothing returning id into vid;
    if vid is null then select id into vid from public.customer_reward_vouchers where reward_issuance_id=rw.id; end if;
    update public.customer_reward_issuances set status='available',issued_at=coalesce(issued_at,now()),voucher_id=vid,campaign_cost_pence=case when reward_type in('fixed_discount','voucher') then reward_value else campaign_cost_pence end,updated_at=now() where id=rw.id;
  end if;
  title:=case rw.source_type when 'birthday' then 'Birthday reward available' when 'vip' then 'VIP reward available' else 'Reward earned' end;
  body:=coalesce(rw.metadata->>'campaign_message',case rw.source_type when 'birthday' then 'Happy Birthday! Your reward is ready.' when 'vip' then 'A new VIP reward is ready in your account.' else 'You reached a new milestone. Your reward is ready!' end);
  perform private.queue_campaign_notification(rw.id,case rw.source_type when 'birthday' then 'birthday_reward_available' when 'vip' then 'vip_reward_available' else 'reward_earned' end,title,body);
end $$;

create or replace function private.issue_vip_exclusive_rewards(p_history_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare h public.customer_vip_tier_history%rowtype; b record; r public.restaurant_loyalty_rewards%rowtype; issuance_id uuid; issued integer:=0; reward_value integer;
begin
  select * into h from public.customer_vip_tier_history where id=p_history_id;
  if not found or h.to_tier_id is null or h.change_type not in ('initial','upgrade') then return 0; end if;
  for b in select * from public.restaurant_vip_tier_benefits where tier_id=h.to_tier_id and is_active and benefit_type='exclusive_reward' loop
    select * into r from public.restaurant_loyalty_rewards where id=b.reward_catalogue_id and restaurant_id=h.restaurant_id;
    if not found then continue; end if;
    reward_value:=case r.reward_type when 'fixed_discount' then coalesce(r.fixed_value_pence,0) when 'wallet_credit' then coalesce(r.fixed_value_pence,0) when 'percentage_discount' then coalesce(r.percentage_basis_points,0) else 0 end;
    insert into public.customer_reward_issuances(restaurant_id,customer_user_id,source_type,source_id,source_key,reward_type,reward_value,reward_catalogue_id,status,eligible_at,expires_at,metadata)
    values(h.restaurant_id,h.customer_user_id,'vip',b.id,'tier:'||h.to_tier_id::text,r.reward_type,reward_value,r.id,'pending',now(),coalesce(r.ends_at,now()+interval '90 days'),jsonb_build_object('tier_id',h.to_tier_id,'benefit_id',b.id,'campaign_message','Your VIP tier unlocked an exclusive reward.'))
    on conflict(restaurant_id,customer_user_id,source_type,source_id,source_key) do nothing returning id into issuance_id;
    if issuance_id is not null then
      perform private.issue_campaign_reward(issuance_id);
      insert into public.customer_vip_benefit_events(restaurant_id,customer_user_id,tier_id,benefit_id,reward_issuance_id,event_type,source_key,details)
      values(h.restaurant_id,h.customer_user_id,h.to_tier_id,b.id,issuance_id,'issued','tier:'||h.to_tier_id::text||':benefit:'||b.id::text,jsonb_build_object('history_id',h.id)) on conflict do nothing;
      issued:=issued+1;
    end if;
  end loop;
  return issued;
end $$;

create or replace function private.queue_vip_tier_notification(p_history_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare h public.customer_vip_tier_history%rowtype; tier_name text; restaurant_name text; title text; body text; event_type text; action text; dedupe text;
begin
  select * into h from public.customer_vip_tier_history where id=p_history_id;
  if not found then return; end if;
  select name into tier_name from public.restaurant_vip_tiers where id=h.to_tier_id;
  select name into restaurant_name from public.restaurants where id=h.restaurant_id;
  if h.change_type in ('initial','upgrade') then event_type:='vip_tier_upgraded'; title:='VIP tier unlocked: '||coalesce(tier_name,'VIP'); body:='Congratulations! You are now '||coalesce(tier_name,'a VIP member')||' at '||coalesce(restaurant_name,'this restaurant')||'. Your new benefits are ready.';
  else event_type:='vip_tier_downgraded'; title:='VIP tier updated'; body:='Your VIP status at '||coalesce(restaurant_name,'this restaurant')||' has changed'||case when tier_name is null then '.' else ' to '||tier_name||'.' end;
  end if;
  action:='/account/vip'||case when h.change_type in ('initial','upgrade') then '?celebrate='||h.id::text else '' end;
  dedupe:='vip-history:'||h.id::text||':tier-change';
  insert into public.customer_notifications(customer_user_id,restaurant_id,notification_type,title,body,action_url,metadata,dedupe_key)
  values(h.customer_user_id,h.restaurant_id,event_type,title,body,action,jsonb_build_object('vip_tier_history_id',h.id,'from_tier_id',h.from_tier_id,'to_tier_id',h.to_tier_id,'vip_milestone',h.change_type in ('initial','upgrade')),dedupe) on conflict do nothing;
  insert into public.reward_notification_queue(reward_issuance_id,restaurant_id,customer_user_id,event_type,subject,body,action_url,push_payload,vip_tier_history_id,dedupe_key)
  values(null,h.restaurant_id,h.customer_user_id,event_type,title,body,action,jsonb_build_object('type',event_type,'vip_tier_history_id',h.id,'action_url',action,'vip_milestone',h.change_type in ('initial','upgrade')),h.id,dedupe) on conflict do nothing;
end $$;

create or replace function private.evaluate_customer_vip_tier(p_restaurant_id uuid,p_customer_user_id uuid,p_reason text default 'automatic',p_actor_kind text default 'system',p_actor_user_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.restaurant_vip_programs%rowtype; m public.customer_vip_memberships%rowtype; metrics jsonb; candidate uuid; current_priority integer; candidate_priority integer; current_active boolean; next_tier uuid; change_kind text; history_id uuid; next_version integer; recent_changes integer;
begin
  select * into p from public.restaurant_vip_programs where restaurant_id=p_restaurant_id;
  if not found then return jsonb_build_object('changed',false,'tier_id',null); end if;
  metrics:=private.calculate_customer_vip_metrics(p_restaurant_id,p_customer_user_id);
  candidate:=private.resolve_customer_vip_tier(p_restaurant_id,metrics);
  insert into public.customer_vip_memberships(restaurant_id,customer_user_id,metrics,evaluated_at) values(p_restaurant_id,p_customer_user_id,metrics,now()) on conflict(restaurant_id,customer_user_id) do nothing;
  select * into m from public.customer_vip_memberships where restaurant_id=p_restaurant_id and customer_user_id=p_customer_user_id for update;
  if m.current_tier_id is not null then select priority,(archived_at is null and is_active) into current_priority,current_active from public.restaurant_vip_tiers where id=m.current_tier_id; end if;
  if candidate is not null then select priority into candidate_priority from public.restaurant_vip_tiers where id=candidate; end if;
  next_tier:=candidate;
  if m.current_tier_id is not null and candidate is distinct from m.current_tier_id and coalesce(candidate_priority,-1)<coalesce(current_priority,0) and coalesce(current_active,false) and not (p.qualification_window='rolling' and p.allow_downgrades) then next_tier:=m.current_tier_id; end if;
  if m.current_tier_id is not distinct from next_tier then
    update public.customer_vip_memberships set metrics=private.evaluate_customer_vip_tier.metrics,evaluated_at=now(),updated_at=now() where id=m.id;
    return jsonb_build_object('changed',false,'membership_id',m.id,'tier_id',next_tier,'metrics',metrics);
  end if;
  change_kind:=case when m.current_tier_id is null and next_tier is not null then 'initial' when next_tier is null then 'removed' when coalesce(candidate_priority,-1)>coalesce(current_priority,-1) then 'upgrade' else 'downgrade' end;
  next_version:=m.membership_version+1;
  update public.customer_vip_memberships set current_tier_id=next_tier,metrics=private.evaluate_customer_vip_tier.metrics,membership_version=next_version,qualified_at=case when next_tier is null then qualified_at else coalesce(qualified_at,now()) end,evaluated_at=now(),tier_changed_at=now(),updated_at=now() where id=m.id;
  insert into public.customer_vip_tier_history(membership_id,membership_version,restaurant_id,customer_user_id,from_tier_id,to_tier_id,change_type,reason,metrics_snapshot,actor_kind,actor_user_id)
  values(m.id,next_version,p_restaurant_id,p_customer_user_id,m.current_tier_id,next_tier,change_kind,coalesce(nullif(trim(p_reason),''),'automatic'),metrics,case when p_actor_kind in ('system','restaurant','platform') then p_actor_kind else 'system' end,p_actor_user_id) returning id into history_id;
  perform private.queue_vip_tier_notification(history_id);
  if change_kind in ('initial','upgrade') then perform private.issue_vip_exclusive_rewards(history_id); end if;
  select count(*) into recent_changes from public.customer_vip_tier_history where membership_id=m.id and created_at>=now()-interval '24 hours';
  if recent_changes>=4 then insert into public.vip_fraud_flags(restaurant_id,customer_user_id,membership_id,tier_history_id,flag_type,severity,details) select p_restaurant_id,p_customer_user_id,m.id,history_id,'rapid_tier_changes','high',jsonb_build_object('changes_24h',recent_changes) where not exists(select 1 from public.vip_fraud_flags f where f.membership_id=m.id and f.flag_type='rapid_tier_changes' and f.status='open' and f.created_at>=now()-interval '24 hours'); end if;
  return jsonb_build_object('changed',true,'membership_id',m.id,'history_id',history_id,'change_type',change_kind,'tier_id',next_tier,'metrics',metrics);
end $$;

create or replace function public.save_restaurant_vip_program(p_is_enabled boolean,p_qualification_window text,p_rolling_days integer,p_allow_downgrades boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rid uuid; row public.restaurant_vip_programs%rowtype;
begin
  select restaurant_id into rid from public.restaurant_members where user_id=auth.uid() order by created_at limit 1;
  if rid is null then raise exception 'Restaurant membership not found' using errcode='42501'; end if;
  if p_qualification_window not in ('lifetime','rolling') then raise exception 'Unsupported qualification window'; end if;
  if p_rolling_days<30 or p_rolling_days>3650 then raise exception 'Rolling qualification must be between 30 and 3650 days'; end if;
  insert into public.restaurant_vip_programs(restaurant_id,is_enabled,qualification_window,rolling_days,allow_downgrades,created_by)
  values(rid,p_is_enabled,p_qualification_window,p_rolling_days,p_allow_downgrades,auth.uid())
  on conflict(restaurant_id) do update set is_enabled=excluded.is_enabled,qualification_window=excluded.qualification_window,rolling_days=excluded.rolling_days,allow_downgrades=excluded.allow_downgrades,updated_at=now() returning * into row;
  return to_jsonb(row)-'created_by';
end $$;

create or replace function public.save_restaurant_vip_tier(p_tier_id uuid,p_name text,p_colour text,p_icon text,p_description text,p_priority integer,p_qualification_match text,p_is_active boolean,p_rules jsonb,p_benefits jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rid uuid; tier public.restaurant_vip_tiers%rowtype; item jsonb; metric text; benefit text; menu_id uuid; reward_id uuid; val integer;
begin
  select restaurant_id into rid from public.restaurant_members where user_id=auth.uid() order by created_at limit 1;
  if rid is null then raise exception 'Restaurant membership not found' using errcode='42501'; end if;
  if nullif(trim(p_name),'') is null then raise exception 'Tier name is required'; end if;
  if p_colour !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Tier colour must be a 6 digit hex colour'; end if;
  if p_qualification_match not in ('all','any') then raise exception 'Choose whether all or any rules must match'; end if;
  if p_tier_id is null then
    insert into public.restaurant_vip_tiers(restaurant_id,name,colour,icon,description,priority,qualification_match,is_active,created_by) values(rid,trim(p_name),p_colour,coalesce(nullif(trim(p_icon),''),'star'),nullif(trim(p_description),''),p_priority,p_qualification_match,p_is_active,auth.uid()) returning * into tier;
  else
    update public.restaurant_vip_tiers set name=trim(p_name),colour=p_colour,icon=coalesce(nullif(trim(p_icon),''),'star'),description=nullif(trim(p_description),''),priority=p_priority,qualification_match=p_qualification_match,is_active=p_is_active,updated_at=now() where id=p_tier_id and restaurant_id=rid and archived_at is null returning * into tier;
    if not found then raise exception 'VIP tier not found'; end if;
    delete from public.restaurant_vip_tier_rules where tier_id=tier.id;
    delete from public.restaurant_vip_tier_benefits where tier_id=tier.id;
  end if;
  for item in select value from jsonb_array_elements(coalesce(p_rules,'[]'::jsonb)) loop
    metric:=item->>'metric_type';
    if metric not in ('lifetime_spend','orders_completed','loyalty_points','stamp_cards_completed','referral_count','custom_metric') then raise exception 'Unsupported VIP metric: %',metric; end if;
    insert into public.restaurant_vip_tier_rules(tier_id,restaurant_id,metric_type,custom_metric_key,threshold_value) values(tier.id,rid,metric,case when metric='custom_metric' then lower(item->>'custom_metric_key') else null end,coalesce((item->>'threshold_value')::bigint,0));
  end loop;
  for item in select value from jsonb_array_elements(coalesce(p_benefits,'[]'::jsonb)) loop
    benefit:=item->>'benefit_type'; val:=case when item ? 'value' and item->>'value' is not null then (item->>'value')::integer else null end;
    menu_id:=case when nullif(item->>'menu_item_id','') is null then null else (item->>'menu_item_id')::uuid end;
    reward_id:=case when nullif(item->>'reward_catalogue_id','') is null then null else (item->>'reward_catalogue_id')::uuid end;
    if benefit not in ('bonus_loyalty_points','bonus_stamps','percentage_discount','fixed_discount','free_delivery','free_menu_item','birthday_bonus_multiplier','referral_multiplier','exclusive_reward','early_access_promotions','priority_customer_support') then raise exception 'Unsupported VIP benefit: %',benefit; end if;
    if benefit='free_menu_item' and not exists(select 1 from public.menu_items mi where mi.id=menu_id and mi.restaurant_id=rid) then raise exception 'Free menu item does not belong to this restaurant'; end if;
    if benefit='exclusive_reward' and not exists(select 1 from public.restaurant_loyalty_rewards lr where lr.id=reward_id and lr.restaurant_id=rid) then raise exception 'Exclusive reward does not belong to this restaurant'; end if;
    insert into public.restaurant_vip_tier_benefits(tier_id,restaurant_id,benefit_type,value,menu_item_id,reward_catalogue_id,metadata,is_active) values(tier.id,rid,benefit,val,menu_id,reward_id,coalesce(item->'metadata','{}'::jsonb),coalesce((item->>'is_active')::boolean,true));
  end loop;
  return to_jsonb(tier)-'created_by';
end $$;

create or replace function public.archive_restaurant_vip_tier(p_tier_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
  select restaurant_id into rid from public.restaurant_members where user_id=auth.uid() order by created_at limit 1;
  if rid is null then raise exception 'Restaurant membership not found' using errcode='42501'; end if;
  update public.restaurant_vip_tiers set is_active=false,archived_at=now(),updated_at=now() where id=p_tier_id and restaurant_id=rid and archived_at is null;
  if not found then raise exception 'VIP tier not found'; end if;
end $$;

create or replace function public.set_customer_vip_custom_metric(p_customer_user_id uuid,p_metric_key text,p_metric_value bigint,p_note text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rid uuid; previous bigint:=0; result jsonb;
begin
  select restaurant_id into rid from public.restaurant_members where user_id=auth.uid() order by created_at limit 1;
  if rid is null then raise exception 'Restaurant membership not found' using errcode='42501'; end if;
  if lower(trim(p_metric_key)) !~ '^[a-z0-9_]{1,64}$' then raise exception 'Metric key must contain only lowercase letters, numbers and underscores'; end if;
  if p_metric_value<0 then raise exception 'Metric value cannot be negative'; end if;
  if not exists(select 1 from auth.users where id=p_customer_user_id) then raise exception 'Customer not found'; end if;
  select metric_value into previous from public.customer_vip_custom_metrics where restaurant_id=rid and customer_user_id=p_customer_user_id and metric_key=lower(trim(p_metric_key)); previous:=coalesce(previous,0);
  insert into public.customer_vip_custom_metrics(restaurant_id,customer_user_id,metric_key,metric_value,updated_by) values(rid,p_customer_user_id,lower(trim(p_metric_key)),p_metric_value,auth.uid()) on conflict(restaurant_id,customer_user_id,metric_key) do update set metric_value=excluded.metric_value,updated_by=excluded.updated_by,updated_at=now();
  insert into public.customer_vip_custom_metric_events(restaurant_id,customer_user_id,metric_key,previous_value,new_value,note,actor_user_id) values(rid,p_customer_user_id,lower(trim(p_metric_key)),previous,p_metric_value,nullif(trim(p_note),''),auth.uid());
  if abs(p_metric_value-previous)>=1000000 or (previous>0 and p_metric_value>previous*20) then insert into public.vip_fraud_flags(restaurant_id,customer_user_id,flag_type,severity,details) values(rid,p_customer_user_id,'large_custom_metric_change','medium',jsonb_build_object('metric_key',lower(trim(p_metric_key)),'previous_value',previous,'new_value',p_metric_value,'actor_user_id',auth.uid())); end if;
  result:=private.evaluate_customer_vip_tier(rid,p_customer_user_id,'custom_metric_update','restaurant',auth.uid());
  return result||jsonb_build_object('metric_key',lower(trim(p_metric_key)),'metric_value',p_metric_value);
end $$;

create or replace function public.recalculate_restaurant_vip_memberships(p_limit integer default 250)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rid uuid; uid uuid; processed integer:=0; changed integer:=0; result jsonb;
begin
  select restaurant_id into rid from public.restaurant_members where user_id=auth.uid() order by created_at limit 1;
  if rid is null then raise exception 'Restaurant membership not found' using errcode='42501'; end if;
  for uid in select customer_user_id from (select distinct o.customer_user_id from public.orders o where o.restaurant_id=rid and o.customer_user_id is not null union select m.customer_user_id from public.customer_vip_memberships m where m.restaurant_id=rid union select x.customer_user_id from public.customer_vip_custom_metrics x where x.restaurant_id=rid) s limit least(greatest(coalesce(p_limit,250),1),1000) loop
    result:=private.evaluate_customer_vip_tier(rid,uid,'restaurant_recalculation','restaurant',auth.uid()); processed:=processed+1; if coalesce((result->>'changed')::boolean,false) then changed:=changed+1; end if;
  end loop;
  return jsonb_build_object('processed',processed,'changed',changed);
end $$;

create or replace function public.process_vip_memberships(p_limit integer default 500)
returns jsonb language plpgsql security definer set search_path='' as $$
declare row record; processed integer:=0; changed integer:=0; result jsonb;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role authorization required' using errcode='42501'; end if;
  for row in select p.restaurant_id,u.customer_user_id from public.restaurant_vip_programs p cross join lateral (select customer_user_id from (select distinct o.customer_user_id from public.orders o where o.restaurant_id=p.restaurant_id and o.customer_user_id is not null union select m.customer_user_id from public.customer_vip_memberships m where m.restaurant_id=p.restaurant_id union select x.customer_user_id from public.customer_vip_custom_metrics x where x.restaurant_id=p.restaurant_id) q) u where p.is_enabled and not p.disabled_by_platform order by p.restaurant_id,u.customer_user_id limit least(greatest(coalesce(p_limit,500),1),5000) loop
    result:=private.evaluate_customer_vip_tier(row.restaurant_id,row.customer_user_id,'scheduled_recalculation','system',null); processed:=processed+1; if coalesce((result->>'changed')::boolean,false) then changed:=changed+1; end if;
  end loop;
  return jsonb_build_object('processed',processed,'changed',changed);
end $$;

create or replace function public.get_restaurant_vip_dashboard()
returns jsonb language plpgsql security definer set search_path='' as $$
declare rid uuid; result jsonb;
begin
  select restaurant_id into rid from public.restaurant_members where user_id=auth.uid() order by created_at limit 1;
  if rid is null then raise exception 'Restaurant membership not found' using errcode='42501'; end if;
  select jsonb_build_object('program',coalesce((select to_jsonb(p)-'created_by' from public.restaurant_vip_programs p where p.restaurant_id=rid),'{}'::jsonb),'tiers',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'colour',t.colour,'icon',t.icon,'description',t.description,'priority',t.priority,'qualification_match',t.qualification_match,'is_active',t.is_active,'rules',coalesce((select jsonb_agg(to_jsonb(r)-'restaurant_id'-'tier_id' order by r.created_at) from public.restaurant_vip_tier_rules r where r.tier_id=t.id),'[]'::jsonb),'benefits',coalesce((select jsonb_agg((to_jsonb(b)-'restaurant_id'-'tier_id')||jsonb_build_object('menu_item_name',mi.name,'reward_name',lr.name) order by b.created_at) from public.restaurant_vip_tier_benefits b left join public.menu_items mi on mi.id=b.menu_item_id left join public.restaurant_loyalty_rewards lr on lr.id=b.reward_catalogue_id where b.tier_id=t.id),'[]'::jsonb)) order by t.priority) from public.restaurant_vip_tiers t where t.restaurant_id=rid and t.archived_at is null),'[]'::jsonb),'catalogue_rewards',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'reward_type',r.reward_type) order by r.name) from public.restaurant_loyalty_rewards r where r.restaurant_id=rid),'[]'::jsonb),'menu_items',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name) order by m.name) from public.menu_items m where m.restaurant_id=rid and m.is_available),'[]'::jsonb)) into result;
  return result;
end $$;

create or replace function public.get_customer_vip_dashboard()
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); row record; result jsonb;
begin
  if uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
  for row in select distinct p.restaurant_id from public.restaurant_vip_programs p where p.is_enabled and not p.disabled_by_platform and (exists(select 1 from public.orders o where o.restaurant_id=p.restaurant_id and o.customer_user_id=uid) or exists(select 1 from public.customer_loyalty_accounts a where a.restaurant_id=p.restaurant_id and a.customer_user_id=uid) or exists(select 1 from public.customer_stamp_cards c where c.restaurant_id=p.restaurant_id and c.customer_user_id=uid) or exists(select 1 from public.customer_referrals r where r.restaurant_id=p.restaurant_id and r.referrer_user_id=uid) or exists(select 1 from public.customer_vip_custom_metrics x where x.restaurant_id=p.restaurant_id and x.customer_user_id=uid)) loop perform private.evaluate_customer_vip_tier(row.restaurant_id,uid,'customer_dashboard_refresh','system',null); end loop;
  select jsonb_build_object('memberships',coalesce((select jsonb_agg(jsonb_build_object('membership_id',m.id,'restaurant_id',m.restaurant_id,'restaurant_name',rest.name,'restaurant_slug',rest.slug,'current_tier',case when t.id is null then null else jsonb_build_object('id',t.id,'name',t.name,'colour',t.colour,'icon',t.icon,'description',t.description,'priority',t.priority) end,'benefits',coalesce((select jsonb_agg((to_jsonb(b)-'restaurant_id'-'tier_id')||jsonb_build_object('menu_item_name',mi.name,'reward_name',lr.name) order by b.created_at) from public.restaurant_vip_tier_benefits b left join public.menu_items mi on mi.id=b.menu_item_id left join public.restaurant_loyalty_rewards lr on lr.id=b.reward_catalogue_id where b.tier_id=m.current_tier_id and b.is_active),'[]'::jsonb),'metrics',m.metrics,'next_tier',(select jsonb_build_object('id',n.id,'name',n.name,'colour',n.colour,'icon',n.icon,'description',n.description,'priority',n.priority,'qualification_match',n.qualification_match,'requirements',coalesce((select jsonb_agg(jsonb_build_object('metric_type',rr.metric_type,'custom_metric_key',rr.custom_metric_key,'threshold_value',rr.threshold_value,'current_value',private.vip_metric_value(m.metrics,rr.metric_type,rr.custom_metric_key),'remaining',greatest(rr.threshold_value-private.vip_metric_value(m.metrics,rr.metric_type,rr.custom_metric_key),0),'progress_percent',case when rr.threshold_value=0 then 100 else least(100,round(100.0*private.vip_metric_value(m.metrics,rr.metric_type,rr.custom_metric_key)/rr.threshold_value,1)) end) order by rr.created_at) from public.restaurant_vip_tier_rules rr where rr.tier_id=n.id),'[]'::jsonb)) from public.restaurant_vip_tiers n where n.restaurant_id=m.restaurant_id and n.archived_at is null and n.is_active and n.priority>coalesce(t.priority,-1) order by n.priority limit 1),'history',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'change_type',h.change_type,'from_tier_name',ft.name,'to_tier_name',tt.name,'reason',h.reason,'created_at',h.created_at) order by h.created_at desc) from public.customer_vip_tier_history h left join public.restaurant_vip_tiers ft on ft.id=h.from_tier_id left join public.restaurant_vip_tiers tt on tt.id=h.to_tier_id where h.membership_id=m.id),'[]'::jsonb),'tier_changed_at',m.tier_changed_at,'evaluated_at',m.evaluated_at) order by m.updated_at desc) from public.customer_vip_memberships m join public.restaurants rest on rest.id=m.restaurant_id join public.restaurant_vip_programs p on p.restaurant_id=m.restaurant_id and p.is_enabled and not p.disabled_by_platform left join public.restaurant_vip_tiers t on t.id=m.current_tier_id where m.customer_user_id=uid),'[]'::jsonb),'reward_history',coalesce((select jsonb_agg(jsonb_build_object('issuance_id',i.id,'restaurant_id',i.restaurant_id,'restaurant_name',r.name,'status',i.status,'reward_type',i.reward_type,'reward_value',i.reward_value,'issued_at',i.issued_at,'redeemed_at',i.redeemed_at,'expires_at',i.expires_at,'metadata',i.metadata) order by i.created_at desc) from public.customer_reward_issuances i join public.restaurants r on r.id=i.restaurant_id where i.customer_user_id=uid and i.source_type='vip'),'[]'::jsonb)) into result;
  return result;
end $$;

revoke all on function public.save_restaurant_vip_program(boolean,text,integer,boolean) from public,anon;
revoke all on function public.save_restaurant_vip_tier(uuid,text,text,text,text,integer,text,boolean,jsonb,jsonb) from public,anon;
revoke all on function public.archive_restaurant_vip_tier(uuid) from public,anon;
revoke all on function public.set_customer_vip_custom_metric(uuid,text,bigint,text) from public,anon;
revoke all on function public.recalculate_restaurant_vip_memberships(integer) from public,anon;
revoke all on function public.get_restaurant_vip_dashboard() from public,anon;
revoke all on function public.get_customer_vip_dashboard() from public,anon;
revoke all on function public.process_vip_memberships(integer) from public,anon,authenticated;
grant execute on function public.save_restaurant_vip_program(boolean,text,integer,boolean), public.save_restaurant_vip_tier(uuid,text,text,text,text,integer,text,boolean,jsonb,jsonb), public.archive_restaurant_vip_tier(uuid), public.set_customer_vip_custom_metric(uuid,text,bigint,text), public.recalculate_restaurant_vip_memberships(integer), public.get_restaurant_vip_dashboard(), public.get_customer_vip_dashboard() to authenticated,service_role;
grant execute on function public.process_vip_memberships(integer) to service_role;
