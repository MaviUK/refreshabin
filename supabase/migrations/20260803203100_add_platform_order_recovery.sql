begin;

create table if not exists public.platform_order_actions (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id),
  action text not null check (action in ('cancel', 'requeue_print')),
  reason text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists platform_order_actions_order_idx
  on public.platform_order_actions (order_id, created_at desc);

alter table public.platform_order_actions enable row level security;
revoke all on table public.platform_order_actions from public, anon, authenticated;

create or replace function public.get_platform_order_recovery(p_order_number bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  if not private.has_platform_admin_permission('orders:view') then
    raise exception 'You do not have permission to view orders' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'order', jsonb_build_object(
      'id', o.id,
      'order_number', o.order_number,
      'restaurant_name', r.name,
      'customer_name', trim(o.customer_first_name || ' ' || o.customer_last_name),
      'order_status', o.order_status,
      'payment_status', o.payment_status,
      'total_pence', o.total_pence,
      'fulfilment_method', o.fulfilment_method,
      'created_at', o.created_at,
      'cancelled_at', o.cancelled_at
    ),
    'print_jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pj.id,
        'printer_name', coalesce(rp.name, 'Unassigned printer'),
        'document_type', pj.document_type,
        'status', pj.status,
        'attempts', pj.attempts,
        'last_error', pj.last_error,
        'queued_at', pj.queued_at,
        'printed_at', pj.printed_at
      ) order by pj.created_at desc)
      from public.print_jobs pj
      left join public.restaurant_printers rp on rp.id = pj.printer_id
      where pj.order_id = o.id
    ), '[]'::jsonb),
    'actions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'action', a.action,
        'reason', a.reason,
        'details', a.details,
        'created_at', a.created_at,
        'actor_name', coalesce(pa.display_name, u.email, 'Administrator')
      ) order by a.created_at desc)
      from public.platform_order_actions a
      left join public.platform_admins pa on pa.user_id = a.actor_user_id
      left join auth.users u on u.id = a.actor_user_id
      where a.order_id = o.id
    ), '[]'::jsonb)
  ) into result
  from public.orders o
  join public.restaurants r on r.id = o.restaurant_id
  where o.order_number = p_order_number;

  if result is null then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  return result;
end;
$function$;

create or replace function public.recover_platform_order(
  p_order_id uuid,
  p_action text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
  current_order public.orders%rowtype;
  affected integer := 0;
begin
  if not private.has_platform_admin_permission('orders:manage') then
    raise exception 'You do not have permission to manage orders' using errcode = '42501';
  end if;
  if p_action not in ('cancel', 'requeue_print') then
    raise exception 'Unsupported recovery action' using errcode = '22023';
  end if;
  if clean_reason is null or length(clean_reason) < 3 then
    raise exception 'A clear reason is required' using errcode = '22023';
  end if;

  select * into current_order from public.orders where id = p_order_id for update;
  if current_order.id is null then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  if p_action = 'cancel' then
    if current_order.order_status in ('completed', 'cancelled', 'rejected') then
      raise exception 'This order can no longer be cancelled' using errcode = '22023';
    end if;

    update public.orders
    set order_status = 'cancelled', cancelled_at = now(), updated_at = now()
    where id = p_order_id;

    insert into public.order_status_history (order_id, from_status, to_status, note, changed_by)
    values (p_order_id, current_order.order_status, 'cancelled', clean_reason, actor_id);
    affected := 1;
  else
    update public.print_jobs
    set status = 'queued', attempts = 0, last_error = null,
        queued_at = now(), processing_at = null, printed_at = null,
        failed_at = null, updated_at = now(),
        payload = payload || jsonb_build_object('requeued_by_platform_admin', actor_id, 'requeued_at', now())
    where order_id = p_order_id;
    get diagnostics affected = row_count;

    if affected = 0 then
      insert into public.print_jobs (restaurant_id, order_id, printer_id, document_type, payload)
      values (
        current_order.restaurant_id, current_order.id, null, 'kitchen_ticket',
        jsonb_build_object('order_id', current_order.id, 'restaurant_id', current_order.restaurant_id,
          'queued_from', 'platform_admin_recovery', 'awaiting_printer_assignment', true)
      );
      affected := 1;
    end if;
  end if;

  insert into public.platform_order_actions (order_id, actor_user_id, action, reason, details)
  values (p_order_id, actor_id, p_action, clean_reason, jsonb_build_object('affected_records', affected));

  insert into public.platform_admin_audit_log (actor_user_id, action, target_type, target_id, details)
  values (actor_id, 'order_' || p_action, 'order', p_order_id,
    jsonb_build_object('order_number', current_order.order_number, 'reason', clean_reason, 'affected_records', affected));

  return jsonb_build_object('success', true, 'affected_records', affected);
end;
$function$;

revoke all on function public.get_platform_order_recovery(bigint) from public, anon, authenticated;
grant execute on function public.get_platform_order_recovery(bigint) to authenticated;
revoke all on function public.recover_platform_order(uuid, text, text) from public, anon, authenticated;
grant execute on function public.recover_platform_order(uuid, text, text) to authenticated;

commit;
