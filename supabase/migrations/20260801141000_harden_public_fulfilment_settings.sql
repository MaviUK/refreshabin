begin;

create or replace function public.get_public_fulfilment_settings(storefront_slug text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select jsonb_build_object(
    'delivery_preparation_time_minutes', r.delivery_preparation_time_minutes,
    'collection_preparation_time_minutes', r.collection_preparation_time_minutes
  )
  from public.restaurants r
  where r.slug = storefront_slug
    and r.status = 'active'
  limit 1;
$function$;

revoke all on function public.get_public_fulfilment_settings(text) from public;
grant execute on function public.get_public_fulfilment_settings(text) to anon, authenticated;

comment on function public.get_public_fulfilment_settings is
  'Returns public delivery and collection defaults using the restaurants table active-row RLS policy.';

commit;
