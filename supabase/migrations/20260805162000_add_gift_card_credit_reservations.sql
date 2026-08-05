begin;

create table if not exists public.checkout_balance_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  reservation_type text not null check (reservation_type in ('gift_card','customer_credit')),
  gift_card_id uuid references public.restaurant_gift_cards(id) on delete cascade,
  credit_account_id uuid references public.customer_credit_accounts(id) on delete cascade,
  amount_pence integer not null check (amount_pence > 0),
  status text not null default 'reserved' check (status in ('reserved','consumed','released')),
  expires_at timestamptz not null default (now() + interval '35 minutes'),
  consumed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  unique (order_id, reservation_type),
  check ((reservation_type='gift_card' and gift_card_id is not null and credit_account_id is null) or (reservation_type='customer_credit' and credit_account_id is not null and gift_card_id is null))
);
create index if not exists checkout_balance_reservations_active_idx on public.checkout_balance_reservations (status, expires_at);
alter table public.checkout_balance_reservations enable row level security;
revoke all on public.checkout_balance_reservations from public, anon, authenticated;

create or replace function public.get_customer_checkout_balances(p_restaurant_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $function$
declare result jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('credit_balance_pence',0,'gift_cards','[]'::jsonb); end if;
  select jsonb_build_object(
    'credit_balance_pence',coalesce((select balance_pence from public.customer_credit_accounts where restaurant_id=p_restaurant_id and customer_user_id=auth.uid()),0),
    'gift_cards',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'code_suffix',right(g.code,4),'remaining_value_pence',g.remaining_value_pence,'expires_at',g.expires_at) order by g.created_at desc) from public.restaurant_gift_cards g where g.restaurant_id=p_restaurant_id and g.is_active and g.remaining_value_pence>0 and (g.expires_at is null or g.expires_at>now()) and lower(g.recipient_email)=lower(coalesce(auth.jwt()->>'email',''))),'[]'::jsonb)
  ) into result;
  return result;
end;$function$;

create or replace function public.validate_restaurant_gift_card(p_restaurant_id uuid,p_code text) returns jsonb
language plpgsql security definer set search_path='' as $function$
declare card public.restaurant_gift_cards%rowtype; reserved integer;
begin
  select * into card from public.restaurant_gift_cards where restaurant_id=p_restaurant_id and upper(code)=upper(trim(p_code)) and is_active and remaining_value_pence>0 and (expires_at is null or expires_at>now()) for update;
  if not found then return jsonb_build_object('valid',false,'error','Gift card is invalid, empty or expired.'); end if;
  select coalesce(sum(amount_pence),0) into reserved from public.checkout_balance_reservations where gift_card_id=card.id and status='reserved' and expires_at>now();
  return jsonb_build_object('valid',true,'gift_card_id',card.id,'code_suffix',right(card.code,4),'available_pence',greatest(card.remaining_value_pence-reserved,0));
end;$function$;

create or replace function public.reserve_order_balances(p_order_id uuid,p_gift_card_code text default null,p_use_credit_pence integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $function$
declare o public.orders%rowtype; card public.restaurant_gift_cards%rowtype; credit public.customer_credit_accounts%rowtype; reserved integer; gift_use integer:=0; credit_use integer:=0; remaining integer;
begin
  select * into o from public.orders where id=p_order_id and customer_user_id=auth.uid() and order_status='pending_payment' for update;
  if not found then raise exception 'Order is not available for balance redemption' using errcode='42501'; end if;
  delete from public.checkout_balance_reservations where order_id=o.id and status='reserved';
  remaining:=o.total_pence;
  if nullif(trim(p_gift_card_code),'') is not null then
    select * into card from public.restaurant_gift_cards where restaurant_id=o.restaurant_id and upper(code)=upper(trim(p_gift_card_code)) and is_active and remaining_value_pence>0 and (expires_at is null or expires_at>now()) for update;
    if not found then raise exception 'Gift card is invalid, empty or expired'; end if;
    select coalesce(sum(amount_pence),0) into reserved from public.checkout_balance_reservations where gift_card_id=card.id and status='reserved' and expires_at>now();
    gift_use:=least(remaining,greatest(card.remaining_value_pence-reserved,0));
    if gift_use>0 then insert into public.checkout_balance_reservations(order_id,restaurant_id,reservation_type,gift_card_id,amount_pence) values(o.id,o.restaurant_id,'gift_card',card.id,gift_use); end if;
    remaining:=remaining-gift_use;
  end if;
  if p_use_credit_pence>0 and remaining>0 then
    select * into credit from public.customer_credit_accounts where restaurant_id=o.restaurant_id and customer_user_id=auth.uid() for update;
    if found then
      select coalesce(sum(amount_pence),0) into reserved from public.checkout_balance_reservations where credit_account_id=credit.id and status='reserved' and expires_at>now();
      credit_use:=least(remaining,p_use_credit_pence,greatest(credit.balance_pence-reserved,0));
      if credit_use>0 then insert into public.checkout_balance_reservations(order_id,restaurant_id,reservation_type,credit_account_id,amount_pence) values(o.id,o.restaurant_id,'customer_credit',credit.id,credit_use); end if;
    end if;
  end if;
  update public.orders set gift_card_used_pence=gift_use,customer_credit_used_pence=credit_use,total_pence=greatest(total_pence-gift_use-credit_use,0) where id=o.id;
  return jsonb_build_object('gift_card_used_pence',gift_use,'customer_credit_used_pence',credit_use,'total_pence',greatest(o.total_pence-gift_use-credit_use,0));
end;$function$;

create or replace function public.finalize_order_balance_reservations(p_order_id uuid,p_success boolean) returns void
language plpgsql security definer set search_path='' as $function$
declare r public.checkout_balance_reservations%rowtype;
begin
  for r in select * from public.checkout_balance_reservations where order_id=p_order_id and status='reserved' for update loop
    if p_success then
      if r.reservation_type='gift_card' then
        update public.restaurant_gift_cards set remaining_value_pence=greatest(remaining_value_pence-r.amount_pence,0),redeemed_at=case when remaining_value_pence-r.amount_pence<=0 then now() else redeemed_at end where id=r.gift_card_id;
      else
        update public.customer_credit_accounts set balance_pence=greatest(balance_pence-r.amount_pence,0),updated_at=now() where id=r.credit_account_id;
        insert into public.customer_credit_ledger(credit_account_id,restaurant_id,customer_user_id,order_id,amount_pence,entry_type,note)
        select r.credit_account_id,r.restaurant_id,o.customer_user_id,o.id,-r.amount_pence,'order_redemption','Applied to order #'||o.order_number from public.orders o where o.id=p_order_id;
      end if;
      update public.checkout_balance_reservations set status='consumed',consumed_at=now() where id=r.id;
    else
      update public.checkout_balance_reservations set status='released',released_at=now() where id=r.id;
    end if;
  end loop;
end;$function$;

revoke all on function public.get_customer_checkout_balances(uuid),public.validate_restaurant_gift_card(uuid,text),public.reserve_order_balances(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.get_customer_checkout_balances(uuid),public.validate_restaurant_gift_card(uuid,text),public.reserve_order_balances(uuid,text,integer) to authenticated;
revoke all on function public.finalize_order_balance_reservations(uuid,boolean) from public,anon,authenticated;
grant execute on function public.finalize_order_balance_reservations(uuid,boolean) to service_role;

commit;
