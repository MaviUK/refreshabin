begin;

create or replace function public.get_restaurant_gift_card_dashboard()
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

  if v_restaurant_id is null then
    raise exception 'Restaurant membership not found' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'summary', jsonb_build_object(
      'issued_count', count(*),
      'original_value_pence', coalesce(sum(g.original_value_pence), 0),
      'outstanding_value_pence', coalesce(sum(g.remaining_value_pence) filter (where g.is_active and (g.expires_at is null or g.expires_at > now())), 0),
      'redeemed_value_pence', coalesce(sum(g.original_value_pence - g.remaining_value_pence), 0)
    ),
    'gift_cards', coalesce(jsonb_agg(jsonb_build_object(
      'id', g.id,
      'code', g.code,
      'original_value_pence', g.original_value_pence,
      'remaining_value_pence', g.remaining_value_pence,
      'purchaser_email', g.purchaser_email,
      'recipient_email', g.recipient_email,
      'recipient_name', g.recipient_name,
      'message', g.message,
      'expires_at', g.expires_at,
      'redeemed_at', g.redeemed_at,
      'is_active', g.is_active,
      'created_at', g.created_at
    ) order by g.created_at desc) filter (where g.id is not null), '[]'::jsonb)
  ) into result
  from public.restaurant_gift_cards g
  where g.restaurant_id = v_restaurant_id;

  return result;
end;
$function$;

create or replace function public.create_restaurant_gift_card(
  p_value_pence integer,
  p_recipient_email text,
  p_recipient_name text default null,
  p_purchaser_email text default null,
  p_message text default null,
  p_expires_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_restaurant_id uuid;
  v_code text;
  v_id uuid;
begin
  select rm.restaurant_id into v_restaurant_id
  from public.restaurant_members rm
  where rm.user_id = auth.uid()
  order by rm.created_at
  limit 1;

  if v_restaurant_id is null then
    raise exception 'Restaurant membership not found' using errcode = '42501';
  end if;
  if p_value_pence < 500 or p_value_pence > 100000 then
    raise exception 'Gift card value must be between £5 and £1,000';
  end if;
  if nullif(trim(p_recipient_email), '') is null then
    raise exception 'Recipient email is required';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Expiry must be in the future';
  end if;

  loop
    v_code := 'OF-' || upper(substr(encode(gen_random_bytes(12), 'hex'), 1, 16));
    exit when not exists (
      select 1 from public.restaurant_gift_cards
      where restaurant_id = v_restaurant_id and code = v_code
    );
  end loop;

  insert into public.restaurant_gift_cards(
    restaurant_id, code, original_value_pence, remaining_value_pence,
    purchaser_email, recipient_email, recipient_name, message, expires_at
  ) values (
    v_restaurant_id, v_code, p_value_pence, p_value_pence,
    nullif(trim(p_purchaser_email), ''), lower(trim(p_recipient_email)),
    nullif(trim(p_recipient_name), ''), nullif(trim(p_message), ''), p_expires_at
  ) returning id into v_id;

  return jsonb_build_object('id', v_id, 'code', v_code);
end;
$function$;

create or replace function public.set_restaurant_gift_card_active(
  p_gift_card_id uuid,
  p_is_active boolean
) returns void
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

  if v_restaurant_id is null then
    raise exception 'Restaurant membership not found' using errcode = '42501';
  end if;

  update public.restaurant_gift_cards
  set is_active = p_is_active
  where id = p_gift_card_id and restaurant_id = v_restaurant_id;

  if not found then raise exception 'Gift card not found'; end if;
end;
$function$;

revoke all on function public.get_restaurant_gift_card_dashboard() from public, anon, authenticated;
revoke all on function public.create_restaurant_gift_card(integer,text,text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.set_restaurant_gift_card_active(uuid,boolean) from public, anon, authenticated;
grant execute on function public.get_restaurant_gift_card_dashboard() to authenticated;
grant execute on function public.create_restaurant_gift_card(integer,text,text,text,text,timestamptz) to authenticated;
grant execute on function public.set_restaurant_gift_card_active(uuid,boolean) to authenticated;

commit;
