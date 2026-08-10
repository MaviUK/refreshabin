begin;

create table if not exists public.gift_card_purchases (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  purchaser_email text not null,
  recipient_email text not null,
  recipient_name text,
  message text,
  value_pence integer not null check (value_pence between 500 and 100000),
  currency text not null default 'gbp',
  delivery_at timestamptz not null default now(),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  status text not null default 'pending' check (status in ('pending','paid','issued','cancelled','failed')),
  gift_card_id uuid unique references public.restaurant_gift_cards(id) on delete set null,
  issued_at timestamptz,
  email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gift_card_purchases_delivery_idx
  on public.gift_card_purchases(status, delivery_at)
  where email_sent_at is null;

alter table public.gift_card_purchases enable row level security;
revoke all on public.gift_card_purchases from public, anon, authenticated;

create or replace function public.get_public_gift_card_restaurant(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object('id', r.id, 'name', r.name, 'slug', r.slug)
  from public.restaurants r
  where r.slug = p_slug and r.status = 'active'
  limit 1
$function$;

create or replace function public.issue_paid_gift_card_purchase(p_purchase_id uuid, p_session_id text, p_payment_intent_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  purchase public.gift_card_purchases%rowtype;
  card public.restaurant_gift_cards%rowtype;
  code_value text;
begin
  select * into purchase from public.gift_card_purchases where id = p_purchase_id for update;
  if not found then raise exception 'Gift card purchase not found'; end if;
  if purchase.stripe_checkout_session_id is distinct from p_session_id then raise exception 'Checkout session does not match purchase'; end if;
  if purchase.gift_card_id is not null then
    select * into card from public.restaurant_gift_cards where id = purchase.gift_card_id;
    return jsonb_build_object('gift_card_id', card.id, 'code', card.code, 'already_issued', true);
  end if;

  loop
    code_value := 'OF-' || upper(substr(encode(gen_random_bytes(12), 'hex'), 1, 16));
    exit when not exists (select 1 from public.restaurant_gift_cards where restaurant_id = purchase.restaurant_id and code = code_value);
  end loop;

  insert into public.restaurant_gift_cards(
    restaurant_id, code, original_value_pence, remaining_value_pence,
    purchaser_email, recipient_email, recipient_name, message
  ) values (
    purchase.restaurant_id, code_value, purchase.value_pence, purchase.value_pence,
    purchase.purchaser_email, purchase.recipient_email, purchase.recipient_name, purchase.message
  ) returning * into card;

  update public.gift_card_purchases
  set status = 'issued', gift_card_id = card.id, stripe_payment_intent_id = p_payment_intent_id,
      issued_at = now(), updated_at = now()
  where id = purchase.id;

  return jsonb_build_object('gift_card_id', card.id, 'code', card.code, 'already_issued', false);
end;
$function$;

revoke all on function public.get_public_gift_card_restaurant(text) from public, anon, authenticated;
grant execute on function public.get_public_gift_card_restaurant(text) to anon, authenticated;
revoke all on function public.issue_paid_gift_card_purchase(uuid,text,text) from public, anon, authenticated;
grant execute on function public.issue_paid_gift_card_purchase(uuid,text,text) to service_role;

commit;
