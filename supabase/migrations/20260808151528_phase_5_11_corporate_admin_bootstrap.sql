create or replace function public.platform_assign_restaurant_group_admin_by_email(p_group_id uuid,p_email text,p_reason text default 'Platform provisioning')
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user_id uuid; v_member_id uuid;
begin
 if not private.platform_admin_has_permission('restaurants:manage') then raise exception 'Platform restaurant management permission required' using errcode='42501'; end if;
 select u.id into v_user_id from auth.users u where lower(u.email)=lower(btrim(p_email)) limit 1;
 if v_user_id is null then raise exception 'No ordered.food account exists for this email. Ask the corporate admin to create an account first.'; end if;
 v_member_id:=public.platform_assign_restaurant_group_admin(p_group_id,v_user_id,p_reason);
 return v_member_id;
end $$;
revoke all on function public.platform_assign_restaurant_group_admin_by_email(uuid,text,text) from public,anon;
grant execute on function public.platform_assign_restaurant_group_admin_by_email(uuid,text,text) to authenticated;
