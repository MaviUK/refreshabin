begin;

create or replace function private.platform_admin_permissions(p_role text)
returns text[]
language sql
immutable
set search_path = ''
as $function$
  select case p_role
    when 'super_admin' then array[
      'overview:view','restaurants:view','restaurants:manage','orders:view','orders:manage',
      'orders:customer_details','customers:view','customers:manage','support:view','support:manage',
      'finance:view','finance:manage','settings:view','settings:manage','moderation:view',
      'moderation:manage','audit:view','admins:view','admins:manage'
    ]::text[]
    when 'operations' then array[
      'overview:view','restaurants:view','restaurants:manage','orders:view','orders:manage',
      'orders:customer_details','support:view','support:manage','settings:view','moderation:view',
      'moderation:manage','audit:view'
    ]::text[]
    when 'support' then array[
      'overview:view','restaurants:view','orders:view','orders:customer_details','customers:view',
      'customers:manage','support:view','support:manage','moderation:view','audit:view'
    ]::text[]
    when 'finance' then array[
      'overview:view','orders:view','support:view','finance:view','finance:manage','audit:view'
    ]::text[]
    else array[]::text[]
  end;
$function$;

revoke all on function private.platform_admin_permissions(text)
  from public, anon, authenticated, service_role;

alter function public.get_platform_customers(text) rename to get_platform_customers_unrestricted;
alter function public.get_platform_customer(uuid) rename to get_platform_customer_unrestricted;
alter function public.update_platform_customer_profile(uuid,text,text,text,text,text,text,text) rename to update_platform_customer_profile_unrestricted;
alter function public.set_platform_customer_suspension(uuid,boolean,text) rename to set_platform_customer_suspension_unrestricted;
alter function public.add_platform_customer_note(uuid,text) rename to add_platform_customer_note_unrestricted;

revoke all on function public.get_platform_customers_unrestricted(text) from public, anon, authenticated;
revoke all on function public.get_platform_customer_unrestricted(uuid) from public, anon, authenticated;
revoke all on function public.update_platform_customer_profile_unrestricted(uuid,text,text,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.set_platform_customer_suspension_unrestricted(uuid,boolean,text) from public, anon, authenticated;
revoke all on function public.add_platform_customer_note_unrestricted(uuid,text) from public, anon, authenticated;

create or replace function public.get_platform_customers(p_search text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not private.has_platform_admin_permission('customers:view') then
    raise exception 'You do not have permission to view customers' using errcode = '42501';
  end if;
  return public.get_platform_customers_unrestricted(p_search);
end;
$function$;

create or replace function public.get_platform_customer(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not private.has_platform_admin_permission('customers:view') then
    raise exception 'You do not have permission to view customers' using errcode = '42501';
  end if;
  return public.get_platform_customer_unrestricted(p_user_id);
end;
$function$;

create or replace function public.update_platform_customer_profile(
  p_user_id uuid,
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_address_line_1 text,
  p_address_line_2 text,
  p_town_city text,
  p_postcode text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not private.has_platform_admin_permission('customers:manage') then
    raise exception 'You do not have permission to manage customers' using errcode = '42501';
  end if;
  perform public.update_platform_customer_profile_unrestricted(
    p_user_id,p_first_name,p_last_name,p_phone,p_address_line_1,p_address_line_2,p_town_city,p_postcode
  );
end;
$function$;

create or replace function public.set_platform_customer_suspension(
  p_user_id uuid,
  p_suspended boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not private.has_platform_admin_permission('customers:manage') then
    raise exception 'You do not have permission to manage customers' using errcode = '42501';
  end if;
  perform public.set_platform_customer_suspension_unrestricted(p_user_id,p_suspended,p_reason);
end;
$function$;

create or replace function public.add_platform_customer_note(p_user_id uuid,p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not private.has_platform_admin_permission('customers:manage') then
    raise exception 'You do not have permission to manage customers' using errcode = '42501';
  end if;
  perform public.add_platform_customer_note_unrestricted(p_user_id,p_note);
end;
$function$;

revoke all on function public.get_platform_customers(text) from public, anon, authenticated;
revoke all on function public.get_platform_customer(uuid) from public, anon, authenticated;
revoke all on function public.update_platform_customer_profile(uuid,text,text,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.set_platform_customer_suspension(uuid,boolean,text) from public, anon, authenticated;
revoke all on function public.add_platform_customer_note(uuid,text) from public, anon, authenticated;

grant execute on function public.get_platform_customers(text) to authenticated;
grant execute on function public.get_platform_customer(uuid) to authenticated;
grant execute on function public.update_platform_customer_profile(uuid,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.set_platform_customer_suspension(uuid,boolean,text) to authenticated;
grant execute on function public.add_platform_customer_note(uuid,text) to authenticated;

commit;
