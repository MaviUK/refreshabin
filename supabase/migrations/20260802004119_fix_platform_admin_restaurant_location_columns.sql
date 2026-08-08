create or replace function public.get_platform_restaurants(
  p_status text default null,
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
begin
  if not public.is_platform_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if p_status is not null and p_status not in ('draft', 'pending_approval', 'active', 'suspended', 'rejected') then
    raise exception 'Unsupported restaurant status' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(restaurant order by
    case restaurant.status when 'pending_approval' then 0 when 'suspended' then 1 else 2 end,
    restaurant.updated_at desc
  ), '[]'::jsonb)
  into result
  from (
    select
      r.id,
      r.name,
      r.slug,
      r.status::text,
      r.email,
      r.phone,
      r.cuisines,
      r.accepts_delivery,
      r.accepts_collection,
      r.accepting_orders,
      r.minimum_order_pence,
      r.delivery_fee_pence,
      r.logo_url,
      r.cover_url,
      r.submitted_at,
      r.approved_at,
      r.approval_notes,
      r.created_at,
      r.updated_at,
      coalesce((
        select jsonb_build_object(
          'address_line_1', l.line1,
          'address_line_2', l.line2,
          'city', l.city,
          'postcode', l.postcode
        )
        from public.restaurant_locations l
        where l.restaurant_id = r.id
          and l.is_active
        order by l.created_at asc
        limit 1
      ), '{}'::jsonb) as location,
      (select count(*) from public.menu_categories c where c.restaurant_id = r.id) as menu_category_count,
      (select count(*) from public.menu_items i where i.restaurant_id = r.id) as menu_item_count,
      (select count(*) from public.orders o where o.restaurant_id = r.id) as order_count,
      (select coalesce(sum(o.total_pence), 0) from public.orders o where o.restaurant_id = r.id and o.payment_status in ('paid', 'partially_refunded')) as gross_sales_pence,
      (select max(o.created_at) from public.orders o where o.restaurant_id = r.id) as last_order_at
    from public.restaurants r
    where (p_status is null or r.status::text = p_status)
      and (
        nullif(trim(coalesce(p_search, '')), '') is null
        or r.name ilike '%' || trim(p_search) || '%'
        or r.email ilike '%' || trim(p_search) || '%'
        or r.slug ilike '%' || trim(p_search) || '%'
      )
  ) restaurant;

  return result;
end;
$function$;
