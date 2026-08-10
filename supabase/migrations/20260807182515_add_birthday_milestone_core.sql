alter table public.customer_profiles
  add column if not exists date_of_birth date,
  add column if not exists date_of_birth_set_at timestamptz,
  add column if not exists date_of_birth_change_count integer not null default 0,
  add column if not exists date_of_birth_last_changed_at timestamptz;

alter table public.customer_profiles drop constraint if exists customer_profiles_date_of_birth_change_count_check;
alter table public.customer_profiles add constraint customer_profiles_date_of_birth_change_count_check check (date_of_birth_change_count between 0 and 1);
alter table public.customer_profiles drop constraint if exists customer_profiles_date_of_birth_check;
alter table public.customer_profiles add constraint customer_profiles_date_of_birth_check check (date_of_birth is null or (date_of_birth <= current_date and date_of_birth >= (current_date - interval '120 years')::date));

alter table public.restaurants add column if not exists sells_alcohol boolean not null default false;

alter table public.restaurant_loyalty_rewards
  add column if not exists fulfilment_methods text[] not null default array['delivery'::text,'collection'::text];
alter table public.restaurant_loyalty_rewards drop constraint if exists restaurant_loyalty_rewards_fulfilment_methods_check;
alter table public.restaurant_loyalty_rewards add constraint restaurant_loyalty_rewards_fulfilment_methods_check
  check (cardinality(fulfilment_methods) > 0 and fulfilment_methods <@ array['delivery'::text,'collection'::text]);

create table if not exists public.customer_dob_audit_log (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_kind text not null check (actor_kind in ('customer','platform_admin','system')),
  action text not null check (action in ('set','changed','admin_override')),
  reason text,
  change_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists customer_dob_audit_customer_idx on public.customer_dob_audit_log(customer_user_id,created_at desc);
alter table public.customer_dob_audit_log enable row level security;

create table if not exists public.restaurant_birthday_programs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null unique references public.restaurants(id) on delete cascade,
  is_enabled boolean not null default false,
  disabled_by_platform boolean not null default false,
  platform_disable_reason text,
  reward_type text not null default 'voucher' check (reward_type in ('voucher','percentage_discount','fixed_discount','free_item','free_delivery','loyalty_points','wallet_credit')),
  reward_value integer not null default 500 check (reward_value >= 0),
  reward_menu_item_id uuid references public.menu_items(id) on delete set null,
  reward_catalogue_id uuid references public.restaurant_loyalty_rewards(id) on delete set null,
  validity_days integer not null default 14 check (validity_days between 1 and 365),
  minimum_spend_pence integer not null default 0 check (minimum_spend_pence >= 0),
  fulfilment_methods text[] not null default array['delivery'::text,'collection'::text],
  campaign_message text not null default 'Happy Birthday! Enjoy a reward from us.',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restaurant_birthday_programs_fulfilment_check check (cardinality(fulfilment_methods)>0 and fulfilment_methods <@ array['delivery'::text,'collection'::text]),
  constraint restaurant_birthday_programs_reward_config_check check (
    (reward_type in ('voucher','fixed_discount','wallet_credit','percentage_discount','loyalty_points') and reward_value > 0)
    or (reward_type='free_item' and reward_menu_item_id is not null)
    or reward_type='free_delivery'
  )
);
alter table public.restaurant_birthday_programs enable row level security;

create table if not exists public.restaurant_milestone_programs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  milestone_type text not null check (milestone_type in ('order_count','lifetime_spend')),
  threshold_value integer not null check (threshold_value > 0),
  is_enabled boolean not null default false,
  is_system_default boolean not null default false,
  disabled_by_platform boolean not null default false,
  platform_disable_reason text,
  reward_type text not null default 'voucher' check (reward_type in ('voucher','percentage_discount','fixed_discount','free_item','free_delivery','loyalty_points','wallet_credit')),
  reward_value integer not null default 500 check (reward_value >= 0),
  reward_menu_item_id uuid references public.menu_items(id) on delete set null,
  reward_catalogue_id uuid references public.restaurant_loyalty_rewards(id) on delete set null,
  validity_days integer not null default 30 check (validity_days between 1 and 365),
  minimum_spend_pence integer not null default 0 check (minimum_spend_pence >= 0),
  fulfilment_methods text[] not null default array['delivery'::text,'collection'::text],
  campaign_message text not null default 'You reached a new milestone. Your reward is ready!',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restaurant_milestone_programs_threshold_unique unique (restaurant_id,milestone_type,threshold_value),
  constraint restaurant_milestone_programs_fulfilment_check check (cardinality(fulfilment_methods)>0 and fulfilment_methods <@ array['delivery'::text,'collection'::text]),
  constraint restaurant_milestone_programs_reward_config_check check (
    (reward_type in ('voucher','fixed_discount','wallet_credit','percentage_discount','loyalty_points') and reward_value > 0)
    or (reward_type='free_item' and reward_menu_item_id is not null)
    or reward_type='free_delivery'
  )
);
create index if not exists restaurant_milestone_programs_restaurant_idx on public.restaurant_milestone_programs(restaurant_id,is_enabled,milestone_type,threshold_value);
alter table public.restaurant_milestone_programs enable row level security;

create table if not exists public.customer_reward_issuances (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (source_type in ('birthday','milestone')),
  source_id uuid not null,
  source_key text not null,
  triggering_order_id uuid references public.orders(id) on delete set null,
  reward_type text not null check (reward_type in ('voucher','percentage_discount','fixed_discount','free_item','free_delivery','loyalty_points','wallet_credit')),
  reward_value integer not null default 0 check (reward_value >= 0),
  reward_catalogue_id uuid references public.restaurant_loyalty_rewards(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','available','redeemed','expired','blocked','reversed')),
  eligible_at timestamptz not null default now(),
  expires_at timestamptz,
  issued_at timestamptz,
  redeemed_at timestamptz,
  converted_at timestamptz,
  converted_order_id uuid references public.orders(id) on delete set null,
  redemption_order_id uuid references public.orders(id) on delete set null,
  voucher_id uuid,
  loyalty_ledger_id uuid,
  campaign_cost_pence integer not null default 0 check (campaign_cost_pence >= 0),
  revenue_generated_pence integer not null default 0 check (revenue_generated_pence >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_reward_issuances_source_unique unique (restaurant_id,customer_user_id,source_type,source_id,source_key)
);
create index if not exists customer_reward_issuances_customer_idx on public.customer_reward_issuances(customer_user_id,created_at desc);
create index if not exists customer_reward_issuances_restaurant_idx on public.customer_reward_issuances(restaurant_id,source_type,status,created_at desc);
create index if not exists customer_reward_issuances_expiry_idx on public.customer_reward_issuances(status,expires_at) where expires_at is not null;
alter table public.customer_reward_issuances enable row level security;

alter table public.customer_reward_vouchers add column if not exists reward_issuance_id uuid references public.customer_reward_issuances(id) on delete set null;
create unique index if not exists customer_reward_vouchers_reward_issuance_unique on public.customer_reward_vouchers(reward_issuance_id) where reward_issuance_id is not null;

alter table public.customer_loyalty_ledger add column if not exists reward_issuance_id uuid references public.customer_reward_issuances(id) on delete set null;
create unique index if not exists customer_loyalty_ledger_reward_issuance_unique on public.customer_loyalty_ledger(reward_issuance_id) where reward_issuance_id is not null;
alter table public.customer_loyalty_ledger drop constraint if exists customer_loyalty_ledger_entry_type_check;
alter table public.customer_loyalty_ledger add constraint customer_loyalty_ledger_entry_type_check check (entry_type = any(array['order_earned'::text,'reward_redeemed'::text,'manual_adjustment'::text,'refund_reversal'::text,'birthday_bonus'::text,'referral_bonus'::text,'milestone_bonus'::text]));

alter table public.customer_reward_issuances add constraint customer_reward_issuances_voucher_fkey foreign key (voucher_id) references public.customer_reward_vouchers(id) on delete set null;
alter table public.customer_reward_issuances add constraint customer_reward_issuances_loyalty_ledger_fkey foreign key (loyalty_ledger_id) references public.customer_loyalty_ledger(id) on delete set null;

create table if not exists public.reward_notification_queue (
  id uuid primary key default gen_random_uuid(),
  reward_issuance_id uuid not null references public.customer_reward_issuances(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('happy_birthday','birthday_reward_available','birthday_reward_expiring','milestone_reached','reward_earned')),
  subject text not null,
  body text not null,
  action_url text not null default '/account/milestones',
  push_payload jsonb not null default '{}'::jsonb,
  push_status text not null default 'pending' check (push_status in ('pending','dispatched','skipped','failed')),
  status text not null default 'pending' check (status in ('pending','processing','sent','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reward_notification_queue_event_unique unique (reward_issuance_id,event_type)
);
create index if not exists reward_notification_queue_pending_idx on public.reward_notification_queue(status,available_at,created_at);
alter table public.reward_notification_queue enable row level security;

create table if not exists public.customer_reward_fraud_flags (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_user_id uuid references auth.users(id) on delete set null,
  reward_issuance_id uuid references public.customer_reward_issuances(id) on delete set null,
  source_type text not null check (source_type in ('birthday','milestone','manual')),
  flag_type text not null,
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  status text not null default 'open' check (status in ('open','reviewed','dismissed','confirmed')),
  details jsonb not null default '{}'::jsonb,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);
create index if not exists customer_reward_fraud_flags_restaurant_idx on public.customer_reward_fraud_flags(restaurant_id,status,created_at desc);
create index if not exists customer_reward_fraud_flags_customer_idx on public.customer_reward_fraud_flags(customer_user_id,created_at desc);
alter table public.customer_reward_fraud_flags enable row level security;

create or replace function private.guard_customer_profile_dob()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.date_of_birth is distinct from old.date_of_birth
     or new.date_of_birth_change_count is distinct from old.date_of_birth_change_count
     or new.date_of_birth_set_at is distinct from old.date_of_birth_set_at
     or new.date_of_birth_last_changed_at is distinct from old.date_of_birth_last_changed_at then
    if coalesce(current_setting('app.allow_dob_change',true),'') <> '1' then
      raise exception 'Date of birth must be changed through the secure date-of-birth RPC' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_customer_profile_dob on public.customer_profiles;
create trigger guard_customer_profile_dob before update on public.customer_profiles for each row execute function private.guard_customer_profile_dob();

create or replace function private.initialise_restaurant_milestones(p_restaurant_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  insert into public.restaurant_birthday_programs(restaurant_id) values(p_restaurant_id) on conflict(restaurant_id) do nothing;
  insert into public.restaurant_milestone_programs(restaurant_id,name,milestone_type,threshold_value,is_system_default)
  values
    (p_restaurant_id,'First order','order_count',1,true),
    (p_restaurant_id,'5th order','order_count',5,true),
    (p_restaurant_id,'10th order','order_count',10,true),
    (p_restaurant_id,'25th order','order_count',25,true),
    (p_restaurant_id,'50th order','order_count',50,true),
    (p_restaurant_id,'100th order','order_count',100,true),
    (p_restaurant_id,'250th order','order_count',250,true),
    (p_restaurant_id,'£100 spent','lifetime_spend',10000,true),
    (p_restaurant_id,'£250 spent','lifetime_spend',25000,true),
    (p_restaurant_id,'£500 spent','lifetime_spend',50000,true),
    (p_restaurant_id,'£1000 spent','lifetime_spend',100000,true)
  on conflict(restaurant_id,milestone_type,threshold_value) do nothing;
end $$;

create or replace function private.initialise_restaurant_milestones_trigger()
returns trigger language plpgsql security definer set search_path='' as $$ begin perform private.initialise_restaurant_milestones(new.id); return new; end $$;
drop trigger if exists initialise_restaurant_milestones on public.restaurants;
create trigger initialise_restaurant_milestones after insert on public.restaurants for each row execute function private.initialise_restaurant_milestones_trigger();

do $$ declare r record; begin for r in select id from public.restaurants loop perform private.initialise_restaurant_milestones(r.id); end loop; end $$;

create or replace function private.sync_campaign_catalogue_reward(
  p_restaurant_id uuid,p_reward_id uuid,p_name text,p_reward_type text,p_reward_value integer,p_menu_item_id uuid,p_minimum_spend_pence integer,p_fulfilment_methods text[])
returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid:=p_reward_id; mapped text;
begin
  if p_reward_type='loyalty_points' then return null; end if;
  mapped:=case p_reward_type when 'voucher' then 'fixed_discount' when 'fixed_discount' then 'fixed_discount' when 'percentage_discount' then 'percentage_discount' when 'free_item' then 'free_item' when 'free_delivery' then 'free_delivery' when 'wallet_credit' then 'wallet_credit' else null end;
  if mapped is null then raise exception 'Unsupported reward type'; end if;
  if mapped='free_item' and p_menu_item_id is null then raise exception 'Choose the free menu item'; end if;
  if mapped in ('fixed_discount','wallet_credit','percentage_discount') and coalesce(p_reward_value,0)<=0 then raise exception 'Reward value must be greater than zero'; end if;
  if rid is null then
    insert into public.restaurant_loyalty_rewards(restaurant_id,name,description,reward_type,points_cost,fixed_value_pence,percentage_basis_points,menu_item_id,minimum_order_pence,fulfilment_methods,is_active,created_by)
    values(p_restaurant_id,p_name,'Automatically issued birthday or milestone reward.',mapped,1,
      case when mapped in ('fixed_discount','wallet_credit') then p_reward_value else null end,
      case when mapped='percentage_discount' then p_reward_value else null end,
      case when mapped='free_item' then p_menu_item_id else null end,
      p_minimum_spend_pence,coalesce(p_fulfilment_methods,array['delivery'::text,'collection'::text]),false,auth.uid()) returning id into rid;
  else
    update public.restaurant_loyalty_rewards set name=p_name,reward_type=mapped,
      fixed_value_pence=case when mapped in ('fixed_discount','wallet_credit') then p_reward_value else null end,
      percentage_basis_points=case when mapped='percentage_discount' then p_reward_value else null end,
      menu_item_id=case when mapped='free_item' then p_menu_item_id else null end,
      minimum_order_pence=p_minimum_spend_pence,
      fulfilment_methods=coalesce(p_fulfilment_methods,array['delivery'::text,'collection'::text]),
      is_active=false,updated_at=now()
    where id=rid and restaurant_id=p_restaurant_id;
    if not found then raise exception 'Reward catalogue entry does not belong to this restaurant'; end if;
  end if;
  return rid;
end $$;

create or replace function public.set_customer_date_of_birth(p_date_of_birth date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); prof public.customer_profiles%rowtype; next_count integer; action_name text;
begin
  if uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_date_of_birth is null or p_date_of_birth>current_date or p_date_of_birth<(current_date-interval '120 years')::date then raise exception 'Enter a valid date of birth' using errcode='22023'; end if;
  insert into public.customer_profiles(user_id) values(uid) on conflict(user_id) do nothing;
  select * into prof from public.customer_profiles where user_id=uid for update;
  if prof.date_of_birth=p_date_of_birth then return jsonb_build_object('date_of_birth',prof.date_of_birth,'can_change',prof.date_of_birth_change_count<1); end if;
  if prof.date_of_birth is not null and prof.date_of_birth_change_count>=1 then raise exception 'You have already used your one date-of-birth change. Contact support if it is incorrect.' using errcode='22023'; end if;
  next_count:=case when prof.date_of_birth is null then prof.date_of_birth_change_count else prof.date_of_birth_change_count+1 end;
  action_name:=case when prof.date_of_birth is null then 'set' else 'changed' end;
  perform set_config('app.allow_dob_change','1',true);
  update public.customer_profiles set date_of_birth=p_date_of_birth,date_of_birth_set_at=coalesce(date_of_birth_set_at,now()),date_of_birth_change_count=next_count,date_of_birth_last_changed_at=case when prof.date_of_birth is null then date_of_birth_last_changed_at else now() end,updated_at=now() where user_id=uid;
  insert into public.customer_dob_audit_log(customer_user_id,actor_user_id,actor_kind,action,change_count) values(uid,uid,'customer',action_name,next_count);
  return jsonb_build_object('date_of_birth',p_date_of_birth,'can_change',next_count<1,'change_count',next_count);
end $$;

create or replace function public.platform_set_customer_date_of_birth(p_customer_user_id uuid,p_date_of_birth date,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); clean_reason text:=nullif(trim(coalesce(p_reason,'')),'');
begin
  if not private.has_platform_admin_permission('customers:manage') then raise exception 'Customer management permission required' using errcode='42501'; end if;
  if clean_reason is null or length(clean_reason)<5 then raise exception 'Provide an override reason' using errcode='22023'; end if;
  if p_date_of_birth is null or p_date_of_birth>current_date or p_date_of_birth<(current_date-interval '120 years')::date then raise exception 'Enter a valid date of birth' using errcode='22023'; end if;
  insert into public.customer_profiles(user_id) values(p_customer_user_id) on conflict(user_id) do nothing;
  perform set_config('app.allow_dob_change','1',true);
  update public.customer_profiles set date_of_birth=p_date_of_birth,date_of_birth_set_at=coalesce(date_of_birth_set_at,now()),date_of_birth_last_changed_at=now(),updated_at=now() where user_id=p_customer_user_id;
  insert into public.customer_dob_audit_log(customer_user_id,actor_user_id,actor_kind,action,reason,change_count)
  select p_customer_user_id,actor,'platform_admin','admin_override',clean_reason,date_of_birth_change_count from public.customer_profiles where user_id=p_customer_user_id;
  insert into public.platform_admin_audit_log(actor_user_id,action,target_type,target_id,details) values(actor,'customer_dob_override','customer',p_customer_user_id,jsonb_build_object('reason',clean_reason));
  return jsonb_build_object('customer_user_id',p_customer_user_id,'updated',true);
end $$;

create or replace function public.get_customer_age_eligibility(p_restaurant_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid(); alcohol boolean; dob date;
begin
  select sells_alcohol into alcohol from public.restaurants where id=p_restaurant_id;
  if alcohol is null then raise exception 'Restaurant not found'; end if;
  if not alcohol then return jsonb_build_object('age_check_required',false,'eligible',true); end if;
  if uid is null then return jsonb_build_object('age_check_required',true,'eligible',false,'reason','signin_required'); end if;
  select date_of_birth into dob from public.customer_profiles where user_id=uid;
  return jsonb_build_object('age_check_required',true,'eligible',coalesce(dob <= (current_date-interval '18 years')::date,false),'date_of_birth_on_file',dob is not null,'reason',case when dob is null then 'dob_required' when dob>(current_date-interval '18 years')::date then 'under_18' else null end);
end $$;

create or replace function public.save_restaurant_alcohol_setting(p_sells_alcohol boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
  select restaurant_id into rid from public.restaurant_members where user_id=auth.uid() and role in ('owner','manager') order by created_at limit 1;
  if rid is null then raise exception 'Owner or manager access required' using errcode='42501'; end if;
  update public.restaurants set sells_alcohol=coalesce(p_sells_alcohol,false),updated_at=now() where id=rid;
  return jsonb_build_object('restaurant_id',rid,'sells_alcohol',coalesce(p_sells_alcohol,false));
end $$;

create or replace function public.save_restaurant_birthday_program(
  p_is_enabled boolean,p_reward_type text,p_reward_value integer,p_reward_menu_item_id uuid,p_validity_days integer,p_minimum_spend_pence integer,p_fulfilment_methods text[],p_campaign_message text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rid uuid; prog public.restaurant_birthday_programs%rowtype; catalogue uuid;
begin
  select restaurant_id into rid from public.restaurant_members where user_id=auth.uid() and role in ('owner','manager') order by created_at limit 1;
  if rid is null then raise exception 'Owner or manager access required' using errcode='42501'; end if;
  perform private.initialise_restaurant_milestones(rid);
  select * into prog from public.restaurant_birthday_programs where restaurant_id=rid for update;
  if prog.disabled_by_platform and p_is_enabled then raise exception 'Birthday rewards have been disabled by platform administration' using errcode='42501'; end if;
  if p_reward_type not in ('voucher','percentage_discount','fixed_discount','free_item','free_delivery','loyalty_points','wallet_credit') then raise exception 'Unsupported reward type'; end if;
  catalogue:=private.sync_campaign_catalogue_reward(rid,prog.reward_catalogue_id,'Birthday reward',p_reward_type,coalesce(p_reward_value,0),p_reward_menu_item_id,coalesce(p_minimum_spend_pence,0),coalesce(p_fulfilment_methods,array['delivery'::text,'collection'::text]));
  update public.restaurant_birthday_programs set is_enabled=coalesce(p_is_enabled,false),reward_type=p_reward_type,reward_value=coalesce(p_reward_value,0),reward_menu_item_id=p_reward_menu_item_id,reward_catalogue_id=catalogue,validity_days=coalesce(p_validity_days,14),minimum_spend_pence=coalesce(p_minimum_spend_pence,0),fulfilment_methods=coalesce(p_fulfilment_methods,array['delivery'::text,'collection'::text]),campaign_message=left(coalesce(nullif(trim(p_campaign_message),''),'Happy Birthday! Enjoy a reward from us.'),500),created_by=coalesce(created_by,auth.uid()),updated_at=now() where id=prog.id returning * into prog;
  return to_jsonb(prog)-'created_by';
end $$;

create or replace function public.save_restaurant_milestone_program(
  p_program_id uuid,p_name text,p_milestone_type text,p_threshold_value integer,p_is_enabled boolean,p_reward_type text,p_reward_value integer,p_reward_menu_item_id uuid,p_validity_days integer,p_minimum_spend_pence integer,p_fulfilment_methods text[],p_campaign_message text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rid uuid; prog public.restaurant_milestone_programs%rowtype; catalogue uuid; new_id uuid;
begin
  select restaurant_id into rid from public.restaurant_members where user_id=auth.uid() and role in ('owner','manager') order by created_at limit 1;
  if rid is null then raise exception 'Owner or manager access required' using errcode='42501'; end if;
  if p_milestone_type not in ('order_count','lifetime_spend') or coalesce(p_threshold_value,0)<=0 then raise exception 'Invalid milestone threshold'; end if;
  if p_reward_type not in ('voucher','percentage_discount','fixed_discount','free_item','free_delivery','loyalty_points','wallet_credit') then raise exception 'Unsupported reward type'; end if;
  if p_program_id is null then
    insert into public.restaurant_milestone_programs(restaurant_id,name,milestone_type,threshold_value,is_enabled,reward_type,reward_value,reward_menu_item_id,validity_days,minimum_spend_pence,fulfilment_methods,campaign_message,created_by)
    values(rid,left(trim(coalesce(p_name,'Custom milestone')),100),p_milestone_type,p_threshold_value,coalesce(p_is_enabled,false),p_reward_type,coalesce(p_reward_value,0),p_reward_menu_item_id,coalesce(p_validity_days,30),coalesce(p_minimum_spend_pence,0),coalesce(p_fulfilment_methods,array['delivery'::text,'collection'::text]),left(coalesce(nullif(trim(p_campaign_message),''),'You reached a new milestone. Your reward is ready!'),500),auth.uid()) returning * into prog;
  else
    select * into prog from public.restaurant_milestone_programs where id=p_program_id and restaurant_id=rid for update;
    if not found then raise exception 'Milestone programme not found'; end if;
    if prog.is_system_default and (prog.milestone_type<>p_milestone_type or prog.threshold_value<>p_threshold_value) then raise exception 'Built-in milestone thresholds cannot be changed'; end if;
    if prog.disabled_by_platform and p_is_enabled then raise exception 'This milestone has been disabled by platform administration' using errcode='42501'; end if;
    update public.restaurant_milestone_programs set name=left(trim(coalesce(p_name,name)),100),milestone_type=p_milestone_type,threshold_value=p_threshold_value,is_enabled=coalesce(p_is_enabled,false),reward_type=p_reward_type,reward_value=coalesce(p_reward_value,0),reward_menu_item_id=p_reward_menu_item_id,validity_days=coalesce(p_validity_days,30),minimum_spend_pence=coalesce(p_minimum_spend_pence,0),fulfilment_methods=coalesce(p_fulfilment_methods,array['delivery'::text,'collection'::text]),campaign_message=left(coalesce(nullif(trim(p_campaign_message),''),campaign_message),500),updated_at=now() where id=prog.id returning * into prog;
  end if;
  catalogue:=private.sync_campaign_catalogue_reward(rid,prog.reward_catalogue_id,'Milestone: '||prog.name,prog.reward_type,prog.reward_value,prog.reward_menu_item_id,prog.minimum_spend_pence,prog.fulfilment_methods);
  update public.restaurant_milestone_programs set reward_catalogue_id=catalogue,updated_at=now() where id=prog.id returning * into prog;
  return to_jsonb(prog)-'created_by';
end $$;

create or replace function public.delete_restaurant_milestone_program(p_program_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare rid uuid; prog public.restaurant_milestone_programs%rowtype;
begin
  select restaurant_id into rid from public.restaurant_members where user_id=auth.uid() and role in ('owner','manager') order by created_at limit 1;
  if rid is null then raise exception 'Owner or manager access required' using errcode='42501'; end if;
  select * into prog from public.restaurant_milestone_programs where id=p_program_id and restaurant_id=rid for update;
  if not found then return; end if;
  if prog.is_system_default then raise exception 'Built-in milestones can be disabled but not deleted'; end if;
  if exists(select 1 from public.customer_reward_issuances where source_type='milestone' and source_id=prog.id) then raise exception 'Milestones with issued rewards cannot be deleted; disable it instead'; end if;
  delete from public.restaurant_milestone_programs where id=prog.id;
  if prog.reward_catalogue_id is not null then delete from public.restaurant_loyalty_rewards where id=prog.reward_catalogue_id and redemption_count=0; end if;
end $$;

create or replace function public.create_order(storefront_slug text, fulfilment_method text, customer_first_name text, customer_last_name text, customer_email text, customer_phone text, basket_items jsonb, address_line_1 text default null, address_line_2 text default null, town_city text default null, postcode text default null, delivery_instructions text default null, requested_fulfilment_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare created jsonb; fees jsonb; rid uuid; alcohol boolean; dob date;
begin
  select r.id,r.sells_alcohol into rid,alcohol from public.restaurants r where r.slug=storefront_slug;
  if rid is null then raise exception 'Restaurant not found'; end if;
  if alcohol then
    if auth.uid() is null then raise exception 'Sign in and add your date of birth before ordering from a restaurant that sells alcohol' using errcode='42501'; end if;
    select date_of_birth into dob from public.customer_profiles where user_id=auth.uid();
    if dob is null then raise exception 'Add your date of birth to your account before ordering alcohol' using errcode='42501'; end if;
    if dob>(current_date-interval '18 years')::date then raise exception 'You must be 18 or over to order from this restaurant' using errcode='42501'; end if;
  end if;
  created:=public.create_order_without_platform_fees(storefront_slug,fulfilment_method,customer_first_name,customer_last_name,customer_email,customer_phone,basket_items,address_line_1,address_line_2,town_city,postcode,delivery_instructions,requested_fulfilment_at);
  fees:=public.apply_order_platform_fees((created->>'order_id')::uuid);
  return created||fees;
end $$;

create or replace function public.reserve_order_reward_voucher(p_order_id uuid,p_voucher_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); o public.orders%rowtype; v public.customer_reward_vouchers%rowtype; r public.restaurant_loyalty_rewards%rowtype; discount integer:=0; item_discount integer:=0;
begin
  if uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into o from public.orders where id=p_order_id and customer_user_id=uid for update; if not found then raise exception 'Order not found' using errcode='42501'; end if;
  if o.order_status<>'pending_payment' then raise exception 'Order is no longer awaiting payment'; end if;
  if o.reward_voucher_id is not null then raise exception 'A reward is already applied to this order'; end if;
  select * into v from public.customer_reward_vouchers where id=p_voucher_id and customer_user_id=uid and restaurant_id=o.restaurant_id for update; if not found then raise exception 'Reward voucher not found'; end if;
  if v.expires_at is not null and v.expires_at<=now() then update public.customer_reward_vouchers set status='expired' where id=v.id; raise exception 'Reward voucher has expired'; end if;
  if v.status='reserved' and v.reservation_expires_at>now() then raise exception 'Reward voucher is already reserved'; end if;
  if v.status not in('available','reserved') then raise exception 'Reward voucher is not available'; end if;
  select * into r from public.restaurant_loyalty_rewards where id=v.reward_id; if not found then raise exception 'Reward is no longer available'; end if;
  if not (o.fulfilment_method=any(r.fulfilment_methods)) then raise exception 'This reward is not valid for this fulfilment method'; end if;
  if o.subtotal_pence<r.minimum_order_pence then raise exception 'Minimum order value has not been reached'; end if;
  discount:=case r.reward_type when 'fixed_discount' then least(coalesce(r.fixed_value_pence,0),o.total_pence) when 'percentage_discount' then least(round(o.subtotal_pence*coalesce(r.percentage_basis_points,0)/10000.0)::integer,o.total_pence) when 'free_delivery' then least(o.delivery_fee_pence,o.total_pence) when 'wallet_credit' then least(coalesce(r.fixed_value_pence,0),o.total_pence) else 0 end;
  if r.reward_type='free_item' then select coalesce(max(unit_price_pence),0) into item_discount from public.order_items where order_id=o.id and menu_item_id=r.menu_item_id; if item_discount<=0 then raise exception 'The required reward item is not in this order'; end if; discount:=least(item_discount,o.total_pence); end if;
  if discount<=0 then raise exception 'This reward does not reduce the current order total'; end if;
  update public.customer_reward_vouchers set status='reserved',reserved_order_id=o.id,reserved_at=now(),reservation_expires_at=now()+interval '35 minutes' where id=v.id;
  update public.orders set reward_voucher_id=v.id,reward_discount_pence=discount,discount_pence=discount_pence+discount,total_pence=greatest(total_pence-discount,0),restaurant_net_pence=greatest(restaurant_net_pence-discount,0),updated_at=now() where id=o.id;
  return jsonb_build_object('voucher_id',v.id,'reward_name',r.name,'discount_pence',discount,'total_pence',greatest(o.total_pence-discount,0),'reservation_expires_at',now()+interval '35 minutes');
end $$;

revoke all on public.customer_dob_audit_log,public.restaurant_birthday_programs,public.restaurant_milestone_programs,public.customer_reward_issuances,public.reward_notification_queue,public.customer_reward_fraud_flags from anon,authenticated;
grant execute on function public.set_customer_date_of_birth(date) to authenticated;
grant execute on function public.platform_set_customer_date_of_birth(uuid,date,text) to authenticated;
grant execute on function public.get_customer_age_eligibility(uuid) to anon,authenticated;
grant execute on function public.save_restaurant_alcohol_setting(boolean) to authenticated;
grant execute on function public.save_restaurant_birthday_program(boolean,text,integer,uuid,integer,integer,text[],text) to authenticated;
grant execute on function public.save_restaurant_milestone_program(uuid,text,text,integer,boolean,text,integer,uuid,integer,integer,text[],text) to authenticated;
grant execute on function public.delete_restaurant_milestone_program(uuid) to authenticated;
