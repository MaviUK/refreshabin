create table public.restaurant_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 160),
  slug text not null unique check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  group_type text not null check (group_type in ('parent_company','franchise_group','independent_chain','corporate_ownership')),
  status text not null default 'active' check (status in ('active','suspended','archived')),
  default_currency text not null default 'GBP' check (default_currency ~ '^[A-Z]{3}$'),
  supported_currencies text[] not null default array['GBP']::text[],
  countries text[] not null default array['GB']::text[],
  enterprise_plan_code text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.restaurant_group_brands (
  id uuid primary key default gen_random_uuid(), group_id uuid not null references public.restaurant_groups(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 160), slug text not null check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  status text not null default 'active' check (status in ('active','suspended','archived')), logo_url text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(group_id,slug)
);
create table public.restaurant_group_regions (
  id uuid primary key default gen_random_uuid(), group_id uuid not null references public.restaurant_groups(id) on delete cascade,
  brand_id uuid references public.restaurant_group_brands(id) on delete cascade, parent_region_id uuid references public.restaurant_group_regions(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 160), code text, country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  default_currency text check (default_currency is null or default_currency ~ '^[A-Z]{3}$'), status text not null default 'active' check (status in ('active','suspended','archived')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(group_id,brand_id,name), check (parent_region_id is null or parent_region_id <> id)
);
create table public.restaurant_group_locations (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade, group_id uuid not null references public.restaurant_groups(id) on delete cascade,
  brand_id uuid references public.restaurant_group_brands(id) on delete set null, region_id uuid references public.restaurant_group_regions(id) on delete set null,
  status text not null default 'active' check (status in ('active','suspended','merged','transferred')), currency text not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  country_code text not null default 'GB' check (country_code ~ '^[A-Z]{2}$'), merged_into_restaurant_id uuid references public.restaurants(id) on delete set null,
  joined_at timestamptz not null default now(), updated_at timestamptz not null default now(), check (merged_into_restaurant_id is null or merged_into_restaurant_id <> restaurant_id)
);
create table public.restaurant_group_departments (
  id uuid primary key default gen_random_uuid(), group_id uuid not null references public.restaurant_groups(id) on delete cascade,
  restaurant_id uuid references public.restaurants(id) on delete cascade, parent_department_id uuid references public.restaurant_group_departments(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 160), department_type text not null default 'custom', metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check (parent_department_id is null or parent_department_id <> id)
);
create table public.restaurant_group_roles (
  id uuid primary key default gen_random_uuid(), group_id uuid not null references public.restaurant_groups(id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_:-]+$'), name text not null, permissions jsonb not null default '{}'::jsonb check (jsonb_typeof(permissions)='object'),
  is_system boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(group_id,key)
);
create table public.restaurant_group_members (
  id uuid primary key default gen_random_uuid(), group_id uuid not null references public.restaurant_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, role_id uuid not null references public.restaurant_group_roles(id) on delete restrict,
  scope_type text not null default 'group' check (scope_type in ('group','brand','region','restaurant','department')),
  brand_id uuid references public.restaurant_group_brands(id) on delete cascade, region_id uuid references public.restaurant_group_regions(id) on delete cascade,
  restaurant_id uuid references public.restaurants(id) on delete cascade, department_id uuid references public.restaurant_group_departments(id) on delete cascade,
  permissions jsonb not null default '{}'::jsonb check (jsonb_typeof(permissions)='object'), status text not null default 'active' check (status in ('active','suspended','revoked')),
  invited_by uuid references auth.users(id) on delete set null, last_active_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check ((scope_type='group' and brand_id is null and region_id is null and restaurant_id is null and department_id is null)
    or (scope_type='brand' and brand_id is not null and region_id is null and restaurant_id is null and department_id is null)
    or (scope_type='region' and region_id is not null and restaurant_id is null and department_id is null)
    or (scope_type='restaurant' and restaurant_id is not null and department_id is null)
    or (scope_type='department' and department_id is not null))
);
create unique index restaurant_group_members_scope_uniq on public.restaurant_group_members(group_id,user_id,role_id,scope_type,
  coalesce(brand_id,'00000000-0000-0000-0000-000000000000'::uuid),coalesce(region_id,'00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(restaurant_id,'00000000-0000-0000-0000-000000000000'::uuid),coalesce(department_id,'00000000-0000-0000-0000-000000000000'::uuid)) where status <> 'revoked';
create table public.restaurant_group_sharing_settings (
  group_id uuid primary key references public.restaurant_groups(id) on delete cascade,
  loyalty_scope text not null default 'restaurant' check (loyalty_scope in ('group','brand','region','restaurant')),
  wallet_scope text not null default 'restaurant' check (wallet_scope in ('group','brand','region','restaurant')),
  rewards_scope text not null default 'restaurant' check (rewards_scope in ('group','brand','region','restaurant')),
  gift_cards_scope text not null default 'restaurant' check (gift_cards_scope in ('group','brand','region','restaurant')),
  referrals_scope text not null default 'restaurant' check (referrals_scope in ('group','brand','region','restaurant')),
  vip_scope text not null default 'restaurant' check (vip_scope in ('group','brand','region','restaurant')),
  stamp_cards_scope text not null default 'restaurant' check (stamp_cards_scope in ('group','brand','region','restaurant')),
  crm_scope text not null default 'group' check (crm_scope in ('group','brand','region','restaurant')), updated_by uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now()
);
create table public.restaurant_group_enterprise_settings (
  group_id uuid primary key references public.restaurant_groups(id) on delete cascade, corporate_brand_name text, logo_url text, primary_colour text, white_label_domain text,
  support_email text, central_notifications_enabled boolean not null default true, shared_customer_support boolean not null default false, api_enabled boolean not null default false,
  branding jsonb not null default '{}'::jsonb check (jsonb_typeof(branding)='object'), support_config jsonb not null default '{}'::jsonb check (jsonb_typeof(support_config)='object'),
  updated_by uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now()
);
create table public.restaurant_group_api_keys (
  id uuid primary key default gen_random_uuid(), group_id uuid not null references public.restaurant_groups(id) on delete cascade, name text not null,
  key_prefix text not null, key_hash text not null unique, scopes text[] not null default array[]::text[], status text not null default 'active' check (status in ('active','revoked')),
  last_used_at timestamptz, expires_at timestamptz, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), revoked_at timestamptz
);
create table public.restaurant_group_integrations (
  id uuid primary key default gen_random_uuid(), group_id uuid not null references public.restaurant_groups(id) on delete cascade,
  integration_type text not null, name text not null, status text not null default 'active' check (status in ('active','disabled','error')),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config)='object'), secret_reference text, last_synced_at timestamptz,
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.restaurant_group_audit_log (
  id bigint generated always as identity primary key, group_id uuid not null references public.restaurant_groups(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null, actor_kind text not null default 'user' check (actor_kind in ('user','platform_admin','service','impersonation')),
  action text not null, target_type text not null, target_id uuid, reason text, details jsonb not null default '{}'::jsonb check (jsonb_typeof(details)='object'), ip_address inet, created_at timestamptz not null default now()
);
create table public.restaurant_group_impersonation_sessions (
  id uuid primary key default gen_random_uuid(), group_id uuid not null references public.restaurant_groups(id) on delete cascade,
  admin_user_id uuid not null references auth.users(id) on delete restrict, target_user_id uuid references auth.users(id) on delete set null,
  target_restaurant_id uuid references public.restaurants(id) on delete set null, reason text not null check (length(btrim(reason)) >= 5),
  started_at timestamptz not null default now(), ended_at timestamptz, metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'), check (ended_at is null or ended_at >= started_at)
);
create index restaurant_group_brands_group_idx on public.restaurant_group_brands(group_id,status);
create index restaurant_group_regions_group_brand_idx on public.restaurant_group_regions(group_id,brand_id,status);
create index restaurant_group_regions_parent_idx on public.restaurant_group_regions(parent_region_id) where parent_region_id is not null;
create index restaurant_group_locations_group_idx on public.restaurant_group_locations(group_id,status,restaurant_id);
create index restaurant_group_locations_brand_idx on public.restaurant_group_locations(group_id,brand_id,restaurant_id) where brand_id is not null;
create index restaurant_group_locations_region_idx on public.restaurant_group_locations(group_id,region_id,restaurant_id) where region_id is not null;
create index restaurant_group_departments_restaurant_idx on public.restaurant_group_departments(group_id,restaurant_id) where restaurant_id is not null;
create index restaurant_group_members_user_idx on public.restaurant_group_members(user_id,status,group_id);
create index restaurant_group_members_group_scope_idx on public.restaurant_group_members(group_id,scope_type,status);
create index restaurant_group_audit_log_group_time_idx on public.restaurant_group_audit_log(group_id,created_at desc);
create index restaurant_group_audit_log_target_idx on public.restaurant_group_audit_log(group_id,target_type,target_id,created_at desc);
create index restaurant_group_impersonation_open_idx on public.restaurant_group_impersonation_sessions(group_id,started_at desc) where ended_at is null;
create or replace function private.restaurant_group_region_contains(p_ancestor uuid,p_descendant uuid) returns boolean language sql stable security definer set search_path='' as $$
  with recursive lineage as (select r.id,r.parent_region_id from public.restaurant_group_regions r where r.id=p_descendant union all
    select parent.id,parent.parent_region_id from public.restaurant_group_regions parent join lineage child on child.parent_region_id=parent.id)
  select exists(select 1 from lineage where id=p_ancestor)
$$;
create or replace function private.restaurant_group_member_permission(p_group_id uuid,p_permission text,p_restaurant_id uuid default null,p_brand_id uuid default null,p_region_id uuid default null)
returns boolean language sql stable security definer set search_path='' as $$
  with target as (select p_group_id group_id,coalesce(p_brand_id,l.brand_id) brand_id,coalesce(p_region_id,l.region_id) region_id,p_restaurant_id restaurant_id
    from (values(1)) v(x) left join public.restaurant_group_locations l on l.restaurant_id=p_restaurant_id and l.group_id=p_group_id)
  select coalesce(bool_or((m.permissions ? p_permission or r.permissions ? p_permission) and (m.scope_type='group'
      or (m.scope_type='brand' and m.brand_id=t.brand_id)
      or (m.scope_type='region' and t.region_id is not null and private.restaurant_group_region_contains(m.region_id,t.region_id))
      or (m.scope_type='restaurant' and m.restaurant_id=t.restaurant_id)
      or (m.scope_type='department' and exists(select 1 from public.restaurant_group_departments d where d.id=m.department_id and d.group_id=p_group_id and (t.restaurant_id is null or d.restaurant_id=t.restaurant_id))))),false)
  from public.restaurant_group_members m join public.restaurant_group_roles r on r.id=m.role_id and r.group_id=m.group_id cross join target t
  where m.group_id=p_group_id and m.user_id=(select auth.uid()) and m.status='active'
$$;
create or replace function private.restaurant_group_member_of(p_group_id uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.restaurant_group_members m where m.group_id=p_group_id and m.user_id=(select auth.uid()) and m.status='active')
$$;
create or replace function private.restaurant_group_for_restaurant(p_restaurant_id uuid) returns uuid language sql stable security definer set search_path='' as $$
  select l.group_id from public.restaurant_group_locations l where l.restaurant_id=p_restaurant_id and l.status in ('active','suspended') limit 1
$$;
create or replace function private.restaurant_group_validate_scope() returns trigger language plpgsql set search_path='' as $$
declare v_group uuid;
begin
  select group_id into v_group from public.restaurant_group_roles where id=new.role_id;
  if v_group is distinct from new.group_id then raise exception 'Role does not belong to organisation'; end if;
  if new.brand_id is not null and not exists(select 1 from public.restaurant_group_brands b where b.id=new.brand_id and b.group_id=new.group_id) then raise exception 'Brand does not belong to organisation'; end if;
  if new.region_id is not null and not exists(select 1 from public.restaurant_group_regions r where r.id=new.region_id and r.group_id=new.group_id) then raise exception 'Region does not belong to organisation'; end if;
  if new.restaurant_id is not null and not exists(select 1 from public.restaurant_group_locations l where l.restaurant_id=new.restaurant_id and l.group_id=new.group_id) then raise exception 'Restaurant does not belong to organisation'; end if;
  if new.department_id is not null and not exists(select 1 from public.restaurant_group_departments d where d.id=new.department_id and d.group_id=new.group_id) then raise exception 'Department does not belong to organisation'; end if;
  return new;
end $$;
create trigger restaurant_group_members_validate before insert or update on public.restaurant_group_members for each row execute function private.restaurant_group_validate_scope();
create or replace function private.restaurant_group_validate_region() returns trigger language plpgsql set search_path='' as $$
begin
  if new.brand_id is not null and not exists(select 1 from public.restaurant_group_brands b where b.id=new.brand_id and b.group_id=new.group_id) then raise exception 'Brand does not belong to organisation'; end if;
  if new.parent_region_id is not null and not exists(select 1 from public.restaurant_group_regions r where r.id=new.parent_region_id and r.group_id=new.group_id) then raise exception 'Parent region does not belong to organisation'; end if;
  return new;
end $$;
create trigger restaurant_group_regions_validate before insert or update on public.restaurant_group_regions for each row execute function private.restaurant_group_validate_region();
create or replace function private.restaurant_group_validate_location() returns trigger language plpgsql set search_path='' as $$
begin
  if new.brand_id is not null and not exists(select 1 from public.restaurant_group_brands b where b.id=new.brand_id and b.group_id=new.group_id) then raise exception 'Brand does not belong to organisation'; end if;
  if new.region_id is not null and not exists(select 1 from public.restaurant_group_regions r where r.id=new.region_id and r.group_id=new.group_id and (r.brand_id is null or new.brand_id is null or r.brand_id=new.brand_id)) then raise exception 'Region does not belong to organisation or brand'; end if;
  return new;
end $$;
create trigger restaurant_group_locations_validate before insert or update on public.restaurant_group_locations for each row execute function private.restaurant_group_validate_location();
create or replace function private.restaurant_group_seed_roles(p_group_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  insert into public.restaurant_group_roles(group_id,key,name,is_system,permissions) values
  (p_group_id,'corporate_admin','Corporate Admin',true,'{"organisation:view":true,"organisation:manage":true,"locations:view":true,"locations:manage":true,"crm:view":true,"marketing:view":true,"marketing:manage":true,"menu:view":true,"menu:manage":true,"pricing:view":true,"pricing:manage":true,"staff:view":true,"staff:manage":true,"finance:view":true,"analytics:view":true,"loyalty:view":true,"loyalty:manage":true,"notifications:view":true,"notifications:manage":true,"audit:view":true,"enterprise:manage":true}'::jsonb),
  (p_group_id,'regional_manager','Regional Manager',true,'{"organisation:view":true,"locations:view":true,"locations:manage":true,"crm:view":true,"marketing:view":true,"marketing:manage":true,"menu:view":true,"menu:manage":true,"pricing:view":true,"pricing:manage":true,"staff:view":true,"staff:manage":true,"finance:view":true,"analytics:view":true,"loyalty:view":true,"notifications:view":true}'::jsonb),
  (p_group_id,'brand_manager','Brand Manager',true,'{"organisation:view":true,"locations:view":true,"locations:manage":true,"crm:view":true,"marketing:view":true,"marketing:manage":true,"menu:view":true,"menu:manage":true,"pricing:view":true,"pricing:manage":true,"staff:view":true,"staff:manage":true,"finance:view":true,"analytics:view":true,"loyalty:view":true,"notifications:view":true}'::jsonb),
  (p_group_id,'restaurant_owner','Restaurant Owner',true,'{"locations:view":true,"locations:manage":true,"crm:view":true,"marketing:view":true,"marketing:manage":true,"menu:view":true,"menu:manage":true,"pricing:view":true,"pricing:manage":true,"staff:view":true,"staff:manage":true,"finance:view":true,"analytics:view":true,"loyalty:view":true,"loyalty:manage":true,"notifications:view":true}'::jsonb),
  (p_group_id,'restaurant_manager','Restaurant Manager',true,'{"locations:view":true,"crm:view":true,"marketing:view":true,"menu:view":true,"menu:manage":true,"pricing:view":true,"pricing:manage":true,"staff:view":true,"analytics:view":true,"loyalty:view":true,"notifications:view":true}'::jsonb),
  (p_group_id,'kitchen','Kitchen',true,'{"locations:view":true,"menu:view":true}'::jsonb),
  (p_group_id,'marketing','Marketing',true,'{"organisation:view":true,"locations:view":true,"crm:view":true,"marketing:view":true,"marketing:manage":true,"analytics:view":true,"loyalty:view":true,"notifications:view":true,"notifications:manage":true}'::jsonb),
  (p_group_id,'finance','Finance',true,'{"organisation:view":true,"locations:view":true,"finance:view":true,"analytics:view":true}'::jsonb)
  on conflict(group_id,key) do nothing;
end $$;
create or replace function private.restaurant_group_log(p_group_id uuid,p_action text,p_target_type text,p_target_id uuid,p_reason text,p_details jsonb,p_actor_kind text default 'user')
returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.restaurant_group_audit_log(group_id,actor_user_id,actor_kind,action,target_type,target_id,reason,details)
 values(p_group_id,auth.uid(),p_actor_kind,p_action,p_target_type,p_target_id,nullif(btrim(p_reason),''),coalesce(p_details,'{}'::jsonb));
end $$;
create or replace function public.has_restaurant_group_permission(p_group_id uuid,p_permission text,p_restaurant_id uuid default null,p_brand_id uuid default null,p_region_id uuid default null)
returns boolean language sql stable security definer set search_path='' as $$ select private.restaurant_group_member_permission(p_group_id,p_permission,p_restaurant_id,p_brand_id,p_region_id) $$;
create or replace function public.get_my_restaurant_group_context() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select coalesce(jsonb_agg(x order by x->>'group_name'),'[]'::jsonb) into v_result from (
  select jsonb_build_object('group_id',g.id,'group_name',g.name,'group_slug',g.slug,'group_type',g.group_type,'status',g.status,'default_currency',g.default_currency,'countries',g.countries,
   'memberships',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'role_key',r.key,'role_name',r.name,'scope_type',m.scope_type,'brand_id',m.brand_id,'region_id',m.region_id,'restaurant_id',m.restaurant_id,'department_id',m.department_id,'permissions',r.permissions||m.permissions)) from public.restaurant_group_members m join public.restaurant_group_roles r on r.id=m.role_id where m.group_id=g.id and m.user_id=auth.uid() and m.status='active'),'[]'::jsonb),
   'locations',coalesce((select jsonb_agg(jsonb_build_object('restaurant_id',l.restaurant_id,'restaurant_name',rr.name,'brand_id',l.brand_id,'region_id',l.region_id,'status',l.status,'currency',l.currency,'country_code',l.country_code) order by rr.name) from public.restaurant_group_locations l join public.restaurants rr on rr.id=l.restaurant_id where l.group_id=g.id and l.status in ('active','suspended') and private.restaurant_group_member_permission(g.id,'locations:view',l.restaurant_id,l.brand_id,l.region_id)),'[]'::jsonb)) x
  from public.restaurant_groups g where private.restaurant_group_member_of(g.id)) q;
 return v_result;
end $$;
create or replace function public.platform_create_restaurant_group(p_name text,p_slug text,p_group_type text,p_default_currency text default 'GBP',p_countries text[] default array['GB']::text[],p_enterprise_plan_code text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if not private.platform_admin_has_permission('restaurants:manage') then raise exception 'Platform restaurant management permission required' using errcode='42501'; end if;
 insert into public.restaurant_groups(name,slug,group_type,default_currency,supported_currencies,countries,enterprise_plan_code,created_by)
 values(btrim(p_name),lower(btrim(p_slug)),p_group_type,upper(p_default_currency),array[upper(p_default_currency)],coalesce(p_countries,array['GB']::text[]),nullif(btrim(p_enterprise_plan_code),''),auth.uid()) returning id into v_id;
 perform private.restaurant_group_seed_roles(v_id); insert into public.restaurant_group_sharing_settings(group_id) values(v_id); insert into public.restaurant_group_enterprise_settings(group_id) values(v_id);
 perform private.restaurant_group_log(v_id,'organisation.created','restaurant_group',v_id,'Platform organisation creation',jsonb_build_object('name',p_name,'type',p_group_type),'platform_admin'); return v_id;
end $$;
create or replace function public.platform_manage_restaurant_group(p_group_id uuid,p_action text,p_payload jsonb default '{}'::jsonb,p_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_group public.restaurant_groups%rowtype;
begin
 if not private.platform_admin_has_permission('restaurants:manage') then raise exception 'Platform restaurant management permission required' using errcode='42501'; end if;
 select * into v_group from public.restaurant_groups where id=p_group_id for update; if not found then raise exception 'Organisation not found'; end if;
 if p_action='update' then update public.restaurant_groups set name=case when p_payload ? 'name' then btrim(p_payload->>'name') else name end,
 enterprise_plan_code=case when p_payload ? 'enterprise_plan_code' then nullif(btrim(p_payload->>'enterprise_plan_code'),'') else enterprise_plan_code end,
 default_currency=case when p_payload ? 'default_currency' then upper(p_payload->>'default_currency') else default_currency end,
 supported_currencies=case when p_payload ? 'supported_currencies' then array(select upper(jsonb_array_elements_text(p_payload->'supported_currencies'))) else supported_currencies end,
 countries=case when p_payload ? 'countries' then array(select upper(jsonb_array_elements_text(p_payload->'countries'))) else countries end,
 metadata=case when p_payload ? 'metadata' then coalesce(p_payload->'metadata','{}'::jsonb) else metadata end, updated_at=now() where id=p_group_id;
 elsif p_action='suspend' then update public.restaurant_groups set status='suspended',updated_at=now() where id=p_group_id;
 elsif p_action='resume' then update public.restaurant_groups set status='active',updated_at=now() where id=p_group_id;
 elsif p_action='archive' then update public.restaurant_groups set status='archived',updated_at=now() where id=p_group_id;
 else raise exception 'Unsupported organisation action'; end if;
 perform private.restaurant_group_log(p_group_id,'organisation.'||p_action,'restaurant_group',p_group_id,p_reason,p_payload,'platform_admin'); select * into v_group from public.restaurant_groups where id=p_group_id; return to_jsonb(v_group);
end $$;
create or replace function public.platform_transfer_restaurant_to_group(p_restaurant_id uuid,p_group_id uuid,p_brand_id uuid default null,p_region_id uuid default null,p_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_previous uuid; v_currency text; v_country text;
begin
 if not private.platform_admin_has_permission('restaurants:manage') then raise exception 'Platform restaurant management permission required' using errcode='42501'; end if;
 if not exists(select 1 from public.restaurant_groups where id=p_group_id and status<>'archived') then raise exception 'Organisation not found'; end if;
 if not exists(select 1 from public.restaurants where id=p_restaurant_id) then raise exception 'Restaurant not found'; end if;
 select group_id into v_previous from public.restaurant_group_locations where restaurant_id=p_restaurant_id; select default_currency,coalesce(countries[1],'GB') into v_currency,v_country from public.restaurant_groups where id=p_group_id;
 insert into public.restaurant_group_locations(restaurant_id,group_id,brand_id,region_id,currency,country_code,status) values(p_restaurant_id,p_group_id,p_brand_id,p_region_id,v_currency,v_country,'active')
 on conflict(restaurant_id) do update set group_id=excluded.group_id,brand_id=excluded.brand_id,region_id=excluded.region_id,currency=excluded.currency,country_code=excluded.country_code,status='active',merged_into_restaurant_id=null,updated_at=now();
 if v_previous is not null and v_previous<>p_group_id then perform private.restaurant_group_log(v_previous,'location.transferred_out','restaurant',p_restaurant_id,p_reason,jsonb_build_object('to_group_id',p_group_id),'platform_admin'); end if;
 perform private.restaurant_group_log(p_group_id,'location.transferred_in','restaurant',p_restaurant_id,p_reason,jsonb_build_object('from_group_id',v_previous,'brand_id',p_brand_id,'region_id',p_region_id),'platform_admin');
 return jsonb_build_object('restaurant_id',p_restaurant_id,'group_id',p_group_id,'previous_group_id',v_previous,'brand_id',p_brand_id,'region_id',p_region_id);
end $$;
create or replace function public.platform_merge_restaurants(p_source_restaurant_id uuid,p_target_restaurant_id uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.restaurant_group_locations%rowtype; t public.restaurant_group_locations%rowtype;
begin
 if not private.platform_admin_has_permission('restaurants:manage') then raise exception 'Platform restaurant management permission required' using errcode='42501'; end if;
 if p_source_restaurant_id=p_target_restaurant_id then raise exception 'Source and target restaurants must differ'; end if; if length(btrim(coalesce(p_reason,'')))<5 then raise exception 'A merge reason is required'; end if;
 if not exists(select 1 from public.restaurants where id=p_source_restaurant_id) then raise exception 'Source restaurant not found'; end if;
 select * into t from public.restaurant_group_locations where restaurant_id=p_target_restaurant_id for update; if not found then raise exception 'Target restaurant must belong to an organisation'; end if;
 select * into s from public.restaurant_group_locations where restaurant_id=p_source_restaurant_id for update;
 if not found then insert into public.restaurant_group_locations(restaurant_id,group_id,brand_id,region_id,currency,country_code,status,merged_into_restaurant_id) values(p_source_restaurant_id,t.group_id,t.brand_id,t.region_id,t.currency,t.country_code,'merged',p_target_restaurant_id);
 else update public.restaurant_group_locations set group_id=t.group_id,brand_id=t.brand_id,region_id=t.region_id,status='merged',merged_into_restaurant_id=p_target_restaurant_id,updated_at=now() where restaurant_id=p_source_restaurant_id; end if;
 update public.restaurants set status='suspended',accepting_orders=false,updated_at=now() where id=p_source_restaurant_id;
 perform private.restaurant_group_log(t.group_id,'location.merged','restaurant',p_source_restaurant_id,p_reason,jsonb_build_object('target_restaurant_id',p_target_restaurant_id,'previous_group_id',s.group_id),'platform_admin');
 return jsonb_build_object('source_restaurant_id',p_source_restaurant_id,'target_restaurant_id',p_target_restaurant_id,'group_id',t.group_id,'history_preserved',true);
end $$;
create or replace function public.platform_move_brand(p_brand_id uuid,p_target_group_id uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_source uuid; v_count integer;
begin
 if not private.platform_admin_has_permission('restaurants:manage') then raise exception 'Platform restaurant management permission required' using errcode='42501'; end if;
 if length(btrim(coalesce(p_reason,'')))<5 then raise exception 'A move reason is required'; end if; select group_id into v_source from public.restaurant_group_brands where id=p_brand_id for update;
 if v_source is null then raise exception 'Brand not found'; end if; if v_source=p_target_group_id then return jsonb_build_object('brand_id',p_brand_id,'group_id',p_target_group_id,'moved',false); end if;
 if not exists(select 1 from public.restaurant_groups where id=p_target_group_id and status<>'archived') then raise exception 'Target organisation not found'; end if;
 update public.restaurant_group_members set status='revoked',updated_at=now() where group_id=v_source and status='active' and (brand_id=p_brand_id or region_id in(select id from public.restaurant_group_regions where brand_id=p_brand_id) or restaurant_id in(select restaurant_id from public.restaurant_group_locations where brand_id=p_brand_id));
 update public.restaurant_group_brands set group_id=p_target_group_id,updated_at=now() where id=p_brand_id; update public.restaurant_group_regions set group_id=p_target_group_id,updated_at=now() where brand_id=p_brand_id;
 update public.restaurant_group_locations set group_id=p_target_group_id,updated_at=now() where brand_id=p_brand_id;
 update public.restaurant_group_departments d set group_id=p_target_group_id,updated_at=now() where exists(select 1 from public.restaurant_group_locations l where l.restaurant_id=d.restaurant_id and l.brand_id=p_brand_id);
 select count(*) into v_count from public.restaurant_group_locations where brand_id=p_brand_id;
 perform private.restaurant_group_log(v_source,'brand.moved_out','brand',p_brand_id,p_reason,jsonb_build_object('to_group_id',p_target_group_id,'locations',v_count),'platform_admin');
 perform private.restaurant_group_log(p_target_group_id,'brand.moved_in','brand',p_brand_id,p_reason,jsonb_build_object('from_group_id',v_source,'locations',v_count),'platform_admin');
 return jsonb_build_object('brand_id',p_brand_id,'from_group_id',v_source,'to_group_id',p_target_group_id,'locations',v_count,'scoped_memberships_revoked',true);
end $$;
create or replace function public.begin_restaurant_group_impersonation(p_group_id uuid,p_target_user_id uuid default null,p_target_restaurant_id uuid default null,p_reason text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if not private.platform_admin_has_permission('restaurants:manage') then raise exception 'Platform restaurant management permission required' using errcode='42501'; end if; if length(btrim(coalesce(p_reason,'')))<5 then raise exception 'An impersonation reason is required'; end if;
 if p_target_restaurant_id is not null and not exists(select 1 from public.restaurant_group_locations where group_id=p_group_id and restaurant_id=p_target_restaurant_id) then raise exception 'Restaurant is outside this organisation'; end if;
 insert into public.restaurant_group_impersonation_sessions(group_id,admin_user_id,target_user_id,target_restaurant_id,reason) values(p_group_id,auth.uid(),p_target_user_id,p_target_restaurant_id,btrim(p_reason)) returning id into v_id;
 perform private.restaurant_group_log(p_group_id,'impersonation.started','impersonation_session',v_id,p_reason,jsonb_build_object('target_user_id',p_target_user_id,'target_restaurant_id',p_target_restaurant_id),'platform_admin'); return v_id;
end $$;
create or replace function public.end_restaurant_group_impersonation(p_session_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare v_group uuid;
begin
 if not private.platform_admin_has_permission('restaurants:manage') then raise exception 'Platform restaurant management permission required' using errcode='42501'; end if;
 update public.restaurant_group_impersonation_sessions set ended_at=now() where id=p_session_id and admin_user_id=auth.uid() and ended_at is null returning group_id into v_group;
 if v_group is null then raise exception 'Open impersonation session not found'; end if; perform private.restaurant_group_log(v_group,'impersonation.ended','impersonation_session',p_session_id,null,'{}'::jsonb,'platform_admin');
end $$;
alter table public.restaurant_groups enable row level security; alter table public.restaurant_group_brands enable row level security; alter table public.restaurant_group_regions enable row level security;
alter table public.restaurant_group_locations enable row level security; alter table public.restaurant_group_departments enable row level security; alter table public.restaurant_group_roles enable row level security;
alter table public.restaurant_group_members enable row level security; alter table public.restaurant_group_sharing_settings enable row level security; alter table public.restaurant_group_enterprise_settings enable row level security;
alter table public.restaurant_group_api_keys enable row level security; alter table public.restaurant_group_integrations enable row level security; alter table public.restaurant_group_audit_log enable row level security; alter table public.restaurant_group_impersonation_sessions enable row level security;
create policy restaurant_groups_read on public.restaurant_groups for select to authenticated using (private.restaurant_group_member_of(id) or private.platform_admin_has_permission('restaurants:view'));
create policy restaurant_group_brands_read on public.restaurant_group_brands for select to authenticated using (private.restaurant_group_member_of(group_id) or private.platform_admin_has_permission('restaurants:view'));
create policy restaurant_group_regions_read on public.restaurant_group_regions for select to authenticated using (private.restaurant_group_member_of(group_id) or private.platform_admin_has_permission('restaurants:view'));
create policy restaurant_group_locations_read on public.restaurant_group_locations for select to authenticated using (private.restaurant_group_member_permission(group_id,'locations:view',restaurant_id,brand_id,region_id) or private.platform_admin_has_permission('restaurants:view'));
create policy restaurant_group_departments_read on public.restaurant_group_departments for select to authenticated using (private.restaurant_group_member_of(group_id) or private.platform_admin_has_permission('restaurants:view'));
create policy restaurant_group_roles_read on public.restaurant_group_roles for select to authenticated using (private.restaurant_group_member_of(group_id) or private.platform_admin_has_permission('restaurants:view'));
create policy restaurant_group_members_read on public.restaurant_group_members for select to authenticated using (user_id=auth.uid() or private.restaurant_group_member_permission(group_id,'staff:view') or private.platform_admin_has_permission('restaurants:view'));
create policy restaurant_group_sharing_read on public.restaurant_group_sharing_settings for select to authenticated using (private.restaurant_group_member_of(group_id) or private.platform_admin_has_permission('restaurants:view'));
create policy restaurant_group_enterprise_read on public.restaurant_group_enterprise_settings for select to authenticated using (private.restaurant_group_member_of(group_id) or private.platform_admin_has_permission('restaurants:view'));
create policy restaurant_group_integrations_read on public.restaurant_group_integrations for select to authenticated using (private.restaurant_group_member_permission(group_id,'enterprise:manage') or private.platform_admin_has_permission('restaurants:view'));
create policy restaurant_group_api_keys_read on public.restaurant_group_api_keys for select to authenticated using (private.restaurant_group_member_permission(group_id,'enterprise:manage') or private.platform_admin_has_permission('restaurants:manage'));
create policy restaurant_group_audit_read on public.restaurant_group_audit_log for select to authenticated using (private.restaurant_group_member_permission(group_id,'audit:view') or private.platform_admin_has_permission('audit:view'));
create policy restaurant_group_impersonation_read on public.restaurant_group_impersonation_sessions for select to authenticated using (private.platform_admin_has_permission('audit:view'));
grant select on public.restaurant_groups,public.restaurant_group_brands,public.restaurant_group_regions,public.restaurant_group_locations,public.restaurant_group_departments,public.restaurant_group_roles,public.restaurant_group_members,public.restaurant_group_sharing_settings,public.restaurant_group_enterprise_settings,public.restaurant_group_integrations,public.restaurant_group_api_keys,public.restaurant_group_audit_log,public.restaurant_group_impersonation_sessions to authenticated;
revoke all on function public.platform_create_restaurant_group(text,text,text,text,text[],text) from public; revoke all on function public.platform_manage_restaurant_group(uuid,text,jsonb,text) from public;
revoke all on function public.platform_transfer_restaurant_to_group(uuid,uuid,uuid,uuid,text) from public; revoke all on function public.platform_merge_restaurants(uuid,uuid,text) from public;
revoke all on function public.platform_move_brand(uuid,uuid,text) from public; revoke all on function public.begin_restaurant_group_impersonation(uuid,uuid,uuid,text) from public; revoke all on function public.end_restaurant_group_impersonation(uuid) from public;
grant execute on function public.platform_create_restaurant_group(text,text,text,text,text[],text),public.platform_manage_restaurant_group(uuid,text,jsonb,text),public.platform_transfer_restaurant_to_group(uuid,uuid,uuid,uuid,text),public.platform_merge_restaurants(uuid,uuid,text),public.platform_move_brand(uuid,uuid,text),public.begin_restaurant_group_impersonation(uuid,uuid,uuid,text),public.end_restaurant_group_impersonation(uuid),public.get_my_restaurant_group_context(),public.has_restaurant_group_permission(uuid,text,uuid,uuid,uuid) to authenticated;
