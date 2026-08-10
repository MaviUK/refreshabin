-- Content moderation reports, failed menu-import monitoring and audited
-- enforcement controls for the standalone platform administrator application.
begin;

create sequence public.platform_moderation_reference_seq start 1000;

create table public.platform_content_reports (
  id uuid primary key default gen_random_uuid(),
  reference bigint not null unique default nextval('public.platform_moderation_reference_seq'),
  source text not null check (source in ('admin', 'system', 'customer')),
  subject_type text not null check (subject_type in ('restaurant', 'menu_item', 'menu_import')),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  menu_import_id uuid references public.menu_imports(id) on delete set null,
  category text not null check (category in ('misleading_content', 'allergen_risk', 'prohibited_content', 'incorrect_pricing', 'quality', 'duplicate', 'menu_import_failure', 'other')),
  severity text not null default 'normal' check (severity in ('low', 'normal', 'high', 'urgent')),
  summary text not null check (length(trim(summary)) between 5 and 160),
  details text not null check (length(trim(details)) between 5 and 4000),
  status text not null default 'open' check (status in ('open', 'in_review', 'actioned', 'dismissed')),
  assigned_to uuid references public.platform_admins(user_id) on delete set null,
  reported_by uuid references auth.users(id) on delete set null,
  created_by_admin uuid references public.platform_admins(user_id) on delete set null,
  resolution text check (resolution is null or length(trim(resolution)) between 5 and 500),
  enforcement_action text check (enforcement_action is null or enforcement_action in ('hidden', 'rejected', 'restored')),
  enforcement_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(enforcement_snapshot) = 'object'),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (subject_type = 'restaurant' and menu_item_id is null and menu_import_id is null)
    or (subject_type = 'menu_item' and menu_import_id is null)
    or (subject_type = 'menu_import' and menu_item_id is null)
  )
);

create table public.platform_content_report_activity (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.platform_content_reports(id) on delete cascade,
  event_type text not null check (event_type in ('report_created', 'failure_reopened', 'assigned', 'review_started', 'content_hidden', 'content_rejected', 'content_restored', 'resolved', 'dismissed')),
  note text check (note is null or length(trim(note)) between 5 and 500),
  actor_user_id uuid references public.platform_admins(user_id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index platform_content_reports_queue_idx on public.platform_content_reports (status, severity, updated_at desc);
create index platform_content_reports_restaurant_idx on public.platform_content_reports (restaurant_id, created_at desc);
create index platform_content_reports_assignee_idx on public.platform_content_reports (assigned_to, updated_at desc) where assigned_to is not null;
create index platform_content_report_activity_report_idx on public.platform_content_report_activity (report_id, created_at desc);
create unique index platform_content_reports_failed_import_idx on public.platform_content_reports (menu_import_id) where source = 'system' and menu_import_id is not null;

alter table public.platform_content_reports enable row level security;
alter table public.platform_content_report_activity enable row level security;
revoke all on table public.platform_content_reports from public, anon, authenticated;
revoke all on table public.platform_content_report_activity from public, anon, authenticated;
revoke all on sequence public.platform_moderation_reference_seq from public, anon, authenticated;

create or replace function private.platform_admin_permissions(p_role text)
returns text[] language sql immutable set search_path = '' as $function$
  select case p_role
    when 'super_admin' then array[
      'overview:view','restaurants:view','restaurants:manage','orders:view','orders:manage',
      'orders:customer_details','customers:view','support:view','support:manage',
      'finance:view','finance:manage','settings:view','settings:manage',
      'moderation:view','moderation:manage','audit:view','admins:view','admins:manage'
    ]::text[]
    when 'operations' then array[
      'overview:view','restaurants:view','restaurants:manage','orders:view','orders:manage',
      'orders:customer_details','support:view','support:manage','settings:view',
      'moderation:view','moderation:manage','audit:view'
    ]::text[]
    when 'support' then array[
      'overview:view','restaurants:view','orders:view','orders:customer_details','customers:view',
      'support:view','support:manage','moderation:view','audit:view'
    ]::text[]
    when 'finance' then array[
      'overview:view','orders:view','support:view','finance:view','finance:manage','audit:view'
    ]::text[]
    else array[]::text[]
  end;
$function$;
revoke all on function private.platform_admin_permissions(text) from public, anon, authenticated, service_role;

create or replace function private.record_failed_menu_import_report()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare report_id uuid;
begin
  if new.status <> 'failed' then return new; end if;

  insert into public.platform_content_reports (
    source, subject_type, restaurant_id, menu_import_id, category, severity,
    summary, details, status, created_at, updated_at
  ) values (
    'system', 'menu_import', new.restaurant_id, new.id, 'menu_import_failure', 'normal',
    'AI menu import failed', coalesce(nullif(trim(new.error_message), ''), 'The menu import failed without a recorded error.'),
    'open', coalesce(new.created_at, now()), now()
  )
  on conflict (menu_import_id) where source = 'system' and menu_import_id is not null
  do update set
    details = excluded.details,
    status = 'open',
    assigned_to = null,
    resolution = null,
    enforcement_action = null,
    enforcement_snapshot = '{}'::jsonb,
    resolved_at = null,
    updated_at = now()
  returning id into report_id;

  insert into public.platform_content_report_activity (report_id, event_type, metadata)
  values (
    report_id,
    case when tg_op = 'INSERT' then 'report_created' else 'failure_reopened' end,
    jsonb_build_object('menu_import_id', new.id, 'error_message', new.error_message)
  );
  return new;
end;
$function$;
revoke all on function private.record_failed_menu_import_report() from public, anon, authenticated, service_role;

drop trigger if exists record_failed_menu_import_insert on public.menu_imports;
create trigger record_failed_menu_import_insert
after insert on public.menu_imports
for each row when (new.status = 'failed')
execute function private.record_failed_menu_import_report();

drop trigger if exists record_failed_menu_import_update on public.menu_imports;
create trigger record_failed_menu_import_update
after update of status on public.menu_imports
for each row when (new.status = 'failed' and old.status is distinct from new.status)
execute function private.record_failed_menu_import_report();

insert into public.platform_content_reports (
  source, subject_type, restaurant_id, menu_import_id, category, severity,
  summary, details, status, created_at, updated_at
)
select 'system', 'menu_import', mi.restaurant_id, mi.id, 'menu_import_failure', 'normal',
  'AI menu import failed', coalesce(nullif(trim(mi.error_message), ''), 'The menu import failed without a recorded error.'),
  'open', mi.created_at, coalesce(mi.updated_at, mi.created_at)
from public.menu_imports mi
where mi.status = 'failed'
on conflict (menu_import_id) where source = 'system' and menu_import_id is not null do nothing;

insert into public.platform_content_report_activity (report_id, event_type, metadata)
select r.id, 'report_created', jsonb_build_object('menu_import_id', r.menu_import_id, 'backfilled', true)
from public.platform_content_reports r
where r.source = 'system' and r.subject_type = 'menu_import'
  and not exists (select 1 from public.platform_content_report_activity a where a.report_id = r.id);

create or replace function public.search_platform_moderation_targets(p_search text)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare clean_search text := trim(coalesce(p_search, '')); result jsonb;
begin
  if not private.has_platform_admin_permission('moderation:view') then
    raise exception 'You do not have permission to search moderation targets' using errcode = '42501';
  end if;
  if length(clean_search) < 2 then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(target order by target.subject_type, target.name), '[]'::jsonb) into result
  from (
    (select r.id, 'restaurant'::text as subject_type, r.name, r.name as restaurant_name,
      concat_ws(' · ', r.slug, r.status::text) as context
    from public.restaurants r
    where r.name ilike '%' || clean_search || '%' or r.slug ilike '%' || clean_search || '%'
    order by r.name limit 10)
    union all
    (select i.id, 'menu_item'::text, i.name, r.name,
      concat_ws(' · ', r.name, public.menu_categories.name) as context
    from public.menu_items i
    join public.restaurants r on r.id = i.restaurant_id
    left join public.menu_categories on public.menu_categories.id = i.category_id
    where i.name ilike '%' || clean_search || '%' or r.name ilike '%' || clean_search || '%'
    order by i.name limit 15)
  ) target;
  return result;
end;
$function$;

create or replace function public.create_platform_moderation_report(
  p_subject_type text, p_subject_id uuid, p_category text, p_severity text,
  p_summary text, p_details text
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  actor_id uuid := (select auth.uid());
  report_id uuid;
  v_restaurant_id uuid;
  clean_summary text := trim(coalesce(p_summary, ''));
  clean_details text := trim(coalesce(p_details, ''));
begin
  if not private.has_platform_admin_permission('moderation:manage') then
    raise exception 'You do not have permission to create moderation reports' using errcode = '42501';
  end if;
  if p_subject_type not in ('restaurant', 'menu_item') then raise exception 'Choose a restaurant or menu item' using errcode = '22023'; end if;
  if p_category not in ('misleading_content', 'allergen_risk', 'prohibited_content', 'incorrect_pricing', 'quality', 'duplicate', 'other') then raise exception 'Choose a valid report category' using errcode = '22023'; end if;
  if p_severity not in ('low', 'normal', 'high', 'urgent') then raise exception 'Choose a valid severity' using errcode = '22023'; end if;
  if length(clean_summary) not between 5 and 160 or length(clean_details) not between 5 and 4000 then raise exception 'Provide a valid summary and investigation detail' using errcode = '22023'; end if;

  if p_subject_type = 'restaurant' then
    select r.id into v_restaurant_id from public.restaurants r where r.id = p_subject_id;
  else
    select i.restaurant_id into v_restaurant_id from public.menu_items i where i.id = p_subject_id;
  end if;
  if v_restaurant_id is null then raise exception 'Moderation target not found' using errcode = 'P0002'; end if;

  insert into public.platform_content_reports (
    source, subject_type, restaurant_id, menu_item_id, category, severity,
    summary, details, created_by_admin
  ) values (
    'admin', p_subject_type, v_restaurant_id,
    case when p_subject_type = 'menu_item' then p_subject_id else null end,
    p_category, p_severity, clean_summary, clean_details, actor_id
  ) returning id into report_id;

  insert into public.platform_content_report_activity (report_id, event_type, actor_user_id, metadata)
  values (report_id, 'report_created', actor_id, jsonb_build_object('source', 'admin'));
  insert into public.platform_admin_audit_log (actor_user_id, action, target_type, target_id, details)
  values (actor_id, 'moderation_report_created', 'moderation_report', report_id,
    jsonb_build_object('subject_type', p_subject_type, 'subject_id', p_subject_id, 'category', p_category, 'severity', p_severity));
  return jsonb_build_object('id', report_id);
end;
$function$;

create or replace function public.get_platform_moderation_queue(
  p_search text default null, p_status text default 'open', p_subject_type text default 'all',
  p_severity text default 'all', p_page integer default 1, p_page_size integer default 30
)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare result jsonb; clean_search text := trim(coalesce(p_search, '')); offset_rows integer; total_rows integer;
begin
  if not private.has_platform_admin_permission('moderation:view') then raise exception 'You do not have permission to view moderation reports' using errcode = '42501'; end if;
  if p_status not in ('open', 'in_review', 'actioned', 'dismissed') or p_subject_type not in ('all', 'restaurant', 'menu_item', 'menu_import') or p_severity not in ('all', 'low', 'normal', 'high', 'urgent') then raise exception 'Unsupported moderation filter' using errcode = '22023'; end if;
  p_page := greatest(coalesce(p_page, 1), 1); p_page_size := least(greatest(coalesce(p_page_size, 30), 1), 100); offset_rows := (p_page - 1) * p_page_size;

  select count(*) into total_rows
  from public.platform_content_reports report
  join public.restaurants restaurant on restaurant.id = report.restaurant_id
  left join public.menu_items item on item.id = report.menu_item_id
  left join public.menu_imports mi on mi.id = report.menu_import_id
  where report.status = p_status
    and (p_subject_type = 'all' or report.subject_type = p_subject_type)
    and (p_severity = 'all' or report.severity = p_severity)
    and (clean_search = '' or concat_ws(' ', report.reference::text, report.summary, report.details, restaurant.name, item.name, mi.file_name, mi.error_message) ilike '%' || clean_search || '%');

  select jsonb_build_object(
    'entries', coalesce((select jsonb_agg(entry order by entry.severity_rank, entry.updated_at desc) from (
      select report.id, report.reference, report.source, report.subject_type, report.category, report.severity,
        case report.severity when 'urgent' then 1 when 'high' then 2 when 'normal' then 3 else 4 end as severity_rank,
        report.summary, report.status, report.enforcement_action, report.restaurant_id, restaurant.name as restaurant_name,
        coalesce(item.name, mi.file_name, restaurant.name) as subject_name,
        admin.display_name as assigned_to_name, report.created_at, report.updated_at
      from public.platform_content_reports report
      join public.restaurants restaurant on restaurant.id = report.restaurant_id
      left join public.menu_items item on item.id = report.menu_item_id
      left join public.menu_imports mi on mi.id = report.menu_import_id
      left join public.platform_admins admin on admin.user_id = report.assigned_to
      where report.status = p_status
        and (p_subject_type = 'all' or report.subject_type = p_subject_type)
        and (p_severity = 'all' or report.severity = p_severity)
        and (clean_search = '' or concat_ws(' ', report.reference::text, report.summary, report.details, restaurant.name, item.name, mi.file_name, mi.error_message) ilike '%' || clean_search || '%')
      order by severity_rank, report.updated_at desc limit p_page_size offset offset_rows
    ) entry), '[]'::jsonb),
    'metrics', jsonb_build_object(
      'open', (select count(*) from public.platform_content_reports where status in ('open', 'in_review')),
      'urgent', (select count(*) from public.platform_content_reports where status in ('open', 'in_review') and severity = 'urgent'),
      'unassigned', (select count(*) from public.platform_content_reports where status in ('open', 'in_review') and assigned_to is null),
      'failed_imports', (select count(*) from public.platform_content_reports where status in ('open', 'in_review') and subject_type = 'menu_import')
    ),
    'pagination', jsonb_build_object('page', p_page, 'page_size', p_page_size, 'total', total_rows, 'total_pages', greatest(ceil(total_rows::numeric / p_page_size)::integer, 1))
  ) into result;
  return result;
end;
$function$;

create or replace function public.get_platform_moderation_report(p_report_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare result jsonb;
begin
  if not private.has_platform_admin_permission('moderation:view') then raise exception 'You do not have permission to view moderation reports' using errcode = '42501'; end if;
  select jsonb_build_object(
    'report', jsonb_build_object(
      'id', report.id, 'reference', report.reference, 'source', report.source, 'subject_type', report.subject_type,
      'category', report.category, 'severity', report.severity, 'summary', report.summary, 'details', report.details,
      'status', report.status, 'assigned_to', report.assigned_to, 'assigned_to_name', admin.display_name,
      'restaurant_id', report.restaurant_id, 'restaurant_name', restaurant.name, 'restaurant_slug', restaurant.slug,
      'subject_name', coalesce(item.name, mi.file_name, restaurant.name), 'enforcement_action', report.enforcement_action,
      'enforcement_snapshot', report.enforcement_snapshot, 'resolution', report.resolution, 'resolved_at', report.resolved_at,
      'created_at', report.created_at, 'updated_at', report.updated_at,
      'target_state', case report.subject_type
        when 'restaurant' then jsonb_build_object('status', restaurant.status::text, 'accepting_orders', restaurant.accepting_orders)
        when 'menu_item' then jsonb_build_object('is_available', item.is_available, 'price_pence', item.price_pence, 'description', item.description)
        else jsonb_build_object('status', mi.status, 'file_name', mi.file_name, 'error_message', mi.error_message, 'created_at', mi.created_at)
      end
    ),
    'activity', coalesce((select jsonb_agg(activity order by activity.created_at desc) from (
      select a.id, a.event_type, a.note, a.metadata, a.created_at, coalesce(pa.display_name, 'System') as actor_name
      from public.platform_content_report_activity a left join public.platform_admins pa on pa.user_id = a.actor_user_id
      where a.report_id = report.id order by a.created_at desc
    ) activity), '[]'::jsonb)
  ) into result
  from public.platform_content_reports report
  join public.restaurants restaurant on restaurant.id = report.restaurant_id
  left join public.menu_items item on item.id = report.menu_item_id
  left join public.menu_imports mi on mi.id = report.menu_import_id
  left join public.platform_admins admin on admin.user_id = report.assigned_to
  where report.id = p_report_id;
  if result is null then raise exception 'Moderation report not found' using errcode = 'P0002'; end if;
  return result;
end;
$function$;

create or replace function public.manage_platform_moderation_report(
  p_report_id uuid, p_action text, p_reason text, p_expected_updated_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  actor_id uuid := (select auth.uid()); report public.platform_content_reports%rowtype;
  restaurant public.restaurants%rowtype; item public.menu_items%rowtype;
  clean_reason text := trim(coalesce(p_reason, '')); event_name text; snapshot jsonb; next_status text;
begin
  if not private.has_platform_admin_permission('moderation:manage') then raise exception 'You do not have permission to manage moderation reports' using errcode = '42501'; end if;
  if p_action not in ('assign_to_me', 'start_review', 'hide_content', 'reject_content', 'restore_content', 'resolve', 'dismiss') then raise exception 'Unsupported moderation action' using errcode = '22023'; end if;
  if length(clean_reason) not between 5 and 500 then raise exception 'Enter a reason between 5 and 500 characters' using errcode = '22023'; end if;

  select * into report from public.platform_content_reports where id = p_report_id for update;
  if report.id is null then raise exception 'Moderation report not found' using errcode = 'P0002'; end if;
  if p_expected_updated_at is not null and report.updated_at <> p_expected_updated_at then raise exception 'This report changed since you opened it. Refresh before acting.' using errcode = '40001'; end if;

  if p_action in ('assign_to_me', 'start_review') then
    if report.status not in ('open', 'in_review') then raise exception 'This report is already closed' using errcode = '22023'; end if;
    update public.platform_content_reports set assigned_to = actor_id, status = 'in_review', updated_at = now() where id = report.id;
    event_name := case when p_action = 'assign_to_me' then 'assigned' else 'review_started' end;
    next_status := 'in_review';
  elsif p_action in ('hide_content', 'reject_content') then
    if report.subject_type = 'menu_import' then
      if p_action <> 'reject_content' then raise exception 'Failed imports can be rejected, resolved or dismissed' using errcode = '22023'; end if;
      snapshot := jsonb_build_object('menu_import_id', report.menu_import_id);
    elsif report.subject_type = 'restaurant' then
      select * into restaurant from public.restaurants where id = report.restaurant_id for update;
      snapshot := jsonb_build_object('status', restaurant.status::text, 'accepting_orders', restaurant.accepting_orders);
      update public.restaurants set status = 'suspended', accepting_orders = false, updated_at = now() where id = restaurant.id;
    else
      select * into item from public.menu_items where id = report.menu_item_id and restaurant_id = report.restaurant_id for update;
      if item.id is null then raise exception 'Menu item no longer exists' using errcode = 'P0002'; end if;
      snapshot := jsonb_build_object('is_available', item.is_available);
      update public.menu_items set is_available = false, updated_at = now() where id = item.id;
    end if;
    update public.platform_content_reports set assigned_to = actor_id, status = 'actioned', resolution = clean_reason,
      enforcement_action = case when p_action = 'hide_content' then 'hidden' else 'rejected' end,
      enforcement_snapshot = snapshot, resolved_at = now(), updated_at = now() where id = report.id;
    event_name := case when p_action = 'hide_content' then 'content_hidden' else 'content_rejected' end; next_status := 'actioned';
  elsif p_action = 'restore_content' then
    if report.enforcement_action not in ('hidden', 'rejected') then raise exception 'This report has no moderated content to restore' using errcode = '22023'; end if;
    if report.subject_type = 'menu_import' then raise exception 'A rejected import cannot be restored; the restaurant must run a new scan' using errcode = '22023'; end if;
    if report.subject_type = 'restaurant' then
      update public.restaurants set
        status = case report.enforcement_snapshot ->> 'status'
          when 'active' then 'active'::public.restaurant_status when 'suspended' then 'suspended'::public.restaurant_status
          when 'pending_approval' then 'pending_approval'::public.restaurant_status when 'rejected' then 'rejected'::public.restaurant_status
          when 'draft' then 'draft'::public.restaurant_status
          else status end,
        accepting_orders = coalesce((report.enforcement_snapshot ->> 'accepting_orders')::boolean, false), updated_at = now()
      where id = report.restaurant_id;
    else
      if not exists (select 1 from public.menu_items where id = report.menu_item_id) then
        raise exception 'The moderated menu item no longer exists' using errcode = 'P0002';
      end if;
      update public.menu_items set is_available = coalesce((report.enforcement_snapshot ->> 'is_available')::boolean, true), updated_at = now() where id = report.menu_item_id;
    end if;
    update public.platform_content_reports set assigned_to = actor_id, status = 'actioned', resolution = clean_reason,
      enforcement_action = 'restored', resolved_at = now(), updated_at = now() where id = report.id;
    event_name := 'content_restored'; next_status := 'actioned';
  elsif p_action = 'dismiss' then
    update public.platform_content_reports set assigned_to = coalesce(assigned_to, actor_id), status = 'dismissed', resolution = clean_reason, resolved_at = now(), updated_at = now() where id = report.id;
    event_name := 'dismissed'; next_status := 'dismissed';
  else
    update public.platform_content_reports set assigned_to = coalesce(assigned_to, actor_id), status = 'actioned', resolution = clean_reason, resolved_at = now(), updated_at = now() where id = report.id;
    event_name := 'resolved'; next_status := 'actioned';
  end if;

  insert into public.platform_content_report_activity (report_id, event_type, note, actor_user_id, metadata)
  values (report.id, event_name, clean_reason, actor_id, jsonb_build_object('action', p_action, 'previous_status', report.status, 'next_status', next_status));
  insert into public.platform_admin_audit_log (actor_user_id, action, target_type, target_id, details)
  values (actor_id, 'moderation_' || p_action, 'moderation_report', report.id,
    jsonb_build_object('reference', report.reference, 'subject_type', report.subject_type, 'restaurant_id', report.restaurant_id, 'reason', clean_reason, 'previous_status', report.status, 'next_status', next_status));
  return jsonb_build_object('id', report.id, 'status', next_status, 'action', p_action);
end;
$function$;

revoke all on function public.search_platform_moderation_targets(text) from public, anon, authenticated;
revoke all on function public.create_platform_moderation_report(text, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.get_platform_moderation_queue(text, text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.get_platform_moderation_report(uuid) from public, anon, authenticated;
revoke all on function public.manage_platform_moderation_report(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.search_platform_moderation_targets(text) to authenticated;
grant execute on function public.create_platform_moderation_report(text, uuid, text, text, text, text) to authenticated;
grant execute on function public.get_platform_moderation_queue(text, text, text, text, integer, integer) to authenticated;
grant execute on function public.get_platform_moderation_report(uuid) to authenticated;
grant execute on function public.manage_platform_moderation_report(uuid, text, text, timestamptz) to authenticated;

comment on table public.platform_content_reports is 'Moderation queue for restaurant content, menu items and failed AI menu imports. Direct browser access is denied.';
comment on table public.platform_content_report_activity is 'Immutable activity history for platform content moderation reports.';

commit;
