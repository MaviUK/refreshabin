begin;

create or replace function public.get_customer_wallet_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt()->>'email', ''));
  result jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total_credit_pence', coalesce((
      select sum(ca.balance_pence)
      from public.customer_credit_accounts ca
      where ca.customer_user_id = v_user_id
    ), 0),
    'credit_accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'restaurant_id', ca.restaurant_id,
        'restaurant_name', r.name,
        'restaurant_slug', r.slug,
        'balance_pence', ca.balance_pence,
        'updated_at', ca.updated_at
      ) order by ca.balance_pence desc, r.name)
      from public.customer_credit_accounts ca
      join public.restaurants r on r.id = ca.restaurant_id
      where ca.customer_user_id = v_user_id
        and ca.balance_pence > 0
    ), '[]'::jsonb),
    'gift_cards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id,
        'restaurant_id', g.restaurant_id,
        'restaurant_name', r.name,
        'restaurant_slug', r.slug,
        'code_suffix', right(g.code, 4),
        'original_value_pence', g.original_value_pence,
        'remaining_value_pence', g.remaining_value_pence,
        'recipient_name', g.recipient_name,
        'message', g.message,
        'expires_at', g.expires_at,
        'is_active', g.is_active,
        'created_at', g.created_at
      ) order by g.created_at desc)
      from public.restaurant_gift_cards g
      join public.restaurants r on r.id = g.restaurant_id
      where lower(coalesce(g.recipient_email, '')) = v_email
        and g.is_active
        and g.remaining_value_pence > 0
        and (g.expires_at is null or g.expires_at > now())
    ), '[]'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(entry order by created_at desc)
      from (
        select jsonb_build_object(
          'id', l.id,
          'restaurant_name', r.name,
          'amount_pence', l.amount_pence,
          'entry_type', l.entry_type,
          'note', l.note,
          'created_at', l.created_at
        ) as entry,
        l.created_at
        from public.customer_credit_ledger l
        join public.restaurants r on r.id = l.restaurant_id
        where l.customer_user_id = v_user_id
        order by l.created_at desc
        limit 50
      ) recent
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$function$;

revoke all on function public.get_customer_wallet_summary() from public, anon, authenticated;
grant execute on function public.get_customer_wallet_summary() to authenticated;

commit;
