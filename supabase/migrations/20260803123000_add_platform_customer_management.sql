begin;

create table if not exists public.platform_customer_notes (
  id bigint generated always as identity primary key,
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  note text not null check (length(trim(note)) > 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.platform_customer_notes enable row level security;
revoke all on table public.platform_customer_notes from anon, authenticated;

create index if not exists platform_customer_notes_customer_idx
  on public.platform_customer_notes (customer_user_id, created_at desc);

create or replace function public.get_platform_customers(p_search text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(c order by c.created_at desc), '[]'::jsonb)
  into result
  from (
    select
      u.id as user_id,
      u.email,
      coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), split_part(u.email, '@', 1)) as display_name,
      p.phone,
      p.town_city,
      p.postcode,
      u.created_at,
      u.last_sign_in_at,
      (u.banned_until is not null and u.banned_until > now()) as is_suspended,
      count(o.id)::int as order_count,
      coalesce(sum(case when o.payment_status in ('paid', 'partially_refunded') then o.total_pence else 0 end), 0)::bigint as lifetime_spend_pence,
      max(o.created_at) as last_order_at
    from auth.users u
    left join public.customer_profiles p on p.user_id = u.id
    left join public.orders o on o.customer_user_id = u.id
    where not exists (select 1 from public.platform_admins pa where pa.user_id = u.id)
      and (
        nullif(trim(p_search), '') is null
        or u.email ilike '%' || trim(p_search) || '%'
        or p.first_name ilike '%' || trim(p_search) || '%'
        or p.last_name ilike '%' || trim(p_search) || '%'
        or p.phone ilike '%' || trim(p_search) || '%'
      )
    group by u.id, u.email, p.first_name, p.last_name, p.phone, p.town_city, p.postcode,
             u.created_at, u.last_sign_in_at, u.banned_until
    limit 250
  ) c;

  return result;
end;
$$;

create or replace function public.get_platform_customer(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'user_id', u.id,
    'email', u.email,
    'first_name', p.first_name,
    'last_name', p.last_name,
    'phone', p.phone,
    'address_line_1', p.address_line_1,
    'address_line_2', p.address_line_2,
    'town_city', p.town_city,
    'postcode', p.postcode,
    'created_at', u.created_at,
    'last_sign_in_at', u.last_sign_in_at,
    'is_suspended', (u.banned_until is not null and u.banned_until > now()),
    'orders', coalesce((select jsonb_agg(jsonb_build_object(
      'id', o.id, 'order_number', o.order_number, 'restaurant_name', r.name,
      'total_pence', o.total_pence, 'order_status', o.order_status,
      'payment_status', o.payment_status, 'created_at', o.created_at
    ) order by o.created_at desc) from public.orders o join public.restaurants r on r.id = o.restaurant_id where o.customer_user_id = u.id), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object(
      'id', n.id, 'note', n.note, 'created_at', n.created_at,
      'created_by', coalesce(pa.display_name, au.email)
    ) order by n.created_at desc) from public.platform_customer_notes n left join public.platform_admins pa on pa.user_id = n.created_by left join auth.users au on au.id = n.created_by where n.customer_user_id = u.id), '[]'::jsonb)
  ) into result
  from auth.users u
  left join public.customer_profiles p on p.user_id = u.id
  where u.id = p_user_id;

  if result is null then raise exception 'Customer not found' using errcode = 'P0002'; end if;
  return result;
end;
$$;

create or replace function public.update_platform_customer_profile(
  p_user_id uuid,
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_address_line_1 text,
  p_address_line_2 text,
  p_town_city text,
  p_postcode text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then raise exception 'Administrator access required' using errcode = '42501'; end if;

  insert into public.customer_profiles (user_id, first_name, last_name, phone, address_line_1, address_line_2, town_city, postcode, updated_at)
  values (p_user_id, nullif(trim(p_first_name), ''), nullif(trim(p_last_name), ''), nullif(trim(p_phone), ''), nullif(trim(p_address_line_1), ''), nullif(trim(p_address_line_2), ''), nullif(trim(p_town_city), ''), nullif(upper(trim(p_postcode)), ''), now())
  on conflict (user_id) do update set
    first_name = excluded.first_name, last_name = excluded.last_name, phone = excluded.phone,
    address_line_1 = excluded.address_line_1, address_line_2 = excluded.address_line_2,
    town_city = excluded.town_city, postcode = excluded.postcode, updated_at = now();

  insert into public.platform_admin_audit_log (actor_user_id, action, target_type, target_id, details)
  values (auth.uid(), 'customer_profile_updated', 'customer', p_user_id, '{}'::jsonb);
end;
$$;

create or replace function public.set_platform_customer_suspension(p_user_id uuid, p_suspended boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then raise exception 'Administrator access required' using errcode = '42501'; end if;
  if p_suspended and nullif(trim(p_reason), '') is null then raise exception 'A suspension reason is required' using errcode = '22023'; end if;

  update auth.users set banned_until = case when p_suspended then now() + interval '100 years' else null end where id = p_user_id;
  if not found then raise exception 'Customer not found' using errcode = 'P0002'; end if;

  insert into public.platform_admin_audit_log (actor_user_id, action, target_type, target_id, details)
  values (auth.uid(), case when p_suspended then 'customer_suspended' else 'customer_reactivated' end, 'customer', p_user_id, jsonb_build_object('reason', nullif(trim(p_reason), '')));
end;
$$;

create or replace function public.add_platform_customer_note(p_user_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then raise exception 'Administrator access required' using errcode = '42501'; end if;
  insert into public.platform_customer_notes (customer_user_id, note, created_by) values (p_user_id, trim(p_note), auth.uid());
  insert into public.platform_admin_audit_log (actor_user_id, action, target_type, target_id, details)
  values (auth.uid(), 'customer_note_added', 'customer', p_user_id, '{}'::jsonb);
end;
$$;

revoke all on function public.get_platform_customers(text) from public, anon, authenticated;
revoke all on function public.get_platform_customer(uuid) from public, anon, authenticated;
revoke all on function public.update_platform_customer_profile(uuid,text,text,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.set_platform_customer_suspension(uuid,boolean,text) from public, anon, authenticated;
revoke all on function public.add_platform_customer_note(uuid,text) from public, anon, authenticated;
grant execute on function public.get_platform_customers(text) to authenticated;
grant execute on function public.get_platform_customer(uuid) to authenticated;
grant execute on function public.update_platform_customer_profile(uuid,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.set_platform_customer_suspension(uuid,boolean,text) to authenticated;
grant execute on function public.add_platform_customer_note(uuid,text) to authenticated;

commit;
