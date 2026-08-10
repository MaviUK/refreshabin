begin;

create or replace function public.get_platform_support_cases(
  p_status text default null,
  p_priority text default null,
  p_search text default null,
  p_page integer default 1,
  p_page_size integer default 40
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '8s'
as $function$
declare
  result jsonb;
  clean text := nullif(trim(coalesce(p_search, '')), '');
  pg integer := greatest(coalesce(p_page, 1), 1);
  sz integer := least(greatest(coalesce(p_page_size, 40), 1), 100);
  can_customer boolean := private.has_platform_admin_permission('orders:customer_details');
begin
  if not private.has_platform_admin_permission('support:view') then
    raise exception 'You do not have permission to view support cases' using errcode = '42501';
  end if;
  if length(coalesce(clean, '')) > 160 then
    raise exception 'Search text is too long' using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('open','in_progress','waiting_customer','waiting_restaurant','escalated','resolved','closed') then
    raise exception 'Unsupported status';
  end if;
  if p_priority is not null and p_priority not in ('low','normal','high','urgent') then
    raise exception 'Unsupported priority';
  end if;

  with scoped as materialized (
    select c.id, c.case_number, c.subject, c.status, c.priority, c.category,
      case when can_customer then c.customer_email else null end as customer_email,
      r.name as restaurant_name, o.order_number, c.assigned_to,
      pa.display_name as assigned_to_name, c.updated_at, c.created_at
    from public.platform_support_cases c
    left join public.orders o on o.id = c.order_id
    left join public.restaurants r on r.id = c.restaurant_id
    left join public.platform_admins pa on pa.user_id = c.assigned_to
    where (p_status is null or c.status = p_status)
      and (p_priority is null or c.priority = p_priority)
      and (clean is null
        or c.case_number = case when clean ~ '^[0-9]+$' then clean::bigint else -1 end
        or o.order_number = case when clean ~ '^[0-9]+$' then clean::bigint else -1 end
        or c.subject ilike '%' || clean || '%'
        or (can_customer and c.customer_email ilike '%' || clean || '%')
        or r.name ilike '%' || clean || '%')
  ), page_rows as (
    select * from scoped
    order by case priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, updated_at desc, id desc
    limit sz offset (pg - 1) * sz
  ), filtered_stats as (
    select count(*)::bigint as total from scoped
  ), queue_stats as (
    select
      count(*) filter (where status not in ('resolved','closed'))::bigint as open,
      count(*) filter (where priority = 'urgent' and status not in ('resolved','closed'))::bigint as urgent,
      count(*) filter (where assigned_to is null and status not in ('resolved','closed'))::bigint as unassigned,
      count(*) filter (where resolved_at >= date_trunc('day', now()) and resolved_at < date_trunc('day', now()) + interval '1 day')::bigint as resolved_today
    from public.platform_support_cases
  )
  select jsonb_build_object(
    'cases', coalesce((select jsonb_agg(x order by case x.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, x.updated_at desc, x.id desc) from page_rows x), '[]'::jsonb),
    'pagination', jsonb_build_object(
      'page', pg,
      'page_size', sz,
      'total', fs.total,
      'total_pages', greatest(ceil(fs.total::numeric / sz)::integer, 1)
    ),
    'summary', jsonb_build_object(
      'open', qs.open,
      'urgent', qs.urgent,
      'unassigned', qs.unassigned,
      'resolved_today', qs.resolved_today
    )
  ) into result
  from filtered_stats fs cross join queue_stats qs;

  return result;
end;
$function$;

create or replace function public.get_platform_admin_audit_log(
  p_action text default null,
  p_target_type text default null,
  p_actor_user_id uuid default null,
  p_search text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_page integer default 1,
  p_page_size integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '10s'
as $function$
declare
  result jsonb;
  clean_action text := nullif(trim(coalesce(p_action, '')), '');
  clean_target_type text := nullif(trim(coalesce(p_target_type, '')), '');
  clean_search text := nullif(trim(coalesce(p_search, '')), '');
  safe_page integer := greatest(coalesce(p_page, 1), 1);
  safe_page_size integer := least(greatest(coalesce(p_page_size, 50), 1), 100);
begin
  if not private.has_platform_admin_permission('audit:view') then
    raise exception 'You do not have permission to view the audit log' using errcode = '42501';
  end if;
  if length(coalesce(clean_search, '')) > 160 then
    raise exception 'Search text is too long' using errcode = '22023';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'The start date must be before the end date' using errcode = '22023';
  end if;

  with scoped as materialized (
    select log.id, log.actor_user_id, log.action, log.target_type, log.target_id,
      log.details, log.created_at,
      coalesce(nullif(pa.display_name, ''), u.email, 'Removed administrator') as actor_name,
      coalesce(u.email, 'Account unavailable') as actor_email
    from public.platform_admin_audit_log log
    left join auth.users u on u.id = log.actor_user_id
    left join public.platform_admins pa on pa.user_id = log.actor_user_id
    where (clean_action is null or log.action = clean_action)
      and (clean_target_type is null or log.target_type = clean_target_type)
      and (p_actor_user_id is null or log.actor_user_id = p_actor_user_id)
      and (p_from is null or log.created_at >= p_from)
      and (p_to is null or log.created_at <= p_to)
      and (clean_search is null
        or log.action ilike '%' || clean_search || '%'
        or log.target_type ilike '%' || clean_search || '%'
        or coalesce(log.target_id, '') ilike '%' || clean_search || '%'
        or coalesce(pa.display_name, '') ilike '%' || clean_search || '%'
        or coalesce(u.email, '') ilike '%' || clean_search || '%'
        or log.details::text ilike '%' || clean_search || '%')
  ), page_rows as (
    select * from scoped
    order by created_at desc, id desc
    limit safe_page_size offset (safe_page - 1) * safe_page_size
  ), stats as (
    select count(*)::bigint as total from scoped
  )
  select jsonb_build_object(
    'entries', coalesce((select jsonb_agg(row_data order by row_data.created_at desc, row_data.id desc) from page_rows row_data), '[]'::jsonb),
    'pagination', jsonb_build_object(
      'page', safe_page,
      'page_size', safe_page_size,
      'total', stats.total,
      'total_pages', greatest(ceil(stats.total::numeric / safe_page_size)::integer, 1)
    ),
    'filters', jsonb_build_object(
      'actions', coalesce((select jsonb_agg(value order by value) from (select distinct action as value from public.platform_admin_audit_log) action_values), '[]'::jsonb),
      'target_types', coalesce((select jsonb_agg(value order by value) from (select distinct target_type as value from public.platform_admin_audit_log) target_values), '[]'::jsonb),
      'actors', coalesce((select jsonb_agg(actor order by actor.actor_name) from (
        select pa.user_id, coalesce(nullif(pa.display_name, ''), u.email, 'Removed administrator') as actor_name,
          coalesce(u.email, 'Account unavailable') as actor_email
        from public.platform_admins pa
        left join auth.users u on u.id = pa.user_id
        order by actor_name
      ) actor), '[]'::jsonb)
    )
  ) into result
  from stats;

  return result;
end;
$function$;

revoke all on function public.get_platform_support_cases(text,text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.get_platform_support_cases(text,text,text,integer,integer) to authenticated;
revoke all on function public.get_platform_admin_audit_log(text,text,uuid,text,timestamptz,timestamptz,integer,integer) from public, anon, authenticated;
grant execute on function public.get_platform_admin_audit_log(text,text,uuid,text,timestamptz,timestamptz,integer,integer) to authenticated;

commit;
