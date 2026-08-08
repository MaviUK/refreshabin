begin;

do $migration$
declare
  definition text;
begin
  select pg_get_functiondef('public.get_platform_payout_dashboard(text,text)'::regprocedure)
    into definition;
  definition := replace(
    definition,
    'where o.payment_status in (''paid'',''partially_refunded'',''refunded'')',
    'where o.restaurant_payout_mode = ''platform_manual'' and o.payment_status in (''paid'',''partially_refunded'',''refunded'')'
  );
  execute definition;

  select pg_get_functiondef('public.create_platform_restaurant_payout(uuid,date,date,bigint,text)'::regprocedure)
    into definition;
  definition := replace(
    definition,
    'where o.restaurant_id=p_restaurant_id and o.payment_status in (''paid'',''partially_refunded'',''refunded'')',
    'where o.restaurant_id=p_restaurant_id and o.restaurant_payout_mode=''platform_manual'' and o.payment_status in (''paid'',''partially_refunded'',''refunded'')'
  );
  execute definition;
end;
$migration$;

commit;
