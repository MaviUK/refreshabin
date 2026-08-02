-- Secure platform-wide order monitoring for the standalone admin application.
begin;

create index if not exists orders_admin_created_at_idx
  on public.orders (created_at desc);

create index if not exists orders_admin_order_number_idx
  on public.orders (order_number);

create index if not exists orders_admin_requested_fulfilment_idx
  on public.orders (requested_fulfilment_at)
  where requested_fulfilment_at is not null;

create index if not exists orders_admin_attention_idx
  on public.orders (coalesce(paid_at, created_at))
  where order_status = 'placed'
    and payment_status in ('paid', 'partially_refunded');

create or replace function private.platform_admin_permissions(p_role text)
returns text[]
language sql
immutable
set search_path = ''
as $function$
  select case p_role
    when 'super_admin' then array[
      'overview:view',
      'restaurants:view',
      'restaurants:manage',
      'orders:view',
      'orders:manage',
      'orders:customer_details',
      'customers:view',
      'finance:view',
      'finance:manage',
      'audit:view',
      'admins:view',
      'admins:manage'
    ]::text[]
    when 'operations' then array[
      'overview:view',
      'restaurants:view',
      'restaurants:manage',
      'orders:view',
      'orders:manage',
      'orders:customer_details',
      'audit:view'
    ]::text[]
    when 'support' then array[
      'overview:view',
      'restaurants:view',
      'orders:view',
      'orders:customer_details',
      'customers:view',
      'audit:view'
    ]::text[]
    when 'finance' then array[
      'overview:view',
      'orders:view',
      'finance:view',
      'finance:manage',
      'audit:view'
    ]::text[]
    else array[]::text[]
  end;
$function$;

revoke all on function private.platform_admin_permissions(text)
  from public, anon, authenticated, service_role;

create or replace function public.get_platform_orders(
  p_status text default null,
  p_payment_status text default null,
  p_fulfilment_method text default null,
  p_schedule text default null,
  p_attention_only boolean default false,
  p_search text default null,
  p_page integer default 1,
  p_page_size integer default 50
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
  safe_page integer := greatest(coalesce(p_page, 1), 1);
  safe_page_size integer := least(greatest(coalesce(p_page_size, 50), 1), 100);
  can_view_customer boolean := private.has_platform_admin_permission('orders:customer_details');
begin
  if not private.has_platform_admin_permission('orders:view') then
    raise exception 'You do not have permission to view orders' using errcode = '42501';
  end if;

  if p_status is not null and p_status not in (
    'pending_payment', 'placed', 'accepted', 'preparing', 'ready',
    'out_for_delivery', 'completed', 'cancelled', 'rejected'
  ) then
    raise exception 'Unsupported order status' using errcode = '22023';
  end if;

  if p_payment_status is not null and p_payment_status not in (
    'pending', 'requires_action', 'paid', 'failed', 'refunded', 'partially_refunded'
  ) then
    raise exception 'Unsupported payment status' using errcode = '22023';
  end if;

  if p_fulfilment_method is not null and p_fulfilment_method not in ('delivery', 'collection') then
    raise exception 'Unsupported fulfilment method' using errcode = '22023';
  end if;

  if p_schedule is not null and p_schedule not in ('asap', 'scheduled') then
    raise exception 'Unsupported schedule filter' using errcode = '22023';
  end if;

  if clean_search is not null and length(clean_search) > 160 then
    raise exception 'Search text is too long' using errcode = '22023';
  end if;

  with scoped as (
    select
      o.id,
      o.order_number,
      o.restaurant_id,
      r.name as restaurant_name,
      r.slug as restaurant_slug,
      case when can_view_customer then trim(o.customer_first_name || ' ' || o.customer_last_name) else null end as customer_name,
      case when can_view_customer then o.customer_email else null end as customer_email,
      case when can_view_customer then o.customer_phone else null end as customer_phone,
      o.fulfilment_method,
      o.order_status,
      o.payment_status,
      o.subtotal_pence,
      o.delivery_fee_pence,
      o.discount_pence,
      o.total_pence,
      o.currency,
      o.requested_fulfilment_at,
      o.estimated_ready_at,
      o.paid_at,
      o.accepted_at,
      o.completed_at,
      o.cancelled_at,
      o.created_at,
      o.updated_at,
      o.rejection_reason,
      (select count(*)::integer from public.order_items oi where oi.order_id = o.id) as item_count,
      (
        o.order_status = 'placed'
        and o.payment_status in ('paid', 'partially_refunded')
        and coalesce(o.paid_at, o.created_at) <= now() - interval '5 minutes'
      ) as needs_attention,
      case
        when o.order_status = 'placed' and o.payment_status in ('paid', 'partially_refunded')
          then greatest(floor(extract(epoch from (now() - coalesce(o.paid_at, o.created_at))) / 60), 0)::integer
        else null
      end as response_wait_minutes
    from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
    where (p_status is null or o.order_status = p_status)
      and (p_payment_status is null or o.payment_status = p_payment_status)
      and (p_fulfilment_method is null or o.fulfilment_method = p_fulfilment_method)
      and (
        p_schedule is null
        or (p_schedule = 'asap' and o.requested_fulfilment_at is null)
        or (p_schedule = 'scheduled' and o.requested_fulfilment_at is not null)
      )
      and (
        not coalesce(p_attention_only, false)
        or (
          o.order_status = 'placed'
          and o.payment_status in ('paid', 'partially_refunded')
          and coalesce(o.paid_at, o.created_at) <= now() - interval '5 minutes'
        )
      )
      and (
        clean_search is null
        or o.order_number = case when clean_search ~ '^[0-9]+$' then clean_search::bigint else -1 end
        or r.name ilike '%' || clean_search || '%'
        or r.slug ilike '%' || clean_search || '%'
        or (can_view_customer and (
          o.customer_first_name ilike '%' || clean_search || '%'
          or o.customer_last_name ilike '%' || clean_search || '%'
          or o.customer_email ilike '%' || clean_search || '%'
          or o.customer_phone ilike '%' || clean_search || '%'
        ))
      )
  ),
  page_rows as (
    select *
    from scoped
    order by needs_attention desc, created_at desc
    limit safe_page_size
    offset (safe_page - 1) * safe_page_size
  )
  select jsonb_build_object(
    'orders', coalesce((
      select jsonb_agg(page_row order by page_row.needs_attention desc, page_row.created_at desc)
      from page_rows page_row
    ), '[]'::jsonb),
    'pagination', jsonb_build_object(
      'page', safe_page,
      'page_size', safe_page_size,
      'total', (select count(*) from scoped),
      'total_pages', greatest(ceil((select count(*) from scoped)::numeric / safe_page_size)::integer, 1)
    ),
    'summary', jsonb_build_object(
      'awaiting_acceptance', (
        select count(*) from public.orders o
        where o.order_status = 'placed'
          and o.payment_status in ('paid', 'partially_refunded')
      ),
      'needs_attention', (
        select count(*) from public.orders o
        where o.order_status = 'placed'
          and o.payment_status in ('paid', 'partially_refunded')
          and coalesce(o.paid_at, o.created_at) <= now() - interval '5 minutes'
      ),
      'scheduled_upcoming', (
        select count(*) from public.orders o
        where o.requested_fulfilment_at > now()
          and o.order_status not in ('completed', 'cancelled', 'rejected')
      ),
      'paid_today', (
        select count(*) from public.orders o
        where (coalesce(o.paid_at, o.created_at) at time zone 'Europe/London')::date = (now() at time zone 'Europe/London')::date
          and o.payment_status in ('paid', 'partially_refunded')
      ),
      'gross_today_pence', (
        select coalesce(sum(o.total_pence), 0) from public.orders o
        where (coalesce(o.paid_at, o.created_at) at time zone 'Europe/London')::date = (now() at time zone 'Europe/London')::date
          and o.payment_status in ('paid', 'partially_refunded')
      )
    )
  ) into result;

  return result;
end;
$function$;

revoke all on function public.get_platform_orders(text, text, text, text, boolean, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_platform_orders(text, text, text, text, boolean, text, integer, integer)
  to authenticated;

create or replace function public.get_platform_order(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
  can_view_customer boolean := private.has_platform_admin_permission('orders:customer_details');
  can_view_finance boolean := private.has_platform_admin_permission('finance:view');
begin
  if not private.has_platform_admin_permission('orders:view') then
    raise exception 'You do not have permission to view orders' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'order', jsonb_build_object(
      'id', o.id,
      'order_number', o.order_number,
      'restaurant_id', o.restaurant_id,
      'restaurant_name', r.name,
      'restaurant_slug', r.slug,
      'fulfilment_method', o.fulfilment_method,
      'order_status', o.order_status,
      'payment_status', o.payment_status,
      'subtotal_pence', o.subtotal_pence,
      'delivery_fee_pence', o.delivery_fee_pence,
      'discount_pence', o.discount_pence,
      'total_pence', o.total_pence,
      'currency', o.currency,
      'requested_fulfilment_at', o.requested_fulfilment_at,
      'estimated_ready_at', o.estimated_ready_at,
      'paid_at', o.paid_at,
      'accepted_at', o.accepted_at,
      'completed_at', o.completed_at,
      'cancelled_at', o.cancelled_at,
      'created_at', o.created_at,
      'updated_at', o.updated_at,
      'restaurant_notes', o.restaurant_notes,
      'rejection_reason', o.rejection_reason,
      'receipt_sent_at', o.receipt_sent_at,
      'receipt_error', o.receipt_error,
      'restaurant_notified_at', o.restaurant_notified_at,
      'stripe_checkout_session_id', case when can_view_finance then o.stripe_checkout_session_id else null end,
      'stripe_payment_intent_id', case when can_view_finance then o.stripe_payment_intent_id else null end,
      'needs_attention', (
        o.order_status = 'placed'
        and o.payment_status in ('paid', 'partially_refunded')
        and coalesce(o.paid_at, o.created_at) <= now() - interval '5 minutes'
      ),
      'response_wait_minutes', case
        when o.order_status = 'placed' and o.payment_status in ('paid', 'partially_refunded')
          then greatest(floor(extract(epoch from (now() - coalesce(o.paid_at, o.created_at))) / 60), 0)::integer
        else null
      end
    ),
    'customer', case when can_view_customer then jsonb_build_object(
      'user_id', o.customer_user_id,
      'first_name', o.customer_first_name,
      'last_name', o.customer_last_name,
      'email', o.customer_email,
      'phone', o.customer_phone
    ) else null end,
    'delivery', case when can_view_customer and o.fulfilment_method = 'delivery' then jsonb_build_object(
      'address_line_1', o.address_line_1,
      'address_line_2', o.address_line_2,
      'town_city', o.town_city,
      'postcode', o.postcode,
      'instructions', o.delivery_instructions
    ) else null end,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', oi.id,
        'item_name', oi.item_name,
        'unit_price_pence', oi.unit_price_pence,
        'quantity', oi.quantity,
        'line_total_pence', oi.line_total_pence,
        'customer_notes', oi.customer_notes,
        'item_snapshot', oi.item_snapshot
      ) order by oi.created_at, oi.id)
      from public.order_items oi
      where oi.order_id = o.id
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id,
        'from_status', h.from_status,
        'to_status', h.to_status,
        'note', h.note,
        'created_at', h.created_at,
        'actor_name', coalesce(
          pa.display_name,
          case when rm.user_id is not null then initcap(rm.role::text) || ' restaurant staff' end,
          case when h.changed_by = o.customer_user_id then 'Customer' end,
          case when h.changed_by is not null then 'Authenticated user' end,
          'System'
        )
      ) order by h.created_at, h.id)
      from public.order_status_history h
      left join public.platform_admins pa on pa.user_id = h.changed_by
      left join public.restaurant_members rm
        on rm.user_id = h.changed_by and rm.restaurant_id = o.restaurant_id
      where h.order_id = o.id
    ), '[]'::jsonb)
  ) into result
  from public.orders o
  join public.restaurants r on r.id = o.restaurant_id
  where o.id = p_order_id;

  if result is null then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  return result;
end;
$function$;

revoke all on function public.get_platform_order(uuid)
  from public, anon, authenticated;
grant execute on function public.get_platform_order(uuid)
  to authenticated;

comment on function public.get_platform_orders(text, text, text, text, boolean, text, integer, integer)
  is 'Paginated platform order monitor. Requires orders:view and conditionally redacts customer data.';
comment on function public.get_platform_order(uuid)
  is 'Platform order detail with items and status history. Customer and Stripe identifiers are permission-gated.';

commit;
