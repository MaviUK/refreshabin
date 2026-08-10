begin;

create or replace function public.get_platform_gift_card_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  if not public.has_platform_admin_permission('finance:view') then
    raise exception 'Platform finance permission required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'summary', jsonb_build_object(
      'purchase_count', count(*),
      'paid_value_pence', coalesce(sum(p.value_pence) filter (where p.status in ('paid','issued')), 0),
      'outstanding_value_pence', coalesce((select sum(g.remaining_value_pence) from public.restaurant_gift_cards g where g.is_active and g.remaining_value_pence > 0 and (g.expires_at is null or g.expires_at > now())), 0),
      'delivered_count', count(*) filter (where p.email_sent_at is not null),
      'failed_delivery_count', count(*) filter (where p.delivery_error is not null)
    ),
    'purchases', coalesce(jsonb_agg(jsonb_build_object(
      'purchase_id', p.id,
      'restaurant_name', r.name,
      'restaurant_slug', r.slug,
      'purchaser_email', p.purchaser_email,
      'recipient_email', p.recipient_email,
      'value_pence', p.value_pence,
      'status', p.status,
      'delivery_at', p.delivery_at,
      'email_sent_at', p.email_sent_at,
      'delivery_error', p.delivery_error,
      'gift_card_code', g.code,
      'remaining_value_pence', g.remaining_value_pence,
      'created_at', p.created_at
    ) order by p.created_at desc), '[]'::jsonb)
  ) into result
  from public.gift_card_purchases p
  join public.restaurants r on r.id = p.restaurant_id
  left join public.restaurant_gift_cards g on g.id = p.gift_card_id;

  return result;
end;
$function$;

revoke all on function public.get_platform_gift_card_dashboard() from public, anon, authenticated;
grant execute on function public.get_platform_gift_card_dashboard() to authenticated;

commit;
