begin;

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.restaurant_application_reviews (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  reviewed_by uuid not null references auth.users(id),
  decision text not null check (decision in ('approved', 'rejected')),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists restaurant_application_reviews_restaurant_idx
  on public.restaurant_application_reviews(restaurant_id, created_at desc);

alter table public.platform_admins enable row level security;
alter table public.restaurant_application_reviews enable row level security;

drop policy if exists "Platform admins can read own access" on public.platform_admins;
create policy "Platform admins can read own access"
on public.platform_admins for select
to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1 from public.platform_admins
      where user_id = (select auth.uid())
    );
$$;

revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

drop policy if exists "Platform admins can read application reviews" on public.restaurant_application_reviews;
create policy "Platform admins can read application reviews"
on public.restaurant_application_reviews for select
to authenticated
using ((select public.is_platform_admin()));

create or replace function public.get_restaurant_applications(p_status text default 'pending_approval')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if p_status not in ('pending_approval', 'active', 'rejected') then
    raise exception 'Unsupported application status' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(application order by application.submitted_at asc nulls last), '[]'::jsonb)
  into result
  from (
    select
      r.id,
      r.name,
      r.slug,
      r.status::text,
      r.email,
      r.phone,
      r.cuisines,
      r.accepts_delivery,
      r.accepts_collection,
      r.minimum_order_pence,
      r.delivery_fee_pence,
      r.delivery_radius_miles,
      r.logo_url,
      r.cover_url,
      r.submitted_at,
      r.approved_at,
      r.approval_notes,
      coalesce((
        select jsonb_build_object(
          'address_line_1', l.address_line_1,
          'address_line_2', l.address_line_2,
          'city', l.city,
          'postcode', l.postcode
        )
        from public.restaurant_locations l
        where l.restaurant_id = r.id and l.is_active
        order by l.created_at asc
        limit 1
      ), '{}'::jsonb) as location,
      (select count(*) from public.opening_hours h where h.restaurant_id = r.id) as opening_hours_count,
      (select count(*) from public.menu_categories c where c.restaurant_id = r.id) as menu_category_count,
      (select count(*) from public.menu_items i where i.restaurant_id = r.id) as menu_item_count
    from public.restaurants r
    where r.status::text = p_status
  ) application;

  return result;
end;
$$;

revoke all on function public.get_restaurant_applications(text) from public, anon;
grant execute on function public.get_restaurant_applications(text) to authenticated;

create or replace function public.review_restaurant_application(
  p_restaurant_id uuid,
  p_decision text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_status public.restaurant_status;
begin
  if not public.is_platform_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected' using errcode = '22023';
  end if;

  if p_decision = 'rejected' and nullif(trim(coalesce(p_notes, '')), '') is null then
    raise exception 'A review note is required when rejecting an application' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.restaurants
    where id = p_restaurant_id and status = 'pending_approval'
    for update
  ) then
    raise exception 'Pending restaurant application not found' using errcode = 'P0002';
  end if;

  next_status := case when p_decision = 'approved' then 'active' else 'rejected' end;

  update public.restaurants
  set status = next_status,
      approved_at = case when p_decision = 'approved' then now() else null end,
      approval_notes = nullif(trim(coalesce(p_notes, '')), ''),
      updated_at = now()
  where id = p_restaurant_id;

  insert into public.restaurant_application_reviews (restaurant_id, reviewed_by, decision, notes)
  values (p_restaurant_id, (select auth.uid()), p_decision, nullif(trim(coalesce(p_notes, '')), ''));

  return jsonb_build_object(
    'restaurant_id', p_restaurant_id,
    'status', next_status::text,
    'decision', p_decision
  );
end;
$$;

revoke all on function public.review_restaurant_application(uuid, text, text) from public, anon;
grant execute on function public.review_restaurant_application(uuid, text, text) to authenticated;

comment on table public.platform_admins is 'Explicit allow-list for ordered.food platform administrators.';
comment on table public.restaurant_application_reviews is 'Immutable audit trail of restaurant application decisions.';

commit;
