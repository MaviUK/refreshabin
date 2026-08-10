create table public.restaurant_challenges (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 120),
  description text not null default '',
  icon text not null default '★',
  colour text not null default '#171615' check (colour ~ '^#[0-9A-Fa-f]{6}$'),
  banner_image_url text,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  is_active boolean not null default true,
  priority integer not null default 0,
  visibility text not null default 'public' check (visibility in ('public','members','hidden')),
  target_audience text not null default 'all' check (target_audience in ('all','vip','new','returning','birthday','referral','tier','custom')),
  target_config jsonb not null default '{}'::jsonb,
  condition_match text not null default 'all' check (condition_match in ('all','any')),
  repeatable boolean not null default false,
  repeat_period text not null default 'campaign' check (repeat_period in ('campaign','daily','weekly','monthly')),
  max_completions integer check (max_completions is null or max_completions > 0),
  platform_disabled_at timestamptz,
  platform_disabled_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create table public.restaurant_challenge_conditions (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.restaurant_challenges(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  condition_type text not null check (condition_type in (
    'order_count','total_spend','single_order_spend','consecutive_weeks','consecutive_months',
    'breakfast_orders','lunch_orders','dinner_orders','weekend_orders','weekday_orders',
    'distinct_menu_items','distinct_categories','featured_item','seasonal','holiday','vip_only',
    'referral_count','stamp_count','points_balance','points_earned','custom'
  )),
  target_value bigint not null default 1 check (target_value > 0),
  menu_item_id uuid references public.menu_items(id) on delete set null,
  category_id uuid references public.menu_categories(id) on delete set null,
  config jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.restaurant_challenge_rewards (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.restaurant_challenges(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  reward_type text not null check (reward_type in ('loyalty_points','bonus_stamps','wallet_credit','store_credit','fixed_voucher','percentage_voucher','free_delivery','free_item','vip_bonus','referral_bonus')),
  reward_value integer not null default 0 check (reward_value >= 0),
  reward_catalogue_id uuid references public.restaurant_loyalty_rewards(id) on delete set null,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  stamp_program_id uuid references public.restaurant_stamp_programs(id) on delete set null,
  validity_days integer check (validity_days is null or validity_days > 0),
  minimum_spend_pence integer not null default 0 check (minimum_spend_pence >= 0),
  config jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customer_challenge_progress (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.restaurant_challenges(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  cycle_key text not null default 'campaign',
  status text not null default 'active' check (status in ('active','completed','expired','blocked')),
  progress_percent numeric(6,2) not null default 0 check (progress_percent between 0 and 100),
  progress jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  last_progress_at timestamptz,
  completed_at timestamptz,
  estimated_completion_at timestamptz,
  completion_order_id uuid references public.orders(id) on delete set null,
  completion_number integer not null default 0 check (completion_number >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(challenge_id,customer_user_id,cycle_key)
);

create table public.challenge_progress_events (
  id uuid primary key default gen_random_uuid(),
  progress_id uuid not null references public.customer_challenge_progress(id) on delete cascade,
  challenge_id uuid not null references public.restaurant_challenges(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  event_key text not null,
  event_type text not null,
  previous_percent numeric(6,2),
  new_percent numeric(6,2),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(progress_id,event_key)
);

create table public.restaurant_achievements (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references public.restaurants(id) on delete cascade,
  achievement_key text not null,
  name text not null,
  description text not null default '',
  icon text not null default '★',
  colour text not null default '#171615' check (colour ~ '^#[0-9A-Fa-f]{6}$'),
  achievement_type text not null,
  target_value bigint not null default 1 check (target_value > 0),
  config jsonb not null default '{}'::jsonb,
  is_system_default boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index restaurant_achievements_global_key on public.restaurant_achievements(achievement_key) where restaurant_id is null;
create unique index restaurant_achievements_restaurant_key on public.restaurant_achievements(restaurant_id,achievement_key) where restaurant_id is not null;

create table public.customer_achievement_unlocks (
  id uuid primary key default gen_random_uuid(),
  achievement_id uuid not null references public.restaurant_achievements(id) on delete cascade,
  restaurant_id uuid references public.restaurants(id) on delete cascade,
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  source_order_id uuid references public.orders(id) on delete set null,
  progress_value bigint not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  unlocked_at timestamptz not null default now(),
  unique(achievement_id,restaurant_id,customer_user_id)
);

create table public.restaurant_leaderboard_settings (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  is_enabled boolean not null default false,
  metric text not null default 'points' check (metric in ('points','challenges','referrals','stamps','orders')),
  max_entries integer not null default 25 check (max_entries between 5 and 100),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.customer_gamification_preferences (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  leaderboard_visibility text not null default 'anonymous' check (leaderboard_visibility in ('nickname','anonymous','hidden')),
  nickname text check (nickname is null or length(trim(nickname)) between 2 and 30),
  updated_at timestamptz not null default now(),
  primary key(restaurant_id,customer_user_id)
);

create table public.challenge_notification_queue (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid references public.restaurant_challenges(id) on delete cascade,
  progress_id uuid references public.customer_challenge_progress(id) on delete cascade,
  achievement_id uuid references public.restaurant_achievements(id) on delete set null,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('challenge_new','challenge_starting','challenge_nearly_complete','challenge_completed','challenge_expiring','achievement_unlocked')),
  subject text not null,
  body text not null,
  action_url text not null default '/account/challenges',
  push_payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null unique,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed')),
  push_status text not null default 'pending' check (push_status in ('pending','dispatched','skipped','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.challenge_fraud_flags (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid references public.restaurant_challenges(id) on delete set null,
  progress_id uuid references public.customer_challenge_progress(id) on delete set null,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_user_id uuid references auth.users(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  flag_type text not null,
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  status text not null default 'open' check (status in ('open','reviewed','dismissed','confirmed')),
  details jsonb not null default '{}'::jsonb,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);

create table public.customer_challenge_custom_metrics (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  metric_key text not null check (metric_key ~ '^[a-z0-9_]{1,64}$'),
  metric_value bigint not null default 0 check (metric_value >= 0),
  source_key text not null,
  updated_at timestamptz not null default now(),
  primary key(restaurant_id,customer_user_id,metric_key),
  unique(restaurant_id,source_key)
);

create index restaurant_challenges_active_idx on public.restaurant_challenges(restaurant_id,is_active,starts_at,ends_at,priority desc);
create index challenge_conditions_challenge_idx on public.restaurant_challenge_conditions(challenge_id,sort_order);
create index challenge_rewards_challenge_idx on public.restaurant_challenge_rewards(challenge_id,sort_order);
create index customer_challenge_progress_customer_idx on public.customer_challenge_progress(customer_user_id,status,updated_at desc);
create index customer_challenge_progress_restaurant_idx on public.customer_challenge_progress(restaurant_id,challenge_id,status);
create index challenge_progress_events_order_idx on public.challenge_progress_events(order_id) where order_id is not null;
create index challenge_progress_events_customer_idx on public.challenge_progress_events(customer_user_id,created_at desc);
create index achievement_unlock_customer_idx on public.customer_achievement_unlocks(customer_user_id,unlocked_at desc);
create index challenge_notifications_due_idx on public.challenge_notification_queue(status,available_at,created_at) where status in ('pending','failed');
create index challenge_fraud_open_idx on public.challenge_fraud_flags(status,severity,created_at desc) where status='open';

alter table public.restaurant_challenges enable row level security;
alter table public.restaurant_challenge_conditions enable row level security;
alter table public.restaurant_challenge_rewards enable row level security;
alter table public.customer_challenge_progress enable row level security;
alter table public.challenge_progress_events enable row level security;
alter table public.restaurant_achievements enable row level security;
alter table public.customer_achievement_unlocks enable row level security;
alter table public.restaurant_leaderboard_settings enable row level security;
alter table public.customer_gamification_preferences enable row level security;
alter table public.challenge_notification_queue enable row level security;
alter table public.challenge_fraud_flags enable row level security;
alter table public.customer_challenge_custom_metrics enable row level security;
revoke all on public.restaurant_challenges,public.restaurant_challenge_conditions,public.restaurant_challenge_rewards,public.customer_challenge_progress,public.challenge_progress_events,public.restaurant_achievements,public.customer_achievement_unlocks,public.restaurant_leaderboard_settings,public.customer_gamification_preferences,public.challenge_notification_queue,public.challenge_fraud_flags,public.customer_challenge_custom_metrics from anon,authenticated;

insert into public.restaurant_achievements(restaurant_id,achievement_key,name,description,icon,colour,achievement_type,target_value,is_system_default)
values
(null,'first_order','First Order','Placed your first completed order.','★','#9B111E','orders',1,true),
(null,'regular_customer','Regular Customer','Completed 10 orders.','↻','#7A542E','orders',10,true),
(null,'weekend_warrior','Weekend Warrior','Completed 5 weekend orders.','☀','#A05A2C','weekend_orders',5,true),
(null,'breakfast_club','Breakfast Club','Completed 5 breakfast orders.','☕','#8A5A44','breakfast_orders',5,true),
(null,'lunch_hero','Lunch Hero','Completed 10 lunch orders.','◐','#66804A','lunch_orders',10,true),
(null,'dinner_expert','Dinner Expert','Completed 10 dinner orders.','☾','#4A5568','dinner_orders',10,true),
(null,'explorer','Explorer','Tried 20 different menu items.','⌖','#2F6F73','distinct_items',20,true),
(null,'vip_member','VIP Member','Reached a VIP tier.','✦','#805AD5','vip_member',1,true),
(null,'referral_champion','Referral Champion','Qualified 5 referrals.','↗','#2B6CB0','referrals',5,true),
(null,'stamp_collector','Stamp Collector','Collected 25 stamps.','●','#B7791F','stamps',25,true),
(null,'high_roller','High Roller','Spent £500 at one restaurant.','£','#276749','spend',50000,true),
(null,'local_legend','Local Legend','Completed 50 orders at one restaurant.','♛','#9B111E','orders',50,true)
on conflict do nothing;

create or replace function private.challenge_restaurant_id(p_manage boolean default false)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare rid uuid;
begin
  if p_manage then select restaurant_id into rid from public.restaurant_members where user_id=auth.uid() and role::text in ('owner','manager') order by created_at limit 1;
  else select restaurant_id into rid from public.restaurant_members where user_id=auth.uid() order by created_at limit 1; end if;
  if rid is null then raise exception 'Restaurant access required' using errcode='42501'; end if;
  return rid;
end $$;

create or replace function private.challenge_cycle_key(p_challenge public.restaurant_challenges,p_at timestamptz)
returns text language sql immutable set search_path='' as $$
  select case when not p_challenge.repeatable or p_challenge.repeat_period='campaign' then 'campaign' when p_challenge.repeat_period='daily' then to_char(p_at at time zone 'UTC','YYYY-MM-DD') when p_challenge.repeat_period='weekly' then to_char(p_at at time zone 'UTC','IYYY-"W"IW') else to_char(p_at at time zone 'UTC','YYYY-MM') end
$$;

create or replace function public.save_restaurant_challenge(p_challenge_id uuid,p_name text,p_description text,p_icon text,p_colour text,p_banner_image_url text,p_starts_at timestamptz,p_ends_at timestamptz,p_is_active boolean,p_priority integer,p_visibility text,p_target_audience text,p_target_config jsonb,p_condition_match text,p_repeatable boolean,p_repeat_period text,p_max_completions integer,p_conditions jsonb,p_rewards jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid:=private.challenge_restaurant_id(true); cid uuid:=p_challenge_id; item jsonb; catalog uuid; rtype text; rv integer;
begin
  if nullif(trim(p_name),'') is null then raise exception 'Challenge name is required'; end if;
  if p_ends_at is not null and p_ends_at<=p_starts_at then raise exception 'End date must be after start date'; end if;
  if jsonb_typeof(coalesce(p_conditions,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_conditions,'[]'::jsonb))=0 then raise exception 'Add at least one challenge condition'; end if;
  if jsonb_typeof(coalesce(p_rewards,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_rewards,'[]'::jsonb))=0 then raise exception 'Add at least one challenge reward'; end if;
  if cid is null then
    insert into public.restaurant_challenges(restaurant_id,name,description,icon,colour,banner_image_url,starts_at,ends_at,is_active,priority,visibility,target_audience,target_config,condition_match,repeatable,repeat_period,max_completions,created_by)
    values(rid,trim(p_name),coalesce(p_description,''),coalesce(nullif(trim(p_icon),''),'★'),coalesce(nullif(trim(p_colour),''),'#171615'),nullif(trim(p_banner_image_url),''),p_starts_at,p_ends_at,coalesce(p_is_active,true),coalesce(p_priority,0),coalesce(p_visibility,'public'),coalesce(p_target_audience,'all'),coalesce(p_target_config,'{}'::jsonb),coalesce(p_condition_match,'all'),coalesce(p_repeatable,false),coalesce(p_repeat_period,'campaign'),p_max_completions,auth.uid()) returning id into cid;
  else
    update public.restaurant_challenges set name=trim(p_name),description=coalesce(p_description,''),icon=coalesce(nullif(trim(p_icon),''),'★'),colour=coalesce(nullif(trim(p_colour),''),'#171615'),banner_image_url=nullif(trim(p_banner_image_url),''),starts_at=p_starts_at,ends_at=p_ends_at,is_active=coalesce(p_is_active,true),priority=coalesce(p_priority,0),visibility=coalesce(p_visibility,'public'),target_audience=coalesce(p_target_audience,'all'),target_config=coalesce(p_target_config,'{}'::jsonb),condition_match=coalesce(p_condition_match,'all'),repeatable=coalesce(p_repeatable,false),repeat_period=coalesce(p_repeat_period,'campaign'),max_completions=p_max_completions,updated_at=now() where id=cid and restaurant_id=rid and platform_disabled_at is null;
    if not found then raise exception 'Challenge not found or platform disabled'; end if;
    delete from public.restaurant_challenge_conditions where challenge_id=cid;
    delete from public.restaurant_challenge_rewards where challenge_id=cid;
  end if;
  for item in select value from jsonb_array_elements(p_conditions) loop
    insert into public.restaurant_challenge_conditions(challenge_id,restaurant_id,condition_type,target_value,menu_item_id,category_id,config,sort_order)
    values(cid,rid,item->>'condition_type',greatest(coalesce((item->>'target_value')::bigint,1),1),nullif(item->>'menu_item_id','')::uuid,nullif(item->>'category_id','')::uuid,coalesce(item->'config','{}'::jsonb),coalesce((item->>'sort_order')::integer,0));
  end loop;
  for item in select value from jsonb_array_elements(p_rewards) loop
    rtype:=item->>'reward_type'; rv:=greatest(coalesce((item->>'reward_value')::integer,0),0); catalog:=null;
    if rtype in ('fixed_voucher','percentage_voucher','free_delivery','free_item') then catalog:=private.sync_campaign_catalogue_reward(rid,null,trim(p_name)||' challenge reward',case rtype when 'fixed_voucher' then 'fixed_discount' when 'percentage_voucher' then 'percentage_discount' else rtype end,rv,nullif(item->>'menu_item_id','')::uuid,coalesce((item->>'minimum_spend_pence')::integer,0),array['delivery','collection']); end if;
    if rtype='bonus_stamps' and nullif(item->>'stamp_program_id','') is null then raise exception 'Bonus stamp rewards need a stamp programme'; end if;
    if rtype='free_item' and nullif(item->>'menu_item_id','') is null then raise exception 'Free item rewards need a menu item'; end if;
    insert into public.restaurant_challenge_rewards(challenge_id,restaurant_id,reward_type,reward_value,reward_catalogue_id,menu_item_id,stamp_program_id,validity_days,minimum_spend_pence,config,sort_order)
    values(cid,rid,rtype,rv,catalog,nullif(item->>'menu_item_id','')::uuid,nullif(item->>'stamp_program_id','')::uuid,nullif(item->>'validity_days','')::integer,coalesce((item->>'minimum_spend_pence')::integer,0),coalesce(item->'config','{}'::jsonb),coalesce((item->>'sort_order')::integer,0));
  end loop;
  return cid;
end $$;

create or replace function public.clone_restaurant_challenge(p_challenge_id uuid,p_name text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid:=private.challenge_restaurant_id(true); src public.restaurant_challenges%rowtype; cid uuid;
begin
  select * into src from public.restaurant_challenges where id=p_challenge_id and restaurant_id=rid;
  if not found then raise exception 'Challenge not found'; end if;
  insert into public.restaurant_challenges(restaurant_id,name,description,icon,colour,banner_image_url,starts_at,ends_at,is_active,priority,visibility,target_audience,target_config,condition_match,repeatable,repeat_period,max_completions,created_by)
  values(rid,coalesce(nullif(trim(p_name),''),src.name||' copy'),src.description,src.icon,src.colour,src.banner_image_url,greatest(src.starts_at,now()),case when src.ends_at is null then null else greatest(src.ends_at,now()+interval '1 day') end,false,src.priority,src.visibility,src.target_audience,src.target_config,src.condition_match,src.repeatable,src.repeat_period,src.max_completions,auth.uid()) returning id into cid;
  insert into public.restaurant_challenge_conditions(challenge_id,restaurant_id,condition_type,target_value,menu_item_id,category_id,config,sort_order) select cid,rid,condition_type,target_value,menu_item_id,category_id,config,sort_order from public.restaurant_challenge_conditions where challenge_id=src.id;
  insert into public.restaurant_challenge_rewards(challenge_id,restaurant_id,reward_type,reward_value,reward_catalogue_id,menu_item_id,stamp_program_id,validity_days,minimum_spend_pence,config,sort_order) select cid,rid,reward_type,reward_value,reward_catalogue_id,menu_item_id,stamp_program_id,validity_days,minimum_spend_pence,config,sort_order from public.restaurant_challenge_rewards where challenge_id=src.id;
  return cid;
end $$;

create or replace function public.delete_restaurant_challenge(p_challenge_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare rid uuid:=private.challenge_restaurant_id(true);
begin
  if exists(select 1 from public.customer_challenge_progress where challenge_id=p_challenge_id) then update public.restaurant_challenges set is_active=false,updated_at=now() where id=p_challenge_id and restaurant_id=rid;
  else delete from public.restaurant_challenges where id=p_challenge_id and restaurant_id=rid; end if;
end $$;

create or replace function public.save_restaurant_achievement(p_achievement_id uuid,p_name text,p_description text,p_icon text,p_colour text,p_achievement_type text,p_target_value bigint,p_config jsonb,p_is_active boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid:=private.challenge_restaurant_id(true); aid uuid:=p_achievement_id; key text;
begin
  if nullif(trim(p_name),'') is null then raise exception 'Achievement name is required'; end if;
  key:=lower(regexp_replace(trim(p_name),'[^a-zA-Z0-9]+','_','g'))||'_'||substr(replace(gen_random_uuid()::text,'-',''),1,8);
  if aid is null then insert into public.restaurant_achievements(restaurant_id,achievement_key,name,description,icon,colour,achievement_type,target_value,config,is_active,created_by) values(rid,key,trim(p_name),coalesce(p_description,''),coalesce(nullif(trim(p_icon),''),'★'),coalesce(nullif(trim(p_colour),''),'#171615'),p_achievement_type,greatest(p_target_value,1),coalesce(p_config,'{}'::jsonb),coalesce(p_is_active,true),auth.uid()) returning id into aid;
  else update public.restaurant_achievements set name=trim(p_name),description=coalesce(p_description,''),icon=coalesce(nullif(trim(p_icon),''),'★'),colour=coalesce(nullif(trim(p_colour),''),'#171615'),achievement_type=p_achievement_type,target_value=greatest(p_target_value,1),config=coalesce(p_config,'{}'::jsonb),is_active=coalesce(p_is_active,true),updated_at=now() where id=aid and restaurant_id=rid and not is_system_default; if not found then raise exception 'Custom achievement not found'; end if; end if;
  return aid;
end $$;

create or replace function public.save_restaurant_leaderboard_settings(p_enabled boolean,p_metric text,p_max_entries integer)
returns void language plpgsql security definer set search_path='' as $$
declare rid uuid:=private.challenge_restaurant_id(true);
begin insert into public.restaurant_leaderboard_settings(restaurant_id,is_enabled,metric,max_entries,updated_by) values(rid,p_enabled,p_metric,least(greatest(p_max_entries,5),100),auth.uid()) on conflict(restaurant_id) do update set is_enabled=excluded.is_enabled,metric=excluded.metric,max_entries=excluded.max_entries,updated_by=auth.uid(),updated_at=now(); end $$;

create or replace function public.save_customer_gamification_preferences(p_restaurant_id uuid,p_visibility text,p_nickname text)
returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();
begin if uid is null then raise exception 'Authentication required' using errcode='42501'; end if; insert into public.customer_gamification_preferences(restaurant_id,customer_user_id,leaderboard_visibility,nickname) values(p_restaurant_id,uid,p_visibility,nullif(trim(p_nickname),'')) on conflict(restaurant_id,customer_user_id) do update set leaderboard_visibility=excluded.leaderboard_visibility,nickname=excluded.nickname,updated_at=now(); end $$;

revoke all on function public.save_restaurant_challenge(uuid,text,text,text,text,text,timestamptz,timestamptz,boolean,integer,text,text,jsonb,text,boolean,text,integer,jsonb,jsonb) from public;
grant execute on function public.save_restaurant_challenge(uuid,text,text,text,text,text,timestamptz,timestamptz,boolean,integer,text,text,jsonb,text,boolean,text,integer,jsonb,jsonb) to authenticated;
revoke all on function public.clone_restaurant_challenge(uuid,text) from public; grant execute on function public.clone_restaurant_challenge(uuid,text) to authenticated;
revoke all on function public.delete_restaurant_challenge(uuid) from public; grant execute on function public.delete_restaurant_challenge(uuid) to authenticated;
revoke all on function public.save_restaurant_achievement(uuid,text,text,text,text,text,bigint,jsonb,boolean) from public; grant execute on function public.save_restaurant_achievement(uuid,text,text,text,text,text,bigint,jsonb,boolean) to authenticated;
revoke all on function public.save_restaurant_leaderboard_settings(boolean,text,integer) from public; grant execute on function public.save_restaurant_leaderboard_settings(boolean,text,integer) to authenticated;
revoke all on function public.save_customer_gamification_preferences(uuid,text,text) from public; grant execute on function public.save_customer_gamification_preferences(uuid,text,text) to authenticated;
