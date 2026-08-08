begin;

drop function if exists public.get_platform_admin_audit_log(text,text,text,text,timestamptz,timestamptz,integer,integer);

create or replace function public.get_platform_admin_audit_log(
  p_action text default null,
  p_target_type text default null,
  p_actor_user_id text default null,
  p_actor_type text default null,
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
set search_path=''
as $function$
declare
  result jsonb;
  clean_action text:=nullif(trim(coalesce(p_action,'')),'');
  clean_target_type text:=nullif(trim(coalesce(p_target_type,'')),'');
  clean_actor text:=nullif(trim(coalesce(p_actor_user_id,'')),'');
  clean_actor_type text:=nullif(trim(coalesce(p_actor_type,'')),'');
  actor_uuid uuid;
  clean_search text:=nullif(trim(coalesce(p_search,'')),'');
  safe_page integer:=greatest(coalesce(p_page,1),1);
  safe_page_size integer:=least(greatest(coalesce(p_page_size,50),1),100);
begin
  if not private.has_platform_admin_permission('audit:view') then raise exception 'You do not have permission to view the audit log' using errcode='42501'; end if;
  if clean_actor_type is not null and clean_actor_type not in ('admin','restaurant','user','system') then raise exception 'Unsupported actor type' using errcode='22023'; end if;
  if clean_actor is not null then begin actor_uuid:=clean_actor::uuid; exception when invalid_text_representation then raise exception 'Invalid actor filter' using errcode='22023'; end; end if;
  if clean_search is not null and length(clean_search)>160 then raise exception 'Search text is too long' using errcode='22023'; end if;
  if p_from is not null and p_to is not null and p_from>p_to then raise exception 'The start date must be before the end date' using errcode='22023'; end if;

  with scoped as materialized (
    select e.id,e.actor_type,e.actor_user_id,e.restaurant_id,e.action,e.target_type,e.target_id,e.details,e.created_at,
      case
        when e.actor_type='system' then 'System'
        when e.actor_type='restaurant' then coalesce(nullif(r.name,''),nullif(pa.display_name,''),u.email,'Restaurant user')
        when e.actor_type='admin' then coalesce(nullif(pa.display_name,''),u.email,'Removed administrator')
        else coalesce(nullif(trim(concat_ws(' ',cp.first_name,cp.last_name)),''),u.email,'Customer')
      end actor_name,
      case when e.actor_type='system' then null else u.email end actor_email,
      r.name restaurant_name
    from public.platform_audit_events e
    left join auth.users u on u.id=e.actor_user_id
    left join public.platform_admins pa on pa.user_id=e.actor_user_id
    left join public.customer_profiles cp on cp.user_id=e.actor_user_id
    left join public.restaurants r on r.id=e.restaurant_id
    where e.created_at>=now()-interval '30 days'
      and (clean_action is null or e.action=clean_action)
      and (clean_target_type is null or e.target_type=clean_target_type)
      and (clean_actor_type is null or e.actor_type=clean_actor_type)
      and (actor_uuid is null or e.actor_user_id=actor_uuid)
      and (p_from is null or e.created_at>=greatest(p_from,now()-interval '30 days'))
      and (p_to is null or e.created_at<=p_to)
      and (clean_search is null or e.action ilike '%'||clean_search||'%' or e.target_type ilike '%'||clean_search||'%' or coalesce(e.target_id::text,'') ilike '%'||clean_search||'%' or coalesce(r.name,'') ilike '%'||clean_search||'%' or coalesce(pa.display_name,'') ilike '%'||clean_search||'%' or coalesce(u.email,'') ilike '%'||clean_search||'%' or e.details::text ilike '%'||clean_search||'%')
  ), page_rows as (
    select * from scoped order by created_at desc,id desc limit safe_page_size offset (safe_page-1)*safe_page_size
  )
  select jsonb_build_object(
    'entries',coalesce((select jsonb_agg(row_data order by row_data.created_at desc,row_data.id desc) from page_rows row_data),'[]'::jsonb),
    'pagination',jsonb_build_object('page',safe_page,'page_size',safe_page_size,'total',(select count(*) from scoped),'total_pages',greatest(ceil((select count(*) from scoped)::numeric/safe_page_size)::integer,1)),
    'filters',jsonb_build_object(
      'actor_types',jsonb_build_array('admin','restaurant','user','system'),
      'actions',coalesce((select jsonb_agg(value order by value) from (select distinct action value from public.platform_audit_events where created_at>=now()-interval '30 days') x),'[]'::jsonb),
      'target_types',coalesce((select jsonb_agg(value order by value) from (select distinct target_type value from public.platform_audit_events where created_at>=now()-interval '30 days') x),'[]'::jsonb),
      'actors',coalesce((select jsonb_agg(actor order by actor.actor_name) from (
        select distinct e.actor_user_id user_id,
          case when e.actor_type='restaurant' then coalesce(nullif(r.name,''),u.email,'Restaurant user') when e.actor_type='admin' then coalesce(nullif(pa.display_name,''),u.email,'Removed administrator') else coalesce(nullif(trim(concat_ws(' ',cp.first_name,cp.last_name)),''),u.email,'Customer') end actor_name,
          coalesce(u.email,'Account unavailable') actor_email
        from public.platform_audit_events e
        left join auth.users u on u.id=e.actor_user_id
        left join public.platform_admins pa on pa.user_id=e.actor_user_id
        left join public.customer_profiles cp on cp.user_id=e.actor_user_id
        left join public.restaurants r on r.id=e.restaurant_id
        where e.created_at>=now()-interval '30 days' and e.actor_user_id is not null
        order by actor_name limit 250
      ) actor),'[]'::jsonb),
      'retention_days',30
    )
  ) into result;
  return result;
end;
$function$;

revoke all on function public.get_platform_admin_audit_log(text,text,text,text,text,timestamptz,timestamptz,integer,integer) from public,anon,authenticated;
grant execute on function public.get_platform_admin_audit_log(text,text,text,text,text,timestamptz,timestamptz,integer,integer) to authenticated;
comment on function public.get_platform_admin_audit_log(text,text,text,text,text,timestamptz,timestamptz,integer,integer) is 'Returns the unified 30-day customer, restaurant, admin and system audit trail.';

commit;
