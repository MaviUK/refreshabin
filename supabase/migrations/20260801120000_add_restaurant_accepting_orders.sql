begin;

alter table public.restaurants
  add column if not exists accepting_orders boolean not null default true;

create or replace function public.get_restaurant_order_availability(storefront_slug text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(r.accepting_orders, false)
  from public.restaurants r
  where r.slug = storefront_slug
    and r.status::text in ('approved', 'active')
  limit 1;
$$;

revoke all on function public.get_restaurant_order_availability(text) from public;
grant execute on function public.get_restaurant_order_availability(text) to anon, authenticated;

create or replace function public.reject_orders_while_restaurant_paused()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not coalesce((select accepting_orders from public.restaurants where id = new.restaurant_id), false) then
    raise exception 'This restaurant is not currently accepting orders.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists reject_orders_while_restaurant_paused on public.orders;
create trigger reject_orders_while_restaurant_paused
before insert on public.orders
for each row execute function public.reject_orders_while_restaurant_paused();

comment on column public.restaurants.accepting_orders is 'Master operational switch; preserves delivery and collection configuration while new orders are paused.';

commit;