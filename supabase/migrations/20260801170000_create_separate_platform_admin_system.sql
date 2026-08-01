begin;

alter table public.platform_admins
  add column if not exists role text not null default 'super_admin',
  add column if not exists display_name text,
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'platform_admins_role_check'
      and conrelid = 'public.platform_admins'::regclass
  ) then
    alter table public.platform_admins
      add constraint platform_admins_role_check
      check (role in ('super_admin', 'operations', 'support', 'finance'));
  end if;
end
$$;

create table if not exists public.platform_admin_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role text not null default 'operations'
    check (role in ('super_admin', 'operations', 'support', 'finance')),
  invited_by uuid references auth.users(id),
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (email = lower(trim(email)))
);

create unique index if not exists platform_admin_invites_email_idx
  on public.platform_admin_invites (lower(email));

create table if not exists public.platform_admin_audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null references auth.users(id),
  action text not null,
  target_type text not null,
  target_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists platform_admin_audit_log_created_idx
  on public.platform_admin_audit_log (created_at desc);
create index if not exists platform_admin_audit_log_target_idx
  on public.platform_admin_audit_log (target_type, target_id, created_at desc);

alter table public.platform_admin_invites enable row level security;
alter table public.platform_admin_audit_log enable row level security;

drop policy if exists "Platform admins can read own access" on public.platform_admins;

revoke all on table public.platform_admins from anon, authenticated;
revoke all on table public.platform_admin_invites from anon, authenticated;
revoke all on table public.platform_admin_audit_log from anon, authenticated;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.platform_admins pa
      where pa.user_id = (select auth.uid())
        and pa.is_active
    );
$$;

revoke all on function public.is_platform_admin() from public, anon, authenticated;
grant execute on function public.is_platform_admin() to authenticated;

create or replace function public.claim_platform_admin_access()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_email text;
  matched_invite public.platform_admin_invites%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select lower(trim(u.email))
  into current_email
  from auth.users u
  where u.id = current_user_id
    and u.email_confirmed_at is not null;

  if current_email is null then
    raise exception 'A verified administrator email is required' using errcode = '42501';
  end if;

  select i.*
  into matched_invite
  from public.platform_admin_invites i
  where lower(i.email) = current_email
    and i.accepted_at is null
    and (i.expires_at is null or i.expires_at > now())
  for update;

  if matched_invite.id is null then
    if public.is_platform_admin() then
      return public.get_current_platform_admin();
    end if;
    raise exception 'Administrator access has not been authorised' using errcode = '42501';
  end if;

  insert into public.platform_admins (user_id, role, display_name, is_active, updated_at)
  values (current_user_id, matched_invite.role, split_part(current_email, '@', 1), true, now())
  on conflict (user_id) do update
    set role = excluded.role,
        is_active = true,
        updated_at = now();

  update public.platform_admin_invites
  set accepted_by = current_user_id,
      accepted_at = now()
  where id = matched_invite.id;

  insert into public.platform_admin_audit_log (actor_user_id, action, target_type, target_id, details)
  values (
    current_user_id,
    'admin_access_claimed',
    'platform_admin',
    current_user_id,
    jsonb_build_object('role', matched_invite.role)
  );

  return public.get_current_platform_admin();
end;
$$;

revoke all on function public.claim_platform_admin_access() from public, anon, authenticated;
grant execute on function public.claim_platform_admin_access() to authenticated;

create or replace function public.get_current_platform_admin()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'user_id', pa.user_id,
    'email', u.email,
    'display_name', coalesce(pa.display_name, split_part(u.email, '@', 1)),
    'role', pa.role
  )
  into result
  from public.platform_admins pa
  join auth.users u on u.id = pa.user_id
  where pa.user_id = (select auth.uid())
    and pa.is_active;

  return result;
end;
$$;

revoke all on function public.get_current_platform_admin() from public, anon, authenticated;
grant execute on function public.get_current_platform_admin() to authenticated;

create or replace function public.get_platform_admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'pending_restaurants', (select count(*) from public.restaurants r where r.status = 'pending_approval'),
    'active_restaurants', (select count(*) from public.restaurants r where r.status = 'active'),
    'suspended_restaurants', (select count(*) from public.restaurants r where r.status = 'suspended'),
    'orders_today', (
      select count(*)
      from public.orders o
      where (o.created_at at time zone 'Europe/London')::date = (now() at time zone 'Europe/London')::date
        and o.payment_status in ('paid', 'partially_refunded')
    ),
    'gross_order_value_today_pence', (
      select coalesce(sum(o.total_pence), 0)
      from public.orders o
      where (o.created_at at time zone 'Europe/London')::date = (now() at time zone 'Europe/London')::date
        and o.payment_status in ('paid', 'partially_refunded')
    ),
    'orders_needing_attention', (
      select count(*) from public.orders o where o.order_status = 'placed'
    ),
    'recent_applications', coalesce((
      select jsonb_agg(application order by application.submitted_at asc nulls last)
      from (
        select r.id, r.name, r.slug, r.submitted_at, r.cuisines, r.logo_url
        from public.restaurants r
        where r.status = 'pending_approval'
        order by r.submitted_at asc nulls last
        limit 6
      ) application
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_platform_admin_overview() from public, anon, authenticated;
grant execute on function public.get_platform_admin_overview() to authenticated;

create or replace function public.get_platform_restaurants(
  p_status text default null,
  p_search text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if p_status is not null and p_status not in ('draft', 'pending_approval', 'active', 'suspended', 'rejected') then
    raise exception 'Unsupported restaurant status' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(restaurant order by
    case restaurant.status when 'pending_approval' then 0 when 'suspended' then 1 else 2 end,
    restaurant.updated_at desc
  ), '[]'::jsonb)
  into result
  from (
    select
      r.id,
      r.name,
      r.slug,
      r.status::text,
      r.email,
      r.phone,
      r.cuisines,
      r.accepts_delivery,
      r.accepts_collection,
      r.accepting_orders,
      r.minimum_order_pence,
      r.delivery_fee_pence,
      r.logo_url,
      r.cover_url,
      r.submitted_at,
      r.approved_at,
      r.approval_notes,
      r.created_at,
      r.updated_at,
      coalesce((
        select jsonb_build_object(
          'address_line_1', l.address_line_1,
          'address_line_2', l.address_line_2,
          'city', l.city,
          'postcode', l.postcode
        )
        from public.restaurant_locations l
        where l.restaurant_id = r.id and l.is_active
        order by l.created_at asc
        limit 1
      ), '{}'::jsonb) as location,
      (select count(*) from public.menu_categories c where c.restaurant_id = r.id) as menu_category_count,
      (select count(*) from public.menu_items i where i.restaurant_id = r.id) as menu_item_count,
      (select count(*) from public.orders o where o.restaurant_id = r.id) as order_count,
      (select coalesce(sum(o.total_pence), 0) from public.orders o where o.restaurant_id = r.id and o.payment_status in ('paid', 'partially_refunded')) as gross_sales_pence,
      (select max(o.created_at) from public.orders o where o.restaurant_id = r.id) as last_order_at
    from public.restaurants r
    where (p_status is null or r.status::text = p_status)
      and (
        nullif(trim(coalesce(p_search, '')), '') is null
        or r.name ilike '%' || trim(p_search) || '%'
        or r.email ilike '%' || trim(p_search) || '%'
        or r.slug ilike '%' || trim(p_search) || '%'
      )
  ) restaurant;

  return result;
end;
$$;

revoke all on function public.get_platform_restaurants(text, text) from public, anon, authenticated;
grant execute on function public.get_platform_restaurants(text, text) to authenticated;

create or replace function public.manage_platform_restaurant(
  p_restaurant_id uuid,
  p_action text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  current_restaurant public.restaurants%rowtype;
  next_status public.restaurant_status;
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.is_platform_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if p_action not in ('approve', 'reject', 'suspend', 'reactivate') then
    raise exception 'Unsupported restaurant action' using errcode = '22023';
  end if;

  if p_action in ('reject', 'suspend') and clean_reason is null then
    raise exception 'A reason is required for this action' using errcode = '22023';
  end if;

  select r.* into current_restaurant
  from public.restaurants r
  where r.id = p_restaurant_id
  for update;

  if current_restaurant.id is null then
    raise exception 'Restaurant not found' using errcode = 'P0002';
  end if;

  if p_action = 'approve' and current_restaurant.status <> 'pending_approval' then
    raise exception 'Only pending applications can be approved' using errcode = '22023';
  elsif p_action = 'reject' and current_restaurant.status <> 'pending_approval' then
    raise exception 'Only pending applications can be rejected' using errcode = '22023';
  elsif p_action = 'suspend' and current_restaurant.status <> 'active' then
    raise exception 'Only active restaurants can be suspended' using errcode = '22023';
  elsif p_action = 'reactivate' and current_restaurant.status <> 'suspended' then
    raise exception 'Only suspended restaurants can be reactivated' using errcode = '22023';
  end if;

  next_status := case p_action
    when 'approve' then 'active'
    when 'reject' then 'rejected'
    when 'suspend' then 'suspended'
    when 'reactivate' then 'active'
  end;

  update public.restaurants
  set status = next_status,
      approved_at = case when p_action = 'approve' then now() else approved_at end,
      approval_notes = case
        when p_action in ('reject', 'suspend') then clean_reason
        when p_action = 'reactivate' then null
        else approval_notes
      end,
      updated_at = now()
  where id = p_restaurant_id;

  if p_action in ('approve', 'reject') then
    insert into public.restaurant_application_reviews (restaurant_id, reviewed_by, decision, notes)
    values (
      p_restaurant_id,
      actor_id,
      case when p_action = 'approve' then 'approved' else 'rejected' end,
      clean_reason
    );
  end if;

  insert into public.platform_admin_audit_log (actor_user_id, action, target_type, target_id, details)
  values (
    actor_id,
    'restaurant_' || p_action,
    'restaurant',
    p_restaurant_id,
    jsonb_build_object(
      'restaurant_name', current_restaurant.name,
      'from_status', current_restaurant.status::text,
      'to_status', next_status::text,
      'reason', clean_reason
    )
  );

  return jsonb_build_object(
    'restaurant_id', p_restaurant_id,
    'previous_status', current_restaurant.status::text,
    'status', next_status::text,
    'action', p_action
  );
end;
$$;

revoke all on function public.manage_platform_restaurant(uuid, text, text) from public, anon, authenticated;
grant execute on function public.manage_platform_restaurant(uuid, text, text) to authenticated;

create or replace function public.get_platform_admin_audit_log(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(entry order by entry.created_at desc), '[]'::jsonb)
  into result
  from (
    select
      log.id,
      log.action,
      log.target_type,
      log.target_id,
      log.details,
      log.created_at,
      coalesce(pa.display_name, u.email) as actor_name,
      u.email as actor_email
    from public.platform_admin_audit_log log
    join auth.users u on u.id = log.actor_user_id
    left join public.platform_admins pa on pa.user_id = log.actor_user_id
    order by log.created_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ) entry;

  return result;
end;
$$;

revoke all on function public.get_platform_admin_audit_log(integer) from public, anon, authenticated;
grant execute on function public.get_platform_admin_audit_log(integer) to authenticated;

comment on table public.platform_admin_invites is 'Server-managed allow-list for verified platform administrator accounts.';
comment on table public.platform_admin_audit_log is 'Immutable audit trail for platform administrator actions.';

commit;
