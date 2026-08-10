-- Secure platform-wide operational controls, notification preferences and
-- release flags for the standalone administrator application.
begin;

create table public.platform_configuration (
  singleton boolean primary key default true check (singleton),
  maintenance_mode boolean not null default false,
  maintenance_title text not null default 'We will be back shortly'
    check (length(trim(maintenance_title)) between 3 and 120),
  maintenance_message text not null default 'ordered.food is temporarily unavailable while we carry out essential maintenance.'
    check (length(trim(maintenance_message)) between 10 and 500),
  ordering_enabled boolean not null default true,
  ordering_pause_message text not null default 'Online ordering is temporarily paused. You can still browse restaurants and track existing orders.'
    check (length(trim(ordering_pause_message)) between 10 and 500),
  notification_preferences jsonb not null default jsonb_build_object(
    'new_restaurant_applications', true,
    'failed_payments', true,
    'high_value_refunds', true,
    'restaurants_going_offline', true,
    'high_value_refund_threshold_pence', 10000
  ),
  feature_flags jsonb not null default jsonb_build_object(
    'scheduled_orders', true,
    'customer_favourites', true,
    'restaurant_quick_availability', true
  ),
  updated_by uuid references public.platform_admins(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(notification_preferences) = 'object'),
  check (jsonb_typeof(feature_flags) = 'object')
);

create table public.platform_configuration_history (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  reason text not null check (length(trim(reason)) between 5 and 500),
  previous_configuration jsonb not null,
  next_configuration jsonb not null,
  created_at timestamptz not null default now()
);

create index platform_configuration_history_created_idx
  on public.platform_configuration_history (created_at desc);
create index platform_configuration_history_actor_idx
  on public.platform_configuration_history (actor_user_id, created_at desc)
  where actor_user_id is not null;
create index platform_configuration_updated_by_idx
  on public.platform_configuration (updated_by)
  where updated_by is not null;

alter table public.platform_configuration enable row level security;
alter table public.platform_configuration_history enable row level security;

revoke all on table public.platform_configuration from public, anon, authenticated;
revoke all on table public.platform_configuration_history from public, anon, authenticated;
grant select on table public.platform_configuration to service_role;

insert into public.platform_configuration (singleton)
values (true)
on conflict (singleton) do nothing;

-- Configuration is a distinct high-impact permission. Operations can inspect
-- the active controls, while only super administrators can change them.
create or replace function private.platform_admin_permissions(p_role text)
returns text[] language sql immutable set search_path = '' as $function$
  select case p_role
    when 'super_admin' then array[
      'overview:view','restaurants:view','restaurants:manage','orders:view','orders:manage',
      'orders:customer_details','customers:view','support:view','support:manage',
      'finance:view','finance:manage','settings:view','settings:manage',
      'audit:view','admins:view','admins:manage'
    ]::text[]
    when 'operations' then array[
      'overview:view','restaurants:view','restaurants:manage','orders:view','orders:manage',
      'orders:customer_details','support:view','support:manage','settings:view','audit:view'
    ]::text[]
    when 'support' then array[
      'overview:view','restaurants:view','orders:view','orders:customer_details','customers:view',
      'support:view','support:manage','audit:view'
    ]::text[]
    when 'finance' then array[
      'overview:view','orders:view','support:view','finance:view','finance:manage','audit:view'
    ]::text[]
    else array[]::text[]
  end;
$function$;

revoke all on function private.platform_admin_permissions(text)
  from public, anon, authenticated, service_role;

create or replace function private.public_platform_configuration()
returns jsonb language sql stable security definer set search_path = '' as $function$
  select jsonb_build_object(
    'maintenance_mode', c.maintenance_mode,
    'maintenance_title', c.maintenance_title,
    'maintenance_message', c.maintenance_message,
    'ordering_enabled', c.ordering_enabled,
    'ordering_pause_message', c.ordering_pause_message,
    'feature_flags', c.feature_flags,
    'updated_at', c.updated_at
  )
  from public.platform_configuration c
  where c.singleton;
$function$;

revoke all on function private.public_platform_configuration()
  from public, anon, authenticated, service_role;

create or replace function public.get_public_platform_configuration()
returns jsonb language sql stable security definer set search_path = '' as $function$
  select private.public_platform_configuration();
$function$;

revoke all on function public.get_public_platform_configuration() from public;
grant execute on function public.get_public_platform_configuration() to anon, authenticated, service_role;

create or replace function public.get_platform_configuration()
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare result jsonb;
begin
  if not private.has_platform_admin_permission('settings:view') then
    raise exception 'You do not have permission to view platform configuration' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'configuration', jsonb_build_object(
      'maintenance_mode', c.maintenance_mode,
      'maintenance_title', c.maintenance_title,
      'maintenance_message', c.maintenance_message,
      'ordering_enabled', c.ordering_enabled,
      'ordering_pause_message', c.ordering_pause_message,
      'notification_preferences', c.notification_preferences,
      'feature_flags', c.feature_flags,
      'updated_at', c.updated_at,
      'updated_by_name', coalesce(pa.display_name, 'System')
    ),
    'history', coalesce((
      select jsonb_agg(entry order by entry.created_at desc)
      from (
        select h.id, h.reason, h.previous_configuration, h.next_configuration,
          h.created_at, coalesce(a.display_name, 'Removed administrator') as actor_name
        from public.platform_configuration_history h
        left join public.platform_admins a on a.user_id = h.actor_user_id
        order by h.created_at desc
        limit 20
      ) entry
    ), '[]'::jsonb)
  ) into result
  from public.platform_configuration c
  left join public.platform_admins pa on pa.user_id = c.updated_by
  where c.singleton;

  return result;
end;
$function$;

create or replace function public.update_platform_configuration(
  p_maintenance_mode boolean,
  p_maintenance_title text,
  p_maintenance_message text,
  p_ordering_enabled boolean,
  p_ordering_pause_message text,
  p_notification_preferences jsonb,
  p_feature_flags jsonb,
  p_reason text,
  p_expected_updated_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  actor_id uuid := (select auth.uid());
  current_row public.platform_configuration%rowtype;
  previous_value jsonb;
  next_notifications jsonb;
  next_flags jsonb;
  next_value jsonb;
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
  refund_threshold integer;
begin
  if not private.has_platform_admin_permission('settings:manage') then
    raise exception 'You do not have permission to change platform configuration' using errcode = '42501';
  end if;

  if clean_reason is null or length(clean_reason) not between 5 and 500 then
    raise exception 'Enter a reason between 5 and 500 characters' using errcode = '22023';
  end if;
  if p_maintenance_mode is null or p_ordering_enabled is null then
    raise exception 'Operational switches must have a value' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_maintenance_title, ''))) not between 3 and 120
    or length(trim(coalesce(p_maintenance_message, ''))) not between 10 and 500
    or length(trim(coalesce(p_ordering_pause_message, ''))) not between 10 and 500 then
    raise exception 'Provide valid customer-facing status messages' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_notification_preferences, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_feature_flags, '{}'::jsonb)) <> 'object' then
    raise exception 'Settings payloads must be objects' using errcode = '22023';
  end if;

  select * into current_row
  from public.platform_configuration
  where singleton
  for update;

  if p_expected_updated_at is not null and current_row.updated_at <> p_expected_updated_at then
    raise exception 'Platform configuration changed since you opened it. Refresh before saving.' using errcode = '40001';
  end if;

  begin
    refund_threshold := coalesce(
      (p_notification_preferences ->> 'high_value_refund_threshold_pence')::integer,
      (current_row.notification_preferences ->> 'high_value_refund_threshold_pence')::integer,
      10000
    );
  exception when invalid_text_representation then
    raise exception 'High-value refund threshold must be a whole number of pence' using errcode = '22023';
  end;
  if refund_threshold < 0 or refund_threshold > 10000000 then
    raise exception 'High-value refund threshold must be between £0 and £100,000' using errcode = '22023';
  end if;

  next_notifications := jsonb_build_object(
    'new_restaurant_applications', coalesce((p_notification_preferences ->> 'new_restaurant_applications')::boolean, false),
    'failed_payments', coalesce((p_notification_preferences ->> 'failed_payments')::boolean, false),
    'high_value_refunds', coalesce((p_notification_preferences ->> 'high_value_refunds')::boolean, false),
    'restaurants_going_offline', coalesce((p_notification_preferences ->> 'restaurants_going_offline')::boolean, false),
    'high_value_refund_threshold_pence', refund_threshold
  );
  next_flags := jsonb_build_object(
    'scheduled_orders', coalesce((p_feature_flags ->> 'scheduled_orders')::boolean, false),
    'customer_favourites', coalesce((p_feature_flags ->> 'customer_favourites')::boolean, false),
    'restaurant_quick_availability', coalesce((p_feature_flags ->> 'restaurant_quick_availability')::boolean, false)
  );

  previous_value := jsonb_build_object(
    'maintenance_mode', current_row.maintenance_mode,
    'maintenance_title', current_row.maintenance_title,
    'maintenance_message', current_row.maintenance_message,
    'ordering_enabled', current_row.ordering_enabled,
    'ordering_pause_message', current_row.ordering_pause_message,
    'notification_preferences', current_row.notification_preferences,
    'feature_flags', current_row.feature_flags
  );
  next_value := jsonb_build_object(
    'maintenance_mode', p_maintenance_mode,
    'maintenance_title', trim(p_maintenance_title),
    'maintenance_message', trim(p_maintenance_message),
    'ordering_enabled', p_ordering_enabled,
    'ordering_pause_message', trim(p_ordering_pause_message),
    'notification_preferences', next_notifications,
    'feature_flags', next_flags
  );

  if previous_value = next_value then
    raise exception 'No configuration changes were provided' using errcode = '22023';
  end if;

  update public.platform_configuration
  set maintenance_mode = p_maintenance_mode,
      maintenance_title = trim(p_maintenance_title),
      maintenance_message = trim(p_maintenance_message),
      ordering_enabled = p_ordering_enabled,
      ordering_pause_message = trim(p_ordering_pause_message),
      notification_preferences = next_notifications,
      feature_flags = next_flags,
      updated_by = actor_id,
      updated_at = now()
  where singleton
  returning updated_at into current_row.updated_at;

  insert into public.platform_configuration_history (
    actor_user_id, reason, previous_configuration, next_configuration
  ) values (actor_id, clean_reason, previous_value, next_value);

  insert into public.platform_admin_audit_log (
    actor_user_id, action, target_type, target_id, details
  ) values (
    actor_id, 'platform_configuration_updated', 'platform_configuration', null,
    jsonb_build_object('reason', clean_reason, 'before', previous_value, 'after', next_value)
  );

  return next_value || jsonb_build_object('updated_at', current_row.updated_at);
end;
$function$;

revoke all on function public.get_platform_configuration() from public, anon, authenticated;
revoke all on function public.update_platform_configuration(boolean, text, text, boolean, text, jsonb, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.get_platform_configuration() to authenticated;
grant execute on function public.update_platform_configuration(boolean, text, text, boolean, text, jsonb, jsonb, text, timestamptz) to authenticated;

-- Orders are denied at the database boundary even if a stale or modified client
-- bypasses the customer-facing interface.
create or replace function public.enforce_platform_ordering_controls()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare config public.platform_configuration%rowtype;
begin
  select * into config from public.platform_configuration where singleton;
  if config.maintenance_mode then
    raise exception '%', config.maintenance_message using errcode = 'P0001';
  end if;
  if not config.ordering_enabled then
    raise exception '%', config.ordering_pause_message using errcode = 'P0001';
  end if;
  if new.requested_fulfilment_at is not null
    and not coalesce((config.feature_flags ->> 'scheduled_orders')::boolean, false) then
    raise exception 'Scheduled orders are not currently available. Choose ASAP to continue.' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

revoke all on function public.enforce_platform_ordering_controls() from public, anon, authenticated;
drop trigger if exists enforce_platform_ordering_controls on public.orders;
create trigger enforce_platform_ordering_controls
before insert on public.orders
for each row execute function public.enforce_platform_ordering_controls();

-- Release flags also have a database boundary where the underlying tables are
-- present. Platform-admin menu actions remain available during a staged pause.
create or replace function public.enforce_customer_favourites_feature()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if not coalesce((
    select (c.feature_flags ->> 'customer_favourites')::boolean
    from public.platform_configuration c where c.singleton
  ), false) then
    raise exception 'Customer favourites are not currently available.' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

create or replace function public.enforce_restaurant_quick_availability_feature()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if old.is_available is distinct from new.is_available
    and not private.has_platform_admin_permission('restaurants:manage')
    and not coalesce((
      select (c.feature_flags ->> 'restaurant_quick_availability')::boolean
      from public.platform_configuration c where c.singleton
    ), false) then
    raise exception 'Quick item availability controls are temporarily disabled.' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

revoke all on function public.enforce_customer_favourites_feature() from public, anon, authenticated;
revoke all on function public.enforce_restaurant_quick_availability_feature() from public, anon, authenticated;

do $block$
begin
  if to_regclass('public.customer_favourite_restaurants') is not null then
    execute 'drop trigger if exists enforce_customer_favourites_feature on public.customer_favourite_restaurants';
    execute 'create trigger enforce_customer_favourites_feature before insert on public.customer_favourite_restaurants for each row execute function public.enforce_customer_favourites_feature()';
  end if;
  if to_regclass('public.customer_favourite_items') is not null then
    execute 'drop trigger if exists enforce_customer_favourites_feature on public.customer_favourite_items';
    execute 'create trigger enforce_customer_favourites_feature before insert on public.customer_favourite_items for each row execute function public.enforce_customer_favourites_feature()';
  end if;
end;
$block$;

drop trigger if exists enforce_restaurant_quick_availability_feature on public.menu_items;
create trigger enforce_restaurant_quick_availability_feature
before update of is_available on public.menu_items
for each row execute function public.enforce_restaurant_quick_availability_feature();

comment on table public.platform_configuration is
  'Singleton platform operational controls. Browser access is restricted to audited RPCs.';
comment on table public.platform_configuration_history is
  'Immutable before/after history for platform configuration changes.';

commit;
