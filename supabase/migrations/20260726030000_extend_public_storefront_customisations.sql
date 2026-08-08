begin;

create or replace function public.get_public_storefront(storefront_slug text)
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'restaurant', jsonb_build_object(
      'id', r.id,
      'name', r.name,
      'slug', r.slug,
      'logo_url', r.logo_url,
      'cover_url', r.cover_url,
      'cuisines', r.cuisines,
      'accepts_delivery', r.accepts_delivery,
      'accepts_collection', r.accepts_collection,
      'minimum_order_pence', r.minimum_order_pence,
      'delivery_fee_pence', r.delivery_fee_pence,
      'preparation_time_minutes', r.preparation_time_minutes,
      'free_delivery_threshold_pence', r.free_delivery_threshold_pence
    ),
    'categories', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'description', c.description,
          'sort_order', c.sort_order,
          'items', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', i.id,
                'name', i.name,
                'description', i.description,
                'price_pence', i.price_pence,
                'image_url', i.image_url,
                'is_vegetarian', i.is_vegetarian,
                'is_vegan', i.is_vegan,
                'sort_order', i.sort_order,
                'ingredients', coalesce((
                  select jsonb_agg(
                    jsonb_build_object(
                      'id', ingredient.id,
                      'name', ingredient.name,
                      'is_included', ingredient.is_included,
                      'is_removable', ingredient.is_removable,
                      'sort_order', ingredient.sort_order
                    ) order by ingredient.sort_order, ingredient.created_at
                  )
                  from public.menu_item_ingredients ingredient
                  where ingredient.menu_item_id = i.id
                ), '[]'::jsonb),
                'extras', coalesce((
                  select jsonb_agg(
                    jsonb_build_object(
                      'id', extra.id,
                      'name', extra.name,
                      'price_pence', extra.price_pence,
                      'max_quantity', extra.max_quantity,
                      'sort_order', extra.sort_order
                    ) order by extra.sort_order, extra.created_at
                  )
                  from public.menu_item_extras extra
                  where extra.menu_item_id = i.id
                    and extra.is_available = true
                ), '[]'::jsonb)
              ) order by i.sort_order, i.created_at
            )
            from public.menu_items i
            where i.category_id = c.id
              and i.restaurant_id = r.id
              and i.is_available = true
          ), '[]'::jsonb)
        ) order by c.sort_order, c.created_at
      )
      from public.menu_categories c
      where c.restaurant_id = r.id
        and c.is_active = true
    ), '[]'::jsonb)
  )
  from public.restaurants r
  where r.slug = storefront_slug
  limit 1;
$function$;

commit;
