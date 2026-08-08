begin;

create table if not exists public.platform_audit_events (
  id bigint generated always as identity primary key,
  actor_type text not null check (actor_type in ('admin','restaurant','user','system')),
  actor_user_id uuid references auth.users(id) on delete set null,
  restaurant_id uuid references public.restaurants(id) on delete set null,
  action text not null check (char_length(action) between 2 and 120),
  target_type text not null check (char_length(target_type) between 2 and 120),
  target_id uuid,
  details jsonb not null default '{}'::jsonb,
  source_admin_audit_id bigint unique references public.platform_admin_audit_log(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists platform_audit_events_created_idx on public.platform_audit_events(created_at desc);
create index if not exists platform_audit_events_actor_type_created_idx on public.platform_audit_events(actor_type, created_at desc);
create index if not exists platform_audit_events_actor_created_idx on public.platform_audit_events(actor_user_id, created_at desc) where actor_user_id is not null;
create index if not exists platform_audit_events_restaurant_created_idx on public.platform_audit_events(restaurant_id, created_at desc) where restaurant_id is not null;
create index if not exists platform_audit_events_target_created_idx on public.platform_audit_events(target_type, target_id, created_at desc);
alter table public.platform_audit_events enable row level security;
revoke all on public.platform_audit_events from public, anon, authenticated;

create or replace function private.platform_audit_actor_type(p_user_id uuid, p_restaurant_id uuid default null)
returns text language plpgsql stable security definer set search_path='' as $function$
begin
  if p_user_id is null then return 'system'; end if;
  if exists(select 1 from public.platform_admins pa where pa.user_id=p_user_id and pa.is_active) then return 'admin'; end if;
  if exists(select 1 from public.restaurant_members rm where rm.user_id=p_user_id and rm.status='active' and (p_restaurant_id is null or rm.restaurant_id=p_restaurant_id)) then return 'restaurant'; end if;
  return 'user';
end;
$function$;
revoke all on function private.platform_audit_actor_type(uuid,uuid) from public,anon,authenticated;

create or replace function private.mirror_platform_admin_audit_event()
returns trigger language plpgsql security definer set search_path='' as $function$
declare rid uuid;
begin
  rid := case when new.target_type='restaurant' then new.target_id else null end;
  insert into public.platform_audit_events(actor_type,actor_user_id,restaurant_id,action,target_type,target_id,details,source_admin_audit_id,created_at)
  values('admin',new.actor_user_id,rid,new.action,new.target_type,new.target_id,new.details,new.id,new.created_at)
  on conflict(source_admin_audit_id) do nothing;
  return new;
end;
$function$;
revoke all on function private.mirror_platform_admin_audit_event() from public,anon,authenticated;
drop trigger if exists platform_admin_audit_mirror on public.platform_admin_audit_log;
create trigger platform_admin_audit_mirror after insert on public.platform_admin_audit_log for each row execute function private.mirror_platform_admin_audit_event();

insert into public.platform_audit_events(actor_type,actor_user_id,restaurant_id,action,target_type,target_id,details,source_admin_audit_id,created_at)
select 'admin',l.actor_user_id,case when l.target_type='restaurant' then l.target_id else null end,l.action,l.target_type,l.target_id,l.details,l.id,l.created_at
from public.platform_admin_audit_log l
where l.created_at>=now()-interval '30 days'
on conflict(source_admin_audit_id) do nothing;

create or replace function private.audit_restaurant_entity_change()
returns trigger language plpgsql security definer set search_path='' as $function$
declare row_data jsonb; actor_id uuid:=auth.uid(); rid uuid; tid uuid; actor_kind text; entity_name text;
begin
  row_data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_table_name='restaurants' then rid:=nullif(row_data->>'id','')::uuid; else rid:=nullif(row_data->>'restaurant_id','')::uuid; end if;
  tid:=nullif(row_data->>'id','')::uuid;
  actor_kind:=private.platform_audit_actor_type(actor_id,rid);
  if actor_kind='admin' then return case when tg_op='DELETE' then old else new end; end if;
  entity_name:=nullif(row_data->>'name','');
  insert into public.platform_audit_events(actor_type,actor_user_id,restaurant_id,action,target_type,target_id,details)
  values(actor_kind,actor_id,rid,tg_table_name||'_'||lower(tg_op),tg_table_name,tid,jsonb_strip_nulls(jsonb_build_object('entity_name',entity_name)));
  return case when tg_op='DELETE' then old else new end;
end;
$function$;
revoke all on function private.audit_restaurant_entity_change() from public,anon,authenticated;

create or replace function private.audit_customer_profile_change()
returns trigger language plpgsql security definer set search_path='' as $function$
declare row_data jsonb; actor_id uuid:=auth.uid(); customer_id uuid; actor_kind text;
begin
  row_data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  customer_id:=nullif(row_data->>'user_id','')::uuid;
  actor_kind:=private.platform_audit_actor_type(actor_id,null);
  if actor_kind='admin' then return case when tg_op='DELETE' then old else new end; end if;
  if actor_id is null then actor_id:=customer_id; actor_kind:=case when customer_id is null then 'system' else 'user' end; end if;
  insert into public.platform_audit_events(actor_type,actor_user_id,action,target_type,target_id,details)
  values(actor_kind,actor_id,'customer_profile_'||lower(tg_op),'customer_profile',customer_id,'{}'::jsonb);
  return case when tg_op='DELETE' then old else new end;
end;
$function$;
revoke all on function private.audit_customer_profile_change() from public,anon,authenticated;

create or replace function private.audit_customer_address_change()
returns trigger language plpgsql security definer set search_path='' as $function$
declare row_data jsonb; actor_id uuid:=auth.uid(); customer_id uuid; address_id uuid; actor_kind text;
begin
  row_data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  customer_id:=nullif(row_data->>'user_id','')::uuid; address_id:=nullif(row_data->>'id','')::uuid;
  actor_kind:=private.platform_audit_actor_type(actor_id,null);
  if actor_kind='admin' then return case when tg_op='DELETE' then old else new end; end if;
  if actor_id is null then actor_id:=customer_id; actor_kind:=case when customer_id is null then 'system' else 'user' end; end if;
  insert into public.platform_audit_events(actor_type,actor_user_id,action,target_type,target_id,details)
  values(actor_kind,actor_id,'customer_address_'||lower(tg_op),'customer_address',address_id,'{}'::jsonb);
  return case when tg_op='DELETE' then old else new end;
end;
$function$;
revoke all on function private.audit_customer_address_change() from public,anon,authenticated;

create or replace function private.audit_order_change()
returns trigger language plpgsql security definer set search_path='' as $function$
declare actor_id uuid:=auth.uid(); actor_kind text; effective_actor uuid;
begin
  actor_kind:=private.platform_audit_actor_type(actor_id,new.restaurant_id);
  if actor_kind='admin' then return new; end if;
  effective_actor:=actor_id;
  if tg_op='INSERT' then
    if effective_actor is null and new.customer_user_id is not null then effective_actor:=new.customer_user_id; actor_kind:='user'; end if;
    insert into public.platform_audit_events(actor_type,actor_user_id,restaurant_id,action,target_type,target_id,details)
    values(actor_kind,effective_actor,new.restaurant_id,'order_created','order',new.id,jsonb_strip_nulls(jsonb_build_object('order_number',new.order_number,'fulfilment_method',new.fulfilment_method)));
    return new;
  end if;
  if old.order_status is distinct from new.order_status then
    insert into public.platform_audit_events(actor_type,actor_user_id,restaurant_id,action,target_type,target_id,details)
    values(actor_kind,effective_actor,new.restaurant_id,'order_status_changed','order',new.id,jsonb_build_object('order_number',new.order_number,'from_status',old.order_status,'to_status',new.order_status));
  end if;
  if old.payment_status is distinct from new.payment_status then
    insert into public.platform_audit_events(actor_type,actor_user_id,restaurant_id,action,target_type,target_id,details)
    values(actor_kind,effective_actor,new.restaurant_id,'order_payment_status_changed','order',new.id,jsonb_build_object('order_number',new.order_number,'from_status',old.payment_status,'to_status',new.payment_status));
  end if;
  return new;
end;
$function$;
revoke all on function private.audit_order_change() from public,anon,authenticated;

drop trigger if exists audit_restaurants_activity on public.restaurants;
create trigger audit_restaurants_activity after insert or update or delete on public.restaurants for each row execute function private.audit_restaurant_entity_change();
drop trigger if exists audit_menu_categories_activity on public.menu_categories;
create trigger audit_menu_categories_activity after insert or update or delete on public.menu_categories for each row execute function private.audit_restaurant_entity_change();
drop trigger if exists audit_menu_items_activity on public.menu_items;
create trigger audit_menu_items_activity after insert or update or delete on public.menu_items for each row execute function private.audit_restaurant_entity_change();
drop trigger if exists audit_modifier_groups_activity on public.modifier_groups;
create trigger audit_modifier_groups_activity after insert or update or delete on public.modifier_groups for each row execute function private.audit_restaurant_entity_change();
drop trigger if exists audit_customer_profiles_activity on public.customer_profiles;
create trigger audit_customer_profiles_activity after insert or update or delete on public.customer_profiles for each row execute function private.audit_customer_profile_change();
drop trigger if exists audit_customer_addresses_activity on public.customer_addresses;
create trigger audit_customer_addresses_activity after insert or update or delete on public.customer_addresses for each row execute function private.audit_customer_address_change();
drop trigger if exists audit_orders_activity on public.orders;
create trigger audit_orders_activity after insert or update of order_status,payment_status on public.orders for each row execute function private.audit_order_change();

create or replace function public.record_platform_sign_in(p_actor_type text)
returns void language plpgsql security definer set search_path='' as $function$
declare uid uuid:=auth.uid(); rid uuid;
begin
  if uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_actor_type='admin' then
    if not exists(select 1 from public.platform_admins pa where pa.user_id=uid and pa.is_active) then raise exception 'Platform administrator access required' using errcode='42501'; end if;
  elsif p_actor_type='restaurant' then
    select rm.restaurant_id into rid from public.restaurant_members rm where rm.user_id=uid and rm.status='active' order by rm.created_at asc limit 1;
    if rid is null then raise exception 'Restaurant access required' using errcode='42501'; end if;
  elsif p_actor_type<>'user' then raise exception 'Unsupported audit actor type' using errcode='22023'; end if;
  insert into public.platform_audit_events(actor_type,actor_user_id,restaurant_id,action,target_type,target_id,details)
  values(p_actor_type,uid,rid,case p_actor_type when 'admin' then 'admin_signed_in' when 'restaurant' then 'restaurant_signed_in' else 'user_signed_in' end,p_actor_type,case when p_actor_type='restaurant' then rid else uid end,'{}'::jsonb);
end;
$function$;
revoke all on function public.record_platform_sign_in(text) from public,anon,authenticated;
grant execute on function public.record_platform_sign_in(text) to authenticated;

insert into public.platform_audit_events(actor_type,actor_user_id,restaurant_id,action,target_type,target_id,details,created_at)
select 'user',o.customer_user_id,o.restaurant_id,'order_created','order',o.id,jsonb_strip_nulls(jsonb_build_object('order_number',o.order_number,'fulfilment_method',o.fulfilment_method,'backfilled',true)),o.created_at
from public.orders o
where o.customer_user_id is not null and o.created_at>=now()-interval '30 days'
  and not exists(select 1 from public.platform_audit_events e where e.action='order_created' and e.target_type='order' and e.target_id=o.id);

create or replace function private.purge_platform_audit_logs()
returns jsonb language plpgsql security definer set search_path='' as $function$
declare event_count integer; admin_count integer;
begin
  delete from public.platform_audit_events where created_at<now()-interval '30 days'; get diagnostics event_count=row_count;
  delete from public.platform_admin_audit_log where created_at<now()-interval '30 days'; get diagnostics admin_count=row_count;
  return jsonb_build_object('audit_events_deleted',event_count,'admin_audit_rows_deleted',admin_count);
end;
$function$;
revoke all on function private.purge_platform_audit_logs() from public,anon,authenticated;

select cron.unschedule(jobid) from cron.job where jobname='platform-audit-retention-30d';
select cron.schedule('platform-audit-retention-30d','15 3 * * *',$$select private.purge_platform_audit_logs();$$);

comment on table public.platform_audit_events is '30-day unified audit stream for customer, restaurant, platform-admin and system activity.';
notify pgrst,'reload schema';
commit;
