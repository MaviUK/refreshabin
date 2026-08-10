begin;

create or replace function public.get_restaurant_marketing_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_restaurant_id uuid;
  result jsonb;
begin
  select rm.restaurant_id into v_restaurant_id
  from public.restaurant_members rm
  where rm.user_id = auth.uid()
  order by rm.created_at
  limit 1;
  if v_restaurant_id is null then raise exception 'Restaurant membership not found' using errcode = '42501'; end if;

  select jsonb_build_object(
    'summary', jsonb_build_object(
      'active_promotions', count(*) filter (where p.is_active and p.starts_at <= now() and (p.ends_at is null or p.ends_at > now())),
      'total_promotions', count(*),
      'total_redemptions', coalesce(sum(p.redemption_count), 0),
      'discount_given_pence', coalesce((select sum(pr.discount_pence) from public.promotion_redemptions pr where pr.restaurant_id = v_restaurant_id), 0)
    ),
    'promotions', coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'code', p.code, 'promotion_type', p.promotion_type,
      'percentage_basis_points', p.percentage_basis_points, 'fixed_discount_pence', p.fixed_discount_pence,
      'minimum_order_pence', p.minimum_order_pence, 'maximum_discount_pence', p.maximum_discount_pence,
      'starts_at', p.starts_at, 'ends_at', p.ends_at, 'total_redemption_limit', p.total_redemption_limit,
      'per_customer_limit', p.per_customer_limit, 'redemption_count', p.redemption_count,
      'first_order_only', p.first_order_only, 'fulfilment_methods', p.fulfilment_methods,
      'is_active', p.is_active, 'created_at', p.created_at
    ) order by p.created_at desc) filter (where p.id is not null), '[]'::jsonb)
  ) into result
  from public.restaurant_promotions p
  where p.restaurant_id = v_restaurant_id;
  return result;
end;
$function$;

create or replace function public.create_restaurant_promotion(
  p_name text, p_code text, p_promotion_type text,
  p_percentage_basis_points integer default null, p_fixed_discount_pence integer default null,
  p_minimum_order_pence integer default 0, p_maximum_discount_pence integer default null,
  p_starts_at timestamptz default now(), p_ends_at timestamptz default null,
  p_total_redemption_limit integer default null, p_per_customer_limit integer default 1,
  p_first_order_only boolean default false,
  p_fulfilment_methods text[] default array['delivery','collection']
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_restaurant_id uuid;
  new_id uuid;
begin
  select rm.restaurant_id into v_restaurant_id
  from public.restaurant_members rm
  where rm.user_id = auth.uid()
  order by rm.created_at
  limit 1;
  if v_restaurant_id is null then raise exception 'Restaurant membership not found' using errcode = '42501'; end if;
  if not public.restaurant_has_subscription_feature('marketing') then raise exception 'Marketing tools require a Growth or Pro subscription' using errcode = '42501'; end if;
  if nullif(trim(p_name), '') is null then raise exception 'Promotion name is required'; end if;
  if nullif(trim(p_code), '') is null then raise exception 'Promotion code is required'; end if;
  if p_promotion_type not in ('percentage','fixed','free_delivery','birthday','referral') then raise exception 'Unsupported promotion type'; end if;
  if p_promotion_type = 'percentage' and coalesce(p_percentage_basis_points, 0) not between 1 and 10000 then raise exception 'Choose a percentage between 0.01 and 100'; end if;
  if p_promotion_type = 'fixed' and coalesce(p_fixed_discount_pence, 0) <= 0 then raise exception 'Choose a fixed discount greater than zero'; end if;
  if p_ends_at is not null and p_ends_at <= p_starts_at then raise exception 'End date must be after the start date'; end if;

  insert into public.restaurant_promotions(
    restaurant_id, name, code, promotion_type, percentage_basis_points, fixed_discount_pence,
    minimum_order_pence, maximum_discount_pence, starts_at, ends_at, total_redemption_limit,
    per_customer_limit, first_order_only, fulfilment_methods, created_by
  ) values (
    v_restaurant_id, trim(p_name), upper(trim(p_code)), p_promotion_type,
    p_percentage_basis_points, p_fixed_discount_pence, greatest(coalesce(p_minimum_order_pence, 0), 0),
    p_maximum_discount_pence, coalesce(p_starts_at, now()), p_ends_at, p_total_redemption_limit,
    p_per_customer_limit, coalesce(p_first_order_only, false),
    coalesce(p_fulfilment_methods, array['delivery','collection']), auth.uid()
  ) returning id into new_id;
  return new_id;
end;
$function$;

create or replace function public.set_restaurant_promotion_active(p_promotion_id uuid, p_is_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_restaurant_id uuid;
begin
  select rm.restaurant_id into v_restaurant_id
  from public.restaurant_members rm
  where rm.user_id = auth.uid()
  order by rm.created_at
  limit 1;
  if v_restaurant_id is null then raise exception 'Restaurant membership not found' using errcode = '42501'; end if;

  update public.restaurant_promotions p
  set is_active = p_is_active, updated_at = now()
  where p.id = p_promotion_id and p.restaurant_id = v_restaurant_id;
  if not found then raise exception 'Promotion not found'; end if;
end;
$function$;

revoke all on function public.get_restaurant_marketing_dashboard() from public, anon, authenticated;
revoke all on function public.create_restaurant_promotion(text,text,text,integer,integer,integer,integer,timestamptz,timestamptz,integer,integer,boolean,text[]) from public, anon, authenticated;
revoke all on function public.set_restaurant_promotion_active(uuid,boolean) from public, anon, authenticated;
grant execute on function public.get_restaurant_marketing_dashboard() to authenticated;
grant execute on function public.create_restaurant_promotion(text,text,text,integer,integer,integer,integer,timestamptz,timestamptz,integer,integer,boolean,text[]) to authenticated;
grant execute on function public.set_restaurant_promotion_active(uuid,boolean) to authenticated;

commit;
