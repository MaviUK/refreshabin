-- Enforce platform-admin roles at the database boundary and add access management.
begin;

create schema if not exists private;

alter table public.platform_admin_invites
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'platform_admin_invites_revoked_by_fkey'
      and conrelid = 'public.platform_admin_invites'::regclass
  ) then
    alter table public.platform_admin_invites
      add constraint platform_admin_invites_revoked_by_fkey
      foreign key (revoked_by) references auth.users(id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'platform_admin_invites_revocation_check'
      and conrelid = 'public.platform_admin_invites'::regclass
  ) then
    alter table public.platform_admin_invites
      add constraint platform_admin_invites_revocation_check
      check ((revoked_at is null) = (revoked_by is null));
  end if;
end
$$;

create index if not exists platform_admin_audit_log_actor_idx
  on public.platform_admin_audit_log (actor_user_id, created_at desc);
create index if not exists platform_admin_invites_invited_by_idx
  on public.platform_admin_invites (invited_by) where invited_by is not null;
create index if not exists platform_admin_invites_accepted_by_idx
  on public.platform_admin_invites (accepted_by) where accepted_by is not null;
create index if not exists platform_admin_invites_revoked_by_idx
  on public.platform_admin_invites (revoked_by) where revoked_by is not null;

alter table public.platform_admins enable row level security;
alter table public.platform_admin_invites enable row level security;
alter table public.platform_admin_audit_log enable row level security;

revoke all on table public.platform_admins from public, anon, authenticated;
revoke all on table public.platform_admin_invites from public, anon, authenticated;
revoke all on table public.platform_admin_audit_log from public, anon, authenticated;

create or replace function private.platform_admin_permissions(p_role text)
returns text[]
language sql
immutable
set search_path = ''
as $function$
  select case p_role
    when 'super_admin' then array[
      'overview:view',
      'restaurants:view',
      'restaurants:manage',
      'orders:view',
      'orders:manage',
      'customers:view',
      'finance:view',
      'finance:manage',
      'audit:view',
      'admins:view',
      'admins:manage'
    ]::text[]
    when 'operations' then array[
      'overview:view',
      'restaurants:view',
      'restaurants:manage',
      'orders:view',
      'orders:manage',
      'audit:view'
    ]::text[]
    when 'support' then array[
      'overview:view',
      'restaurants:view',
      'orders:view',
      'customers:view',
      'audit:view'
    ]::text[]
    when 'finance' then array[
      'overview:view',
      'orders:view',
      'finance:view',
      'finance:manage',
      'audit:view'
    ]::text[]
    else array[]::text[]
  end;
$function$;

revoke all on function private.platform_admin_permissions(text)
  from public, anon, authenticated, service_role;

create or replace function private.current_platform_admin_role()
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select pa.role
  from public.platform_admins pa
  where pa.user_id = (select auth.uid())
    and pa.is_active;
$function$;

revoke all on function private.current_platform_admin_role()
  from public, anon, authenticated, service_role;

create or replace function private.has_platform_admin_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    p_permission = any(
      private.platform_admin_permissions(private.current_platform_admin_role())
    ),
    false
  );
$function$;

revoke all on function private.has_platform_admin_permission(text)
  from public, anon, authenticated, service_role;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.current_platform_admin_role() is not null;
$function$;

revoke all on function public.is_platform_admin() from public, anon, authenticated;
grant execute on function public.is_platform_admin() to authenticated;

create or replace function public.get_current_platform_admin()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
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
    'role', pa.role,
    'permissions', private.platform_admin_permissions(pa.role)
  )
  into result
  from public.platform_admins pa
  join auth.users u on u.id = pa.user_id
  where pa.user_id = (select auth.uid())
    and pa.is_active;

  return result;
end;
$function$;

revoke all on function public.get_current_platform_admin() from public, anon, authenticated;
grant execute on function public.get_current_platform_admin() to authenticated;

create or replace function public.claim_platform_admin_access()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
    and i.revoked_at is null
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
    jsonb_build_object('role', matched_invite.role, 'email', current_email)
  );

  return public.get_current_platform_admin();
end;
$function$;

revoke all on function public.claim_platform_admin_access() from public, anon, authenticated;
grant execute on function public.claim_platform_admin_access() to authenticated;

create or replace function public.get_platform_admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  if not private.has_platform_admin_permission('overview:view') then
    raise exception 'You do not have permission to view the platform overview' using errcode = '42501';
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
$function$;

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
as $function$
declare
  result jsonb;
begin
  if not private.has_platform_admin_permission('restaurants:view') then
    raise exception 'You do not have permission to view restaurants' using errcode = '42501';
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
          'address_line_1', l.line1,
          'address_line_2', l.line2,
          'city', l.city,
          'postcode', l.postcode
        )
        from public.restaurant_locations l
        where l.restaurant_id = r.id
          and l.is_active
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
$function$;

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
as $function$
declare
  actor_id uuid := (select auth.uid());
  current_restaurant public.restaurants%rowtype;
  next_status public.restaurant_status;
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not private.has_platform_admin_permission('restaurants:manage') then
    raise exception 'You do not have permission to manage restaurants' using errcode = '42501';
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
$function$;

revoke all on function public.manage_platform_restaurant(uuid, text, text) from public, anon, authenticated;
grant execute on function public.manage_platform_restaurant(uuid, text, text) to authenticated;

create or replace function public.get_platform_admin_audit_log(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  if not private.has_platform_admin_permission('audit:view') then
    raise exception 'You do not have permission to view the audit log' using errcode = '42501';
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
$function$;

revoke all on function public.get_platform_admin_audit_log(integer) from public, anon, authenticated;
grant execute on function public.get_platform_admin_audit_log(integer) to authenticated;

create or replace function public.get_platform_admins()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  if not private.has_platform_admin_permission('admins:view') then
    raise exception 'Super Admin access is required to view administrators' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'admins', coalesce((
      select jsonb_agg(admin_entry order by admin_entry.is_active desc, admin_entry.created_at asc)
      from (
        select
          pa.user_id,
          u.email,
          coalesce(pa.display_name, split_part(u.email, '@', 1)) as display_name,
          pa.role,
          pa.is_active,
          pa.created_at,
          pa.updated_at,
          u.last_sign_in_at,
          pa.user_id = (select auth.uid()) as is_current
        from public.platform_admins pa
        join auth.users u on u.id = pa.user_id
      ) admin_entry
    ), '[]'::jsonb),
    'invites', coalesce((
      select jsonb_agg(invite_entry order by
        case invite_entry.status when 'pending' then 0 when 'expired' then 1 else 2 end,
        invite_entry.created_at desc
      )
      from (
        select
          i.id,
          i.email,
          i.role,
          i.created_at,
          i.expires_at,
          i.accepted_at,
          i.revoked_at,
          case
            when i.accepted_at is not null then 'accepted'
            when i.revoked_at is not null then 'revoked'
            when i.expires_at is not null and i.expires_at <= now() then 'expired'
            else 'pending'
          end as status,
          coalesce(inviter.display_name, inviter_user.email) as invited_by_name
        from public.platform_admin_invites i
        left join public.platform_admins inviter on inviter.user_id = i.invited_by
        left join auth.users inviter_user on inviter_user.id = i.invited_by
      ) invite_entry
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$function$;

revoke all on function public.get_platform_admins() from public, anon, authenticated;
grant execute on function public.get_platform_admins() to authenticated;

create or replace function public.invite_platform_admin(
  p_email text,
  p_role text,
  p_expires_in_days integer default 7
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := (select auth.uid());
  clean_email text := lower(trim(coalesce(p_email, '')));
  invite_record public.platform_admin_invites%rowtype;
begin
  if not private.has_platform_admin_permission('admins:manage') then
    raise exception 'Super Admin access is required to invite administrators' using errcode = '42501';
  end if;

  if length(clean_email) < 3 or length(clean_email) > 320 or position('@' in clean_email) <= 1 then
    raise exception 'Enter a valid email address' using errcode = '22023';
  end if;

  if p_role not in ('super_admin', 'operations', 'support', 'finance') then
    raise exception 'Unsupported administrator role' using errcode = '22023';
  end if;

  if p_expires_in_days is null or p_expires_in_days < 1 or p_expires_in_days > 30 then
    raise exception 'Invitation expiry must be between 1 and 30 days' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('ordered_food_platform_admin_membership'));

  if exists (
    select 1
    from public.platform_admins pa
    join auth.users u on u.id = pa.user_id
    where lower(u.email) = clean_email
  ) then
    raise exception 'This email already belongs to an administrator. Change or reactivate the existing account instead.' using errcode = '23505';
  end if;

  insert into public.platform_admin_invites (
    email,
    role,
    invited_by,
    accepted_by,
    accepted_at,
    expires_at,
    revoked_at,
    revoked_by,
    created_at
  )
  values (
    clean_email,
    p_role,
    actor_id,
    null,
    null,
    now() + make_interval(days => p_expires_in_days),
    null,
    null,
    now()
  )
  on conflict ((lower(email))) do update
    set role = excluded.role,
        invited_by = excluded.invited_by,
        accepted_by = null,
        accepted_at = null,
        expires_at = excluded.expires_at,
        revoked_at = null,
        revoked_by = null,
        created_at = now()
  returning * into invite_record;

  insert into public.platform_admin_audit_log (actor_user_id, action, target_type, target_id, details)
  values (
    actor_id,
    'admin_invited',
    'platform_admin_invite',
    invite_record.id,
    jsonb_build_object(
      'email', clean_email,
      'role', p_role,
      'expires_at', invite_record.expires_at
    )
  );

  return jsonb_build_object(
    'id', invite_record.id,
    'email', invite_record.email,
    'role', invite_record.role,
    'expires_at', invite_record.expires_at,
    'status', 'pending'
  );
end;
$function$;

revoke all on function public.invite_platform_admin(text, text, integer) from public, anon, authenticated;
grant execute on function public.invite_platform_admin(text, text, integer) to authenticated;

create or replace function public.revoke_platform_admin_invite(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := (select auth.uid());
  invite_record public.platform_admin_invites%rowtype;
begin
  if not private.has_platform_admin_permission('admins:manage') then
    raise exception 'Super Admin access is required to revoke administrator invitations' using errcode = '42501';
  end if;

  select i.* into invite_record
  from public.platform_admin_invites i
  where i.id = p_invite_id
  for update;

  if invite_record.id is null then
    raise exception 'Administrator invitation not found' using errcode = 'P0002';
  end if;

  if invite_record.accepted_at is not null then
    raise exception 'Accepted invitations cannot be revoked. Deactivate the administrator instead.' using errcode = '22023';
  end if;

  if invite_record.revoked_at is not null then
    raise exception 'This invitation is already revoked' using errcode = '22023';
  end if;

  update public.platform_admin_invites
  set revoked_at = now(),
      revoked_by = actor_id
  where id = p_invite_id;

  insert into public.platform_admin_audit_log (actor_user_id, action, target_type, target_id, details)
  values (
    actor_id,
    'admin_invite_revoked',
    'platform_admin_invite',
    p_invite_id,
    jsonb_build_object('email', invite_record.email, 'role', invite_record.role)
  );

  return jsonb_build_object('id', p_invite_id, 'status', 'revoked');
end;
$function$;

revoke all on function public.revoke_platform_admin_invite(uuid) from public, anon, authenticated;
grant execute on function public.revoke_platform_admin_invite(uuid) to authenticated;

create or replace function public.manage_platform_admin(
  p_user_id uuid,
  p_action text,
  p_role text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := (select auth.uid());
  target_admin public.platform_admins%rowtype;
  target_email text;
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
  next_role text;
  next_active boolean;
begin
  if not private.has_platform_admin_permission('admins:manage') then
    raise exception 'Super Admin access is required to manage administrators' using errcode = '42501';
  end if;

  if p_action not in ('change_role', 'deactivate', 'reactivate') then
    raise exception 'Unsupported administrator action' using errcode = '22023';
  end if;

  if p_action = 'change_role' and p_role not in ('super_admin', 'operations', 'support', 'finance') then
    raise exception 'Choose a valid administrator role' using errcode = '22023';
  end if;

  if p_action = 'deactivate' and clean_reason is null then
    raise exception 'A reason is required to deactivate administrator access' using errcode = '22023';
  end if;

  if p_user_id = actor_id then
    raise exception 'You cannot change or deactivate your own administrator access' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('ordered_food_platform_admin_membership'));

  select pa.*
  into target_admin
  from public.platform_admins pa
  where pa.user_id = p_user_id
  for update of pa;

  if target_admin.user_id is null then
    raise exception 'Administrator not found' using errcode = 'P0002';
  end if;

  select u.email
  into target_email
  from auth.users u
  where u.id = target_admin.user_id;

  if p_action = 'deactivate' and not target_admin.is_active then
    raise exception 'This administrator is already inactive' using errcode = '22023';
  end if;

  if p_action = 'reactivate' and target_admin.is_active then
    raise exception 'This administrator is already active' using errcode = '22023';
  end if;

  if target_admin.role = 'super_admin'
    and target_admin.is_active
    and (
      p_action = 'deactivate'
      or (p_action = 'change_role' and p_role <> 'super_admin')
    )
    and not exists (
      select 1
      from public.platform_admins pa
      where pa.user_id <> target_admin.user_id
        and pa.role = 'super_admin'
        and pa.is_active
    )
  then
    raise exception 'The last active Super Admin cannot be demoted or deactivated' using errcode = '22023';
  end if;

  next_role := case when p_action = 'change_role' then p_role else target_admin.role end;
  next_active := case
    when p_action = 'deactivate' then false
    when p_action = 'reactivate' then true
    else target_admin.is_active
  end;

  if next_role = target_admin.role and next_active = target_admin.is_active then
    raise exception 'This administrator already has the selected access' using errcode = '22023';
  end if;

  update public.platform_admins
  set role = next_role,
      is_active = next_active,
      updated_at = now()
  where user_id = target_admin.user_id;

  insert into public.platform_admin_audit_log (actor_user_id, action, target_type, target_id, details)
  values (
    actor_id,
    case p_action
      when 'change_role' then 'admin_role_changed'
      when 'deactivate' then 'admin_deactivated'
      when 'reactivate' then 'admin_reactivated'
    end,
    'platform_admin',
    target_admin.user_id,
    jsonb_build_object(
      'email', target_email,
      'previous_role', target_admin.role,
      'role', next_role,
      'previous_active', target_admin.is_active,
      'is_active', next_active,
      'reason', clean_reason
    )
  );

  return jsonb_build_object(
    'user_id', target_admin.user_id,
    'email', target_email,
    'role', next_role,
    'is_active', next_active
  );
end;
$function$;

revoke all on function public.manage_platform_admin(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.manage_platform_admin(uuid, text, text, text) to authenticated;

comment on function public.get_platform_admins() is
  'Returns administrator memberships and invitation history to Super Admins only.';
comment on function public.invite_platform_admin(text, text, integer) is
  'Creates or renews an auditable, time-limited administrator allow-list invitation.';
comment on function public.manage_platform_admin(uuid, text, text, text) is
  'Changes administrator roles or active access with last-Super-Admin protection.';

commit;
