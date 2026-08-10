begin;

create or replace function public.get_platform_restaurants(
  p_status text default null,
  p_search text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '10s'
as $function$
declare
  result jsonb;
  clean_search text := nullif(trim(coalesce(p_search, '')), '');
begin
  if not private.has_platform_admin_permission('restaurants:view') then
    raise exception 'You do not have permission to view restaurants' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('draft','pending_approval','active','suspended','rejected') then
    raise exception 'Unsupported restaurant status' using errcode = '22023';
  end if;
  if length(coalesce(clean_search, '')) > 160 then
    raise exception 'Search text is too long' using errcode = '22023';
  end if;

  with selected as materialized (
    select r.*
    from public.restaurants r
    where (p_status is null or r.status::text = p_status)
      and (clean_search is null
        or r.name ilike '%' || clean_search || '%'
        or r.email ilike '%' || clean_search || '%'
        or r.slug ilike '%' || clean_search || '%')
    order by case r.status::text when 'pending_approval' then 0 when 'suspended' then 1 else 2 end,
      r.updated_at desc, r.id
    limit 250
  ), restaurant_ids as materialized (
    select id from selected
  ), menu_stats as materialized (
    select x.restaurant_id,
      count(distinct x.category_id)::integer as menu_category_count,
      count(x.item_id)::integer as menu_item_count
    from (
      select c.restaurant_id, c.id as category_id, null::uuid as item_id
      from public.menu_categories c join restaurant_ids s on s.id = c.restaurant_id
      union all
      select i.restaurant_id, null::uuid, i.id
      from public.menu_items i join restaurant_ids s on s.id = i.restaurant_id
    ) x
    group by x.restaurant_id
  ), order_stats as materialized (
    select o.restaurant_id,
      count(*)::bigint as order_count,
      coalesce(sum(o.total_pence) filter (where o.payment_status in ('paid','partially_refunded','refunded')), 0)::bigint as gross_sales_pence,
      max(o.created_at) as last_order_at
    from public.orders o
    join restaurant_ids s on s.id = o.restaurant_id
    group by o.restaurant_id
  ), locations as materialized (
    select distinct on (l.restaurant_id)
      l.restaurant_id,
      jsonb_build_object(
        'address_line_1', l.address_line_1,
        'address_line_2', l.address_line_2,
        'city', l.city,
        'postcode', l.postcode
      ) as location
    from public.restaurant_locations l
    join restaurant_ids s on s.id = l.restaurant_id
    where l.is_active
    order by l.restaurant_id, l.created_at asc
  )
  select coalesce(jsonb_agg(row_data order by
    case row_data.status when 'pending_approval' then 0 when 'suspended' then 1 else 2 end,
    row_data.updated_at desc, row_data.id
  ), '[]'::jsonb)
  into result
  from (
    select s.id, s.name, s.slug, s.status::text, s.email, s.phone, s.cuisines,
      s.accepts_delivery, s.accepts_collection, s.accepting_orders,
      s.minimum_order_pence, s.delivery_fee_pence, s.logo_url, s.cover_url,
      s.submitted_at, s.approved_at, s.approval_notes, s.created_at, s.updated_at,
      coalesce(l.location, '{}'::jsonb) as location,
      coalesce(ms.menu_category_count, 0) as menu_category_count,
      coalesce(ms.menu_item_count, 0) as menu_item_count,
      coalesce(os.order_count, 0) as order_count,
      coalesce(os.gross_sales_pence, 0) as gross_sales_pence,
      os.last_order_at
    from selected s
    left join locations l on l.restaurant_id = s.id
    left join menu_stats ms on ms.restaurant_id = s.id
    left join order_stats os on os.restaurant_id = s.id
  ) row_data;

  return result;
end;
$function$;

create or replace function public.get_platform_payments(
  p_payment_status text default null,
  p_search text default null,
  p_page integer default 1,
  p_page_size integer default 40
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '10s'
as $function$
declare
  result jsonb;
  clean text := nullif(trim(coalesce(p_search, '')), '');
  pg integer := greatest(coalesce(p_page, 1), 1);
  sz integer := least(greatest(coalesce(p_page_size, 40), 1), 100);
  can_customer boolean := private.has_platform_admin_permission('orders:customer_details');
begin
  if not private.has_platform_admin_permission('finance:view') then
    raise exception 'You do not have permission to view payments' using errcode = '42501';
  end if;
  if p_payment_status is not null and p_payment_status not in ('pending','requires_action','paid','failed','refunded','partially_refunded') then
    raise exception 'Unsupported payment status';
  end if;
  if length(coalesce(clean, '')) > 160 then
    raise exception 'Search text is too long' using errcode = '22023';
  end if;

  with processing_refunds as materialized (
    select pr.order_id, sum(pr.amount_pence)::bigint as amount_pence
    from public.platform_refunds pr
    where pr.status = 'processing'
    group by pr.order_id
  ), scoped as materialized (
    select o.id, o.order_number, r.name as restaurant_name,
      case when can_customer then o.customer_email else null end as customer_email,
      o.total_pence, o.refunded_pence,
      greatest(o.total_pence - o.refunded_pence - coalesce(pr.amount_pence, 0), 0) as refundable_pence,
      o.currency, o.payment_status, o.paid_at, o.created_at, o.stripe_payment_intent_id
    from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
    left join processing_refunds pr on pr.order_id = o.id
    where (p_payment_status is null or o.payment_status = p_payment_status)
      and (clean is null
        or o.order_number = case when clean ~ '^[0-9]+$' then clean::bigint else -1 end
        or r.name ilike '%' || clean || '%'
        or o.stripe_payment_intent_id ilike '%' || clean || '%'
        or (can_customer and o.customer_email ilike '%' || clean || '%'))
  ), page_rows as (
    select * from scoped
    order by created_at desc, id desc
    limit sz offset (pg - 1) * sz
  ), filtered_stats as (
    select count(*)::bigint as total from scoped
  ), platform_stats as (
    select
      coalesce(sum(o.total_pence) filter (where o.payment_status in ('paid','partially_refunded','refunded')), 0)::bigint as captured_pence,
      coalesce(sum(o.refunded_pence), 0)::bigint as refunded_pence,
      count(*) filter (where o.payment_status = 'failed')::bigint as failed_count
    from public.orders o
  ), refund_stats as (
    select count(*)::bigint as refund_pending_count
    from public.platform_refunds
    where status = 'processing'
  )
  select jsonb_build_object(
    'payments', coalesce((select jsonb_agg(x order by x.created_at desc, x.id desc) from page_rows x), '[]'::jsonb),
    'pagination', jsonb_build_object(
      'page', pg,
      'page_size', sz,
      'total', fs.total,
      'total_pages', greatest(ceil(fs.total::numeric / sz)::integer, 1)
    ),
    'summary', jsonb_build_object(
      'captured_pence', ps.captured_pence,
      'refunded_pence', ps.refunded_pence,
      'failed_count', ps.failed_count,
      'refund_pending_count', rs.refund_pending_count
    )
  ) into result
  from filtered_stats fs cross join platform_stats ps cross join refund_stats rs;

  return result;
end;
$function$;

revoke all on function public.get_platform_restaurants(text,text) from public, anon, authenticated;
grant execute on function public.get_platform_restaurants(text,text) to authenticated;
revoke all on function public.get_platform_payments(text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.get_platform_payments(text,text,integer,integer) to authenticated;

commit;
