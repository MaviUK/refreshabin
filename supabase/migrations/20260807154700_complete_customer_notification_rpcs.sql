create or replace function public.get_customer_notifications(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  result jsonb;
  unread_total integer;
begin
  if uid is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  select count(*)::integer
    into unread_total
  from public.customer_notifications
  where customer_user_id = uid
    and read_at is null;

  select jsonb_build_object(
    'unread_count', unread_total,
    'notifications', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', id,
          'notification_type', notification_type,
          'title', title,
          'body', body,
          'action_url', action_url,
          'metadata', metadata,
          'read_at', read_at,
          'created_at', created_at
        ) order by created_at desc
      ),
      '[]'::jsonb
    )
  )
    into result
  from (
    select *
    from public.customer_notifications
    where customer_user_id = uid
    order by created_at desc
    limit least(greatest(p_limit, 1), 100)
  ) n;

  return result;
end;
$$;

revoke all on function public.get_customer_notifications(integer) from public, anon;
grant execute on function public.get_customer_notifications(integer) to authenticated, service_role;

create or replace function public.mark_all_customer_notifications_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  updated_count integer;
begin
  if uid is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  update public.customer_notifications
  set read_at = now()
  where customer_user_id = uid
    and read_at is null;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.mark_all_customer_notifications_read() from public, anon;
grant execute on function public.mark_all_customer_notifications_read() to authenticated, service_role;

revoke execute on function public.process_completed_order_stamp_cards() from public, anon, authenticated;
