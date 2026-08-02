begin;

create or replace function private.platform_admin_permissions(p_role text)
returns text[] language sql immutable set search_path='' as $f$
 select case p_role
  when 'super_admin' then array['overview:view','restaurants:view','restaurants:manage','orders:view','orders:manage','orders:customer_details','customers:view','support:view','support:manage','finance:view','finance:manage','audit:view','admins:view','admins:manage']::text[]
  when 'operations' then array['overview:view','restaurants:view','restaurants:manage','orders:view','orders:manage','orders:customer_details','support:view','support:manage','audit:view']::text[]
  when 'support' then array['overview:view','restaurants:view','orders:view','orders:customer_details','customers:view','support:view','support:manage','audit:view']::text[]
  when 'finance' then array['overview:view','orders:view','support:view','finance:view','finance:manage','audit:view']::text[]
  else array[]::text[] end;
$f$;
revoke all on function private.platform_admin_permissions(text) from public,anon,authenticated,service_role;

create sequence public.platform_support_case_number_seq start 1000;
create table public.platform_support_cases(
 id uuid primary key default gen_random_uuid(),
 case_number bigint not null unique default nextval('public.platform_support_case_number_seq'),
 subject text not null check(length(trim(subject)) between 3 and 160),
 description text not null check(length(trim(description)) between 3 and 4000),
 status text not null default 'open' check(status in('open','in_progress','waiting_customer','waiting_restaurant','escalated','resolved','closed')),
 priority text not null default 'normal' check(priority in('low','normal','high','urgent')),
 category text not null default 'general' check(category in('general','order','payment','refund','delivery','restaurant','account','dispute')),
 order_id uuid references public.orders(id) on delete set null,
 restaurant_id uuid references public.restaurants(id) on delete set null,
 customer_email text,
 customer_phone text,
 assigned_to uuid references public.platform_admins(user_id) on delete set null,
 created_by uuid references public.platform_admins(user_id) on delete set null,
 resolved_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.platform_support_activities(
 id uuid primary key default gen_random_uuid(), case_id uuid not null references public.platform_support_cases(id) on delete cascade,
 activity_type text not null check(activity_type in('case_created','internal_note','status_changed','priority_changed','assigned','unassigned')),
 body text check(body is null or length(trim(body)) between 2 and 4000), metadata jsonb not null default '{}'::jsonb,
 actor_user_id uuid references public.platform_admins(user_id) on delete set null, created_at timestamptz not null default now()
);
create index platform_support_cases_queue_idx on public.platform_support_cases(status,priority,updated_at desc);
create index platform_support_cases_order_idx on public.platform_support_cases(order_id) where order_id is not null;
create index platform_support_cases_restaurant_idx on public.platform_support_cases(restaurant_id) where restaurant_id is not null;
create index platform_support_cases_assignee_idx on public.platform_support_cases(assigned_to,status) where assigned_to is not null;
create index platform_support_activities_case_idx on public.platform_support_activities(case_id,created_at desc);
alter table public.platform_support_cases enable row level security;
alter table public.platform_support_activities enable row level security;
revoke all on public.platform_support_cases,public.platform_support_activities from public,anon,authenticated;
revoke all on sequence public.platform_support_case_number_seq from public,anon,authenticated;

create or replace function public.create_platform_support_case(p_subject text,p_description text,p_priority text default 'normal',p_category text default 'general',p_order_reference text default null,p_customer_email text default null)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare oid uuid; o public.orders%rowtype; cid uuid; clean_ref text:=nullif(trim(coalesce(p_order_reference,'')),''); clean_email text:=nullif(lower(trim(coalesce(p_customer_email,''))),'');
begin
 if not private.has_platform_admin_permission('support:manage') then raise exception 'You do not have permission to create support cases' using errcode='42501'; end if;
 if length(trim(coalesce(p_subject,''))) not between 3 and 160 or length(trim(coalesce(p_description,''))) not between 3 and 4000 then raise exception 'A valid subject and description are required'; end if;
 if p_priority not in('low','normal','high','urgent') or p_category not in('general','order','payment','refund','delivery','restaurant','account','dispute') then raise exception 'Unsupported case classification'; end if;
 if clean_ref is not null then
  select * into o from public.orders where id::text=clean_ref or order_number=case when clean_ref~'^[0-9]+$' then clean_ref::bigint else -1 end order by created_at desc limit 1;
  if not found then raise exception 'The linked order could not be found'; end if; oid:=o.id;
 end if;
 insert into public.platform_support_cases(subject,description,priority,category,order_id,restaurant_id,customer_email,customer_phone,assigned_to,created_by)
 values(trim(p_subject),trim(p_description),p_priority,p_category,oid,o.restaurant_id,coalesce(clean_email,o.customer_email),o.customer_phone,auth.uid(),auth.uid()) returning id into cid;
 insert into public.platform_support_activities(case_id,activity_type,body,actor_user_id) values(cid,'case_created',trim(p_description),auth.uid());
 insert into public.platform_admin_audit_log(actor_user_id,action,target_type,target_id,details) values(auth.uid(),'support_case_created','support_case',cid,jsonb_build_object('subject',trim(p_subject),'priority',p_priority,'category',p_category,'order_id',oid));
 return jsonb_build_object('id',cid);
end;$f$;

create or replace function public.get_platform_support_cases(p_status text default null,p_priority text default null,p_search text default null,p_page integer default 1,p_page_size integer default 40)
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare result jsonb; clean text:=nullif(trim(coalesce(p_search,'')),''); pg integer:=greatest(coalesce(p_page,1),1); sz integer:=least(greatest(coalesce(p_page_size,40),1),100); can_customer boolean:=private.has_platform_admin_permission('orders:customer_details');
begin
 if not private.has_platform_admin_permission('support:view') then raise exception 'You do not have permission to view support cases' using errcode='42501'; end if;
 if p_status is not null and p_status not in('open','in_progress','waiting_customer','waiting_restaurant','escalated','resolved','closed') then raise exception 'Unsupported status'; end if;
 if p_priority is not null and p_priority not in('low','normal','high','urgent') then raise exception 'Unsupported priority'; end if;
 with scoped as(select c.id,c.case_number,c.subject,c.status,c.priority,c.category,case when can_customer then c.customer_email else null end customer_email,r.name restaurant_name,o.order_number,c.assigned_to,pa.display_name assigned_to_name,c.updated_at,c.created_at from public.platform_support_cases c left join public.orders o on o.id=c.order_id left join public.restaurants r on r.id=c.restaurant_id left join public.platform_admins pa on pa.user_id=c.assigned_to where (p_status is null or c.status=p_status) and (p_priority is null or c.priority=p_priority) and (clean is null or c.case_number=case when clean~'^[0-9]+$' then clean::bigint else -1 end or o.order_number=case when clean~'^[0-9]+$' then clean::bigint else -1 end or c.subject ilike '%'||clean||'%' or (can_customer and c.customer_email ilike '%'||clean||'%') or r.name ilike '%'||clean||'%')), rows as(select * from scoped order by case priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,updated_at desc limit sz offset (pg-1)*sz)
 select jsonb_build_object('cases',coalesce((select jsonb_agg(x order by case x.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,x.updated_at desc) from rows x),'[]'::jsonb),'pagination',jsonb_build_object('page',pg,'total',(select count(*) from scoped),'total_pages',greatest(ceil((select count(*) from scoped)::numeric/sz)::integer,1)),'summary',jsonb_build_object('open',(select count(*) from public.platform_support_cases where status not in('resolved','closed')),'urgent',(select count(*) from public.platform_support_cases where priority='urgent' and status not in('resolved','closed')),'unassigned',(select count(*) from public.platform_support_cases where assigned_to is null and status not in('resolved','closed')),'resolved_today',(select count(*) from public.platform_support_cases where resolved_at::date=current_date))) into result; return result;
end;$f$;

create or replace function public.get_platform_support_case(p_case_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare result jsonb; can_customer boolean:=private.has_platform_admin_permission('orders:customer_details');
begin
 if not private.has_platform_admin_permission('support:view') then raise exception 'You do not have permission to view support cases' using errcode='42501'; end if;
 select jsonb_build_object('case',jsonb_build_object('id',c.id,'case_number',c.case_number,'subject',c.subject,'description',c.description,'status',c.status,'priority',c.priority,'category',c.category,'order_id',c.order_id,'order_number',o.order_number,'restaurant_id',c.restaurant_id,'restaurant_name',r.name,'customer_email',case when can_customer then c.customer_email else null end,'customer_phone',case when can_customer then c.customer_phone else null end,'assigned_to',c.assigned_to,'assigned_to_name',pa.display_name,'resolved_at',c.resolved_at,'created_at',c.created_at,'updated_at',c.updated_at),'activities',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'activity_type',a.activity_type,'body',a.body,'metadata',a.metadata,'actor_name',coalesce(ap.display_name,'Removed administrator'),'created_at',a.created_at) order by a.created_at desc) from public.platform_support_activities a left join public.platform_admins ap on ap.user_id=a.actor_user_id where a.case_id=c.id),'[]'::jsonb),'admins',(select coalesce(jsonb_agg(jsonb_build_object('user_id',x.user_id,'display_name',x.display_name) order by x.display_name),'[]'::jsonb) from public.platform_admins x where x.is_active)) into result from public.platform_support_cases c left join public.orders o on o.id=c.order_id left join public.restaurants r on r.id=c.restaurant_id left join public.platform_admins pa on pa.user_id=c.assigned_to where c.id=p_case_id;
 if result is null then raise exception 'Support case not found'; end if; return result;
end;$f$;

create or replace function public.manage_platform_support_case(p_case_id uuid,p_action text,p_value text default null) returns void language plpgsql security definer set search_path='' as $f$
declare c public.platform_support_cases%rowtype; target uuid; old text;
begin
 if not private.has_platform_admin_permission('support:manage') then raise exception 'You do not have permission to manage support cases' using errcode='42501'; end if;
 select * into c from public.platform_support_cases where id=p_case_id for update; if not found then raise exception 'Support case not found'; end if;
 if p_action='note' then if length(trim(coalesce(p_value,''))) not between 2 and 4000 then raise exception 'A note between 2 and 4000 characters is required'; end if; insert into public.platform_support_activities(case_id,activity_type,body,actor_user_id) values(c.id,'internal_note',trim(p_value),auth.uid());
 elsif p_action='status' then if p_value not in('open','in_progress','waiting_customer','waiting_restaurant','escalated','resolved','closed') then raise exception 'Unsupported status'; end if; old:=c.status; update public.platform_support_cases set status=p_value,resolved_at=case when p_value in('resolved','closed') then coalesce(resolved_at,now()) else null end,updated_at=now() where id=c.id; insert into public.platform_support_activities(case_id,activity_type,metadata,actor_user_id) values(c.id,'status_changed',jsonb_build_object('from',old,'to',p_value),auth.uid());
 elsif p_action='priority' then if p_value not in('low','normal','high','urgent') then raise exception 'Unsupported priority'; end if; old:=c.priority; update public.platform_support_cases set priority=p_value,updated_at=now() where id=c.id; insert into public.platform_support_activities(case_id,activity_type,metadata,actor_user_id) values(c.id,'priority_changed',jsonb_build_object('from',old,'to',p_value),auth.uid());
 elsif p_action='assign' then if p_value<>'unassigned' then begin target:=p_value::uuid; exception when invalid_text_representation then raise exception 'Invalid administrator'; end; if not exists(select 1 from public.platform_admins where user_id=target and is_active) then raise exception 'Administrator is not active'; end if; end if; update public.platform_support_cases set assigned_to=case when p_value='unassigned' then null else target end,updated_at=now() where id=c.id; insert into public.platform_support_activities(case_id,activity_type,metadata,actor_user_id) values(c.id,case when p_value='unassigned' then 'unassigned' else 'assigned' end,jsonb_build_object('assigned_to',target),auth.uid());
 else raise exception 'Unsupported case action'; end if;
 update public.platform_support_cases set updated_at=now() where id=c.id;
 insert into public.platform_admin_audit_log(actor_user_id,action,target_type,target_id,details) values(auth.uid(),'support_case_'||p_action,'support_case',c.id,jsonb_build_object('value',case when p_action='note' then '[internal note]' else p_value end));
end;$f$;

revoke all on function public.create_platform_support_case(text,text,text,text,text,text),public.get_platform_support_cases(text,text,text,integer,integer),public.get_platform_support_case(uuid),public.manage_platform_support_case(uuid,text,text) from public,anon,authenticated;
grant execute on function public.create_platform_support_case(text,text,text,text,text,text),public.get_platform_support_cases(text,text,text,integer,integer),public.get_platform_support_case(uuid),public.manage_platform_support_case(uuid,text,text) to authenticated;
commit;
