-- Searchable, paginated audit history for the standalone platform-admin app.
begin;

create index if not exists platform_admin_audit_log_action_created_idx on public.platform_admin_audit_log (action, created_at desc);
create index if not exists platform_admin_audit_log_actor_created_idx on public.platform_admin_audit_log (actor_user_id, created_at desc);

drop function if exists public.get_platform_admin_audit_log(integer);

create or replace function public.get_platform_admin_audit_log(
  p_action text default null, p_target_type text default null, p_actor_user_id uuid default null,
  p_search text default null, p_from timestamptz default null, p_to timestamptz default null,
  p_page integer default 1, p_page_size integer default 50
)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
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
  if clean_search is not null and length(clean_search) > 160 then
    raise exception 'Search text is too long' using errcode = '22023';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'The start date must be before the end date' using errcode = '22023';
  end if;

  with scoped as (
    select log.id, log.actor_user_id, log.action, log.target_type, log.target_id, log.details, log.created_at,
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
      and (clean_search is null or log.action ilike '%' || clean_search || '%' or log.target_type ilike '%' || clean_search || '%'
        or coalesce(log.target_id, '') ilike '%' || clean_search || '%' or coalesce(pa.display_name, '') ilike '%' || clean_search || '%'
        or coalesce(u.email, '') ilike '%' || clean_search || '%' or log.details::text ilike '%' || clean_search || '%')
  ), page_rows as (
    select * from scoped order by created_at desc, id desc limit safe_page_size offset (safe_page - 1) * safe_page_size
  )
  select jsonb_build_object(
    'entries', coalesce((select jsonb_agg(row_data order by row_data.created_at desc, row_data.id desc) from page_rows row_data), '[]'::jsonb),
    'pagination', jsonb_build_object('page', safe_page, 'page_size', safe_page_size, 'total', (select count(*) from scoped),
      'total_pages', greatest(ceil((select count(*) from scoped)::numeric / safe_page_size)::integer, 1)),
    'filters', jsonb_build_object(
      'actions', coalesce((select jsonb_agg(value order by value) from (select distinct action as value from public.platform_admin_audit_log) action_values), '[]'::jsonb),
      'target_types', coalesce((select jsonb_agg(value order by value) from (select distinct target_type as value from public.platform_admin_audit_log) target_values), '[]'::jsonb),
      'actors', coalesce((select jsonb_agg(actor order by actor.actor_name) from (
        select distinct log.actor_user_id as user_id, coalesce(nullif(pa.display_name, ''), u.email, 'Removed administrator') as actor_name,
          coalesce(u.email, 'Account unavailable') as actor_email
        from public.platform_admin_audit_log log left join auth.users u on u.id = log.actor_user_id
        left join public.platform_admins pa on pa.user_id = log.actor_user_id
      ) actor), '[]'::jsonb)
    )
  ) into result;
  return result;
end;
$function$;

revoke all on function public.get_platform_admin_audit_log(text, text, uuid, text, timestamptz, timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function public.get_platform_admin_audit_log(text, text, uuid, text, timestamptz, timestamptz, integer, integer) to authenticated;
comment on function public.get_platform_admin_audit_log(text, text, uuid, text, timestamptz, timestamptz, integer, integer) is 'Returns permission-checked, searchable and paginated platform administrator activity.';

commit;
