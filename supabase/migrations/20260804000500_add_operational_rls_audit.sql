begin;

create or replace function public.get_platform_operational_rls_audit()
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
    raise exception 'You do not have permission to view the RLS audit' using errcode = '42501';
  end if;

  with critical_tables(table_name, tenant_column) as (
    values
      ('orders', 'restaurant_id'),
      ('order_items', 'order_id'),
      ('order_status_history', 'order_id'),
      ('restaurant_members', 'restaurant_id'),
      ('restaurant_locations', 'restaurant_id'),
      ('menu_categories', 'restaurant_id'),
      ('menu_items', 'restaurant_id'),
      ('menu_imports', 'restaurant_id'),
      ('restaurant_printers', 'restaurant_id'),
      ('print_jobs', 'restaurant_id')
  ), table_state as (
    select
      c.table_name,
      c.tenant_column,
      cls.oid is not null as table_exists,
      coalesce(cls.relrowsecurity, false) as rls_enabled,
      coalesce(cls.relforcerowsecurity, false) as force_rls,
      coalesce((
        select count(*)
        from pg_catalog.pg_policy pol
        where pol.polrelid = cls.oid
      ), 0)::integer as policy_count,
      coalesce((
        select count(*)
        from pg_catalog.pg_policy pol
        where pol.polrelid = cls.oid
          and pol.polcmd in ('a','r','w','d')
      ), 0)::integer as mutation_policy_count,
      coalesce((
        select bool_or(
          coalesce(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), '') ~* '(restaurant_members|restaurant_id|auth\\.uid\\(\\))'
          or coalesce(pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid), '') ~* '(restaurant_members|restaurant_id|auth\\.uid\\(\\))'
        )
        from pg_catalog.pg_policy pol
        where pol.polrelid = cls.oid
      ), false) as has_tenant_guard,
      coalesce((
        select bool_or(
          trim(coalesce(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), '')) in ('true', '(true)')
          or trim(coalesce(pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid), '')) in ('true', '(true)')
        )
        from pg_catalog.pg_policy pol
        where pol.polrelid = cls.oid
          and pol.polcmd in ('a','r','w','d')
      ), false) as has_unrestricted_mutation_policy
    from critical_tables c
    left join pg_catalog.pg_class cls
      on cls.relname = c.table_name
     and cls.relnamespace = 'public'::regnamespace
  )
  select jsonb_build_object(
    'generated_at', now(),
    'summary', jsonb_build_object(
      'tables_checked', count(*),
      'missing_tables', count(*) filter (where not table_exists),
      'rls_disabled', count(*) filter (where table_exists and not rls_enabled),
      'without_policies', count(*) filter (where table_exists and policy_count = 0),
      'without_tenant_guard', count(*) filter (where table_exists and not has_tenant_guard),
      'unrestricted_mutation_policies', count(*) filter (where has_unrestricted_mutation_policy)
    ),
    'tables', jsonb_agg(
      jsonb_build_object(
        'table_name', table_name,
        'tenant_column', tenant_column,
        'table_exists', table_exists,
        'rls_enabled', rls_enabled,
        'force_rls', force_rls,
        'policy_count', policy_count,
        'mutation_policy_count', mutation_policy_count,
        'has_tenant_guard', has_tenant_guard,
        'has_unrestricted_mutation_policy', has_unrestricted_mutation_policy,
        'status', case
          when not table_exists then 'not_present'
          when not rls_enabled then 'critical'
          when policy_count = 0 then 'critical'
          when has_unrestricted_mutation_policy then 'critical'
          when not has_tenant_guard then 'review'
          else 'ok'
        end
      ) order by table_name
    )
  ) into result
  from table_state;

  return result;
end;
$function$;

revoke all on function public.get_platform_operational_rls_audit() from public, anon, authenticated;
grant execute on function public.get_platform_operational_rls_audit() to authenticated;

commit;
