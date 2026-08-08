begin;

create table if not exists public.menu_item_ingredients (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  is_included boolean not null default true,
  is_removable boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.menu_item_extras (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  price_pence integer not null default 0 check (price_pence >= 0),
  is_available boolean not null default true,
  max_quantity integer not null default 1 check (max_quantity between 1 and 20),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists menu_item_ingredients_item_idx on public.menu_item_ingredients(menu_item_id, sort_order);
create index if not exists menu_item_extras_item_idx on public.menu_item_extras(menu_item_id, sort_order);

alter table public.menu_item_ingredients enable row level security;
alter table public.menu_item_extras enable row level security;

create policy "Public can view menu item ingredients"
on public.menu_item_ingredients for select
using (exists (
  select 1 from public.restaurants r
  where r.id = menu_item_ingredients.restaurant_id
));

create policy "Restaurant members manage menu item ingredients"
on public.menu_item_ingredients for all
to authenticated
using (exists (
  select 1 from public.restaurant_members rm
  where rm.restaurant_id = menu_item_ingredients.restaurant_id
    and rm.user_id = auth.uid()
))
with check (exists (
  select 1 from public.restaurant_members rm
  where rm.restaurant_id = menu_item_ingredients.restaurant_id
    and rm.user_id = auth.uid()
));

create policy "Public can view available menu item extras"
on public.menu_item_extras for select
using (is_available and exists (
  select 1 from public.restaurants r
  where r.id = menu_item_extras.restaurant_id
));

create policy "Restaurant members manage menu item extras"
on public.menu_item_extras for all
to authenticated
using (exists (
  select 1 from public.restaurant_members rm
  where rm.restaurant_id = menu_item_extras.restaurant_id
    and rm.user_id = auth.uid()
))
with check (exists (
  select 1 from public.restaurant_members rm
  where rm.restaurant_id = menu_item_extras.restaurant_id
    and rm.user_id = auth.uid()
));

comment on table public.menu_item_ingredients is 'Ingredients included with a menu item and whether customers may remove them.';
comment on table public.menu_item_extras is 'Optional free or paid extras customers may add to a menu item.';

commit;