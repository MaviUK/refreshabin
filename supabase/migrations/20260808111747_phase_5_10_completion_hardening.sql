begin;

create or replace function public.update_restaurant_team_member_access(
  p_user_id uuid,
  p_role public.restaurant_member_role,
  p_custom_role_id uuid,
  p_permissions jsonb
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  rid uuid;
  target public.restaurant_members%rowtype;
  custom_role public.restaurant_team_roles%rowtype;
begin
  select restaurant_id into rid
  from public.restaurant_members
  where user_id=(select auth.uid()) and role='owner' and status='active'
  order by created_at
  limit 1;

  if rid is null then
    raise exception 'Restaurant owner access required' using errcode='42501';
  end if;

  select * into target
  from public.restaurant_members
  where restaurant_id=rid and user_id=p_user_id;

  if target.id is null then
    raise exception 'Team member not found';
  end if;

  if target.role='owner' then
    raise exception 'Owner membership access cannot be changed here' using errcode='42501';
  end if;

  if p_role is null or p_role='owner' then
    raise exception 'Choose manager or staff for team members';
  end if;

  if p_permissions is null or jsonb_typeof(p_permissions)<>'array' then
    raise exception 'permissions must be a JSON array';
  end if;

  if p_custom_role_id is not null then
    select * into custom_role
    from public.restaurant_team_roles
    where id=p_custom_role_id and restaurant_id=rid and not is_system;

    if custom_role.id is null then
      raise exception 'Custom role not found for this restaurant';
    end if;
  end if;

  update public.restaurant_members
  set role=p_role,
      custom_role_id=p_custom_role_id,
      permissions=p_permissions,
      updated_at=now()
  where id=target.id;

  insert into public.restaurant_team_activity(
    restaurant_id,actor_user_id,target_user_id,action,details
  ) values (
    rid,(select auth.uid()),p_user_id,'access_updated',
    jsonb_build_object(
      'role',p_role,
      'custom_role_id',p_custom_role_id,
      'permissions',p_permissions
    )
  );
end;
$$;

revoke all on function public.update_restaurant_team_member_access(uuid,public.restaurant_member_role,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.update_restaurant_team_member_access(uuid,public.restaurant_member_role,uuid,jsonb) to authenticated;

create index if not exists restaurant_billing_credits_restaurant_id_idx on public.restaurant_billing_credits(restaurant_id);
create index if not exists restaurant_billing_credits_subscription_id_idx on public.restaurant_billing_credits(subscription_id);
create index if not exists restaurant_billing_credits_issued_by_idx on public.restaurant_billing_credits(issued_by);
create index if not exists restaurant_subscription_cancellations_subscription_id_idx on public.restaurant_subscription_cancellations(subscription_id);
create index if not exists restaurant_subscription_cancellations_requested_by_idx on public.restaurant_subscription_cancellations(requested_by);
create index if not exists restaurant_subscription_invoices_subscription_id_idx on public.restaurant_subscription_invoices(subscription_id);
create index if not exists restaurant_subscription_notification_deliveries_user_id_idx on public.restaurant_subscription_notification_deliveries(user_id);
create index if not exists restaurant_subscription_trial_history_plan_id_idx on public.restaurant_subscription_trial_history(plan_id);
create index if not exists restaurant_subscriptions_plan_id_idx on public.restaurant_subscriptions(plan_id);
create index if not exists restaurant_subscriptions_pending_plan_id_idx on public.restaurant_subscriptions(pending_plan_id);
create index if not exists restaurant_team_activity_actor_user_id_idx on public.restaurant_team_activity(actor_user_id);
create index if not exists restaurant_team_activity_target_user_id_idx on public.restaurant_team_activity(target_user_id);
create index if not exists restaurant_team_invites_custom_role_id_idx on public.restaurant_team_invites(custom_role_id);
create index if not exists restaurant_team_invites_invited_by_idx on public.restaurant_team_invites(invited_by);
create index if not exists restaurant_members_custom_role_id_idx on public.restaurant_members(custom_role_id);
create index if not exists restaurant_members_invited_by_idx on public.restaurant_members(invited_by);

commit;
