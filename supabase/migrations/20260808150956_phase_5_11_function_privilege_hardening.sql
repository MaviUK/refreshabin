do $$
declare r record;
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and (
        p.proname like '%restaurant_group%'
        or p.proname in (
          'platform_merge_restaurants','platform_move_brand',
          'redeem_loyalty_reward','reserve_order_balances','reserve_order_reward_voucher',
          'get_customer_checkout_balances','get_checkout_reward_vouchers','get_customer_reward_store'
        )
      )
  loop
    execute format('revoke execute on function public.%I(%s) from public, anon', r.proname, r.args);
  end loop;
end $$;

revoke execute on function public.resolve_restaurant_group_api_key(text,text) from public,anon,authenticated;
grant execute on function public.resolve_restaurant_group_api_key(text,text) to service_role;
revoke execute on function public.refresh_restaurant_group_timed_prices() from public,anon,authenticated;
grant execute on function public.refresh_restaurant_group_timed_prices() to service_role;
