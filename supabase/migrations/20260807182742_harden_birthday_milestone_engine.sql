create table if not exists public.customer_reward_issuance_events (
  id uuid primary key default gen_random_uuid(),
  reward_issuance_id uuid not null references public.customer_reward_issuances(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  old_status text,
  new_status text,
  actor_kind text not null default 'system' check (actor_kind in ('system','customer','restaurant_staff','platform_admin')),
  actor_user_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists customer_reward_issuance_events_issuance_idx on public.customer_reward_issuance_events(reward_issuance_id,created_at);
create index if not exists customer_reward_issuance_events_restaurant_idx on public.customer_reward_issuance_events(restaurant_id,created_at desc);
alter table public.customer_reward_issuance_events enable row level security;
revoke all on public.customer_reward_issuance_events from anon,authenticated;

create or replace function private.guard_customer_profile_dob()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    if (new.date_of_birth is not null or new.date_of_birth_set_at is not null or coalesce(new.date_of_birth_change_count,0)<>0 or new.date_of_birth_last_changed_at is not null)
       and coalesce(current_setting('app.allow_dob_change',true),'') <> '1' then
      raise exception 'Date of birth must be set through the secure date-of-birth RPC' using errcode='42501';
    end if;
  elsif new.date_of_birth is distinct from old.date_of_birth
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
create trigger guard_customer_profile_dob before insert or update on public.customer_profiles for each row execute function private.guard_customer_profile_dob();

create or replace function private.queue_campaign_notification(p_issuance_id uuid,p_event_type text,p_title text,p_body text)
returns void language plpgsql security definer set search_path='' as $$
declare rw public.customer_reward_issuances%rowtype;
begin
  select * into rw from public.customer_reward_issuances where id=p_issuance_id;
  if not found then return; end if;
  if not exists(
    select 1 from public.customer_notifications n
    where n.customer_user_id=rw.customer_user_id
      and n.notification_type=p_event_type
      and n.metadata->>'reward_issuance_id'=rw.id::text
  ) then
    insert into public.customer_notifications(customer_user_id,restaurant_id,notification_type,title,body,action_url,metadata)
    values(rw.customer_user_id,rw.restaurant_id,p_event_type,p_title,p_body,'/account/milestones',jsonb_build_object('reward_issuance_id',rw.id,'source_type',rw.source_type,'source_id',rw.source_id));
  end if;
  insert into public.reward_notification_queue(reward_issuance_id,restaurant_id,customer_user_id,event_type,subject,body,push_payload)
  values(rw.id,rw.restaurant_id,rw.customer_user_id,p_event_type,p_title,p_body,jsonb_build_object('type',p_event_type,'reward_issuance_id',rw.id,'action_url','/account/milestones'))
  on conflict(reward_issuance_id,event_type) do nothing;
end $$;

create or replace function private.ensure_birthday_reward(p_program_id uuid,p_customer_user_id uuid,p_year integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare prog public.restaurant_birthday_programs%rowtype; issuance_id uuid; dob date; year_key text;
begin
  select * into prog from public.restaurant_birthday_programs where id=p_program_id and is_enabled and not disabled_by_platform;
  if not found then return null; end if;
  select date_of_birth into dob from public.customer_profiles where user_id=p_customer_user_id;
  if dob is null then return null; end if;
  year_key:=p_year::text;
  insert into public.customer_reward_issuances(restaurant_id,customer_user_id,source_type,source_id,source_key,reward_type,reward_value,reward_catalogue_id,expires_at,metadata)
  values(prog.restaurant_id,p_customer_user_id,'birthday',prog.id,year_key,prog.reward_type,prog.reward_value,prog.reward_catalogue_id,now()+make_interval(days=>prog.validity_days),jsonb_build_object('campaign_message',prog.campaign_message,'date_of_birth_month',extract(month from dob),'date_of_birth_day',extract(day from dob),'fulfilment_methods',prog.fulfilment_methods,'minimum_spend_pence',prog.minimum_spend_pence))
  on conflict(restaurant_id,customer_user_id,source_type,source_id,source_key) do nothing returning id into issuance_id;
  if issuance_id is null then
    select i.id into issuance_id from public.customer_reward_issuances i
    where i.restaurant_id=prog.restaurant_id and i.customer_user_id=p_customer_user_id and i.source_type='birthday' and i.source_id=prog.id and i.source_key=year_key;
  end if;
  perform private.issue_campaign_reward(issuance_id);
  perform private.queue_campaign_notification(issuance_id,'happy_birthday','Happy Birthday!',prog.campaign_message);
  return issuance_id;
end $$;

create or replace function private.audit_reward_issuance_changes()
returns trigger language plpgsql security definer set search_path='' as $$
declare kind text:='system'; uid uuid:=auth.uid();
begin
  if uid is not null then
    if private.has_platform_admin_permission('overview:view') then kind:='platform_admin';
    elsif exists(select 1 from public.restaurant_members rm where rm.user_id=uid and rm.restaurant_id=coalesce(new.restaurant_id,old.restaurant_id)) then kind:='restaurant_staff';
    else kind:='customer'; end if;
  end if;
  if tg_op='INSERT' then
    insert into public.customer_reward_issuance_events(reward_issuance_id,restaurant_id,customer_user_id,event_type,new_status,actor_kind,actor_user_id,details)
    values(new.id,new.restaurant_id,new.customer_user_id,'created',new.status,kind,uid,jsonb_build_object('source_type',new.source_type,'source_id',new.source_id,'source_key',new.source_key,'reward_type',new.reward_type,'reward_value',new.reward_value));
  elsif new.status is distinct from old.status then
    insert into public.customer_reward_issuance_events(reward_issuance_id,restaurant_id,customer_user_id,event_type,old_status,new_status,actor_kind,actor_user_id,details)
    values(new.id,new.restaurant_id,new.customer_user_id,'status_changed',old.status,new.status,kind,uid,jsonb_build_object('voucher_id',new.voucher_id,'loyalty_ledger_id',new.loyalty_ledger_id,'redemption_order_id',new.redemption_order_id));
  end if;
  return new;
end $$;
drop trigger if exists audit_reward_issuance_changes on public.customer_reward_issuances;
create trigger audit_reward_issuance_changes after insert or update on public.customer_reward_issuances for each row execute function private.audit_reward_issuance_changes();

insert into public.customer_reward_issuance_events(reward_issuance_id,restaurant_id,customer_user_id,event_type,new_status,actor_kind,details,created_at)
select i.id,i.restaurant_id,i.customer_user_id,'created',i.status,'system',jsonb_build_object('backfilled',true,'source_type',i.source_type,'source_id',i.source_id),i.created_at
from public.customer_reward_issuances i
where not exists(select 1 from public.customer_reward_issuance_events e where e.reward_issuance_id=i.id);
