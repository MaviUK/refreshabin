begin;

alter table public.platform_support_cases
  add column if not exists response_due_at timestamptz,
  add column if not exists resolution_due_at timestamptz,
  add column if not exists first_response_at timestamptz,
  add column if not exists last_contact_at timestamptz;

alter table public.platform_support_activities
  drop constraint if exists platform_support_activities_activity_type_check;

alter table public.platform_support_activities
  add constraint platform_support_activities_activity_type_check
  check (activity_type in (
    'case_created','internal_note','status_changed','priority_changed','assigned','unassigned',
    'case_claimed','sla_changed','customer_contact','restaurant_contact'
  ));

create index if not exists platform_support_cases_response_due_idx
  on public.platform_support_cases (response_due_at)
  where status not in ('resolved','closed') and first_response_at is null;

create index if not exists platform_support_cases_resolution_due_idx
  on public.platform_support_cases (resolution_due_at)
  where status not in ('resolved','closed');

update public.platform_support_cases
set response_due_at = coalesce(response_due_at, created_at + case priority
      when 'urgent' then interval '30 minutes'
      when 'high' then interval '2 hours'
      when 'normal' then interval '8 hours'
      else interval '1 day' end),
    resolution_due_at = coalesce(resolution_due_at, created_at + case priority
      when 'urgent' then interval '4 hours'
      when 'high' then interval '12 hours'
      when 'normal' then interval '2 days'
      else interval '4 days' end);

create or replace function public.get_platform_support_sla_queue(
  p_filter text default 'all',
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
  clean_search text := nullif(trim(coalesce(p_search, '')), '');
begin
  if not private.has_platform_admin_permission('support:view') then
    raise exception 'You do not have permission to view support cases' using errcode = '42501';
  end if;

  if p_filter not in ('all','overdue','due_soon','unassigned','mine') then
    raise exception 'Unsupported SLA filter' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'summary', jsonb_build_object(
      'overdue', (select count(*) from public.platform_support_cases c where c.status not in ('resolved','closed') and (coalesce(c.first_response_at is null and c.response_due_at < now(), false) or coalesce(c.resolution_due_at < now(), false))),
      'due_soon', (select count(*) from public.platform_support_cases c where c.status not in ('resolved','closed') and least(coalesce(c.response_due_at, 'infinity'), coalesce(c.resolution_due_at, 'infinity')) between now() and now() + interval '2 hours'),
      'unassigned', (select count(*) from public.platform_support_cases c where c.status not in ('resolved','closed') and c.assigned_to is null),
      'mine', (select count(*) from public.platform_support_cases c where c.status not in ('resolved','closed') and c.assigned_to = auth.uid())
    ),
    'cases', coalesce((
      select jsonb_agg(row_data order by row_data.is_overdue desc, row_data.next_due_at asc nulls last, row_data.updated_at desc)
      from (
        select
          c.id, c.case_number, c.subject, c.status, c.priority, c.category,
          c.customer_email, r.name as restaurant_name, o.order_number,
          c.assigned_to, pa.display_name as assigned_to_name,
          c.response_due_at, c.resolution_due_at, c.first_response_at, c.last_contact_at,
          c.updated_at, c.created_at,
          least(
            case when c.first_response_at is null then c.response_due_at else null end,
            c.resolution_due_at
          ) as next_due_at,
          (
            (c.first_response_at is null and c.response_due_at < now())
            or c.resolution_due_at < now()
          ) as is_overdue
        from public.platform_support_cases c
        left join public.orders o on o.id = c.order_id
        left join public.restaurants r on r.id = c.restaurant_id
        left join public.platform_admins pa on pa.user_id = c.assigned_to
        where c.status not in ('resolved','closed')
          and (
            clean_search is null
            or c.subject ilike '%' || clean_search || '%'
            or c.case_number = case when clean_search ~ '^[0-9]+$' then clean_search::bigint else -1 end
            or o.order_number = case when clean_search ~ '^[0-9]+$' then clean_search::bigint else -1 end
            or c.customer_email ilike '%' || clean_search || '%'
            or r.name ilike '%' || clean_search || '%'
          )
          and (
            p_filter = 'all'
            or (p_filter = 'overdue' and ((c.first_response_at is null and c.response_due_at < now()) or c.resolution_due_at < now()))
            or (p_filter = 'due_soon' and least(case when c.first_response_at is null then c.response_due_at else null end, c.resolution_due_at) between now() and now() + interval '2 hours')
            or (p_filter = 'unassigned' and c.assigned_to is null)
            or (p_filter = 'mine' and c.assigned_to = auth.uid())
          )
      ) row_data
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$function$;

create or replace function public.manage_platform_support_sla(
  p_case_id uuid,
  p_action text,
  p_value text default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  c public.platform_support_cases%rowtype;
  clean_note text := nullif(trim(coalesce(p_note, '')), '');
  due_value timestamptz;
begin
  if not private.has_platform_admin_permission('support:manage') then
    raise exception 'You do not have permission to manage support cases' using errcode = '42501';
  end if;

  select * into c from public.platform_support_cases where id = p_case_id for update;
  if not found then raise exception 'Support case not found'; end if;

  if p_action = 'claim' then
    update public.platform_support_cases set assigned_to = auth.uid(), updated_at = now() where id = c.id;
    insert into public.platform_support_activities(case_id,activity_type,metadata,actor_user_id)
    values(c.id,'case_claimed',jsonb_build_object('previous_assignee',c.assigned_to),auth.uid());

  elsif p_action in ('customer_contact','restaurant_contact') then
    if clean_note is null or length(clean_note) < 2 then raise exception 'Add a contact summary'; end if;
    update public.platform_support_cases
    set first_response_at = coalesce(first_response_at, now()), last_contact_at = now(), updated_at = now()
    where id = c.id;
    insert into public.platform_support_activities(case_id,activity_type,body,actor_user_id)
    values(c.id,p_action,clean_note,auth.uid());

  elsif p_action in ('response_due','resolution_due') then
    begin due_value := p_value::timestamptz; exception when others then raise exception 'Enter a valid deadline'; end;
    if due_value <= now() then raise exception 'Deadline must be in the future'; end if;
    update public.platform_support_cases
    set response_due_at = case when p_action='response_due' then due_value else response_due_at end,
        resolution_due_at = case when p_action='resolution_due' then due_value else resolution_due_at end,
        updated_at = now()
    where id = c.id;
    insert into public.platform_support_activities(case_id,activity_type,body,metadata,actor_user_id)
    values(c.id,'sla_changed',clean_note,jsonb_build_object('deadline_type',p_action,'deadline',due_value),auth.uid());
  else
    raise exception 'Unsupported support SLA action';
  end if;

  insert into public.platform_admin_audit_log(actor_user_id,action,target_type,target_id,details)
  values(auth.uid(),'support_sla_'||p_action,'support_case',c.id,jsonb_build_object('value',p_value,'note',clean_note));
end;
$function$;

revoke all on function public.get_platform_support_sla_queue(text,text), public.manage_platform_support_sla(uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.get_platform_support_sla_queue(text,text), public.manage_platform_support_sla(uuid,text,text,text)
  to authenticated;

commit;
