begin;

create table if not exists public.platform_restaurant_notes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  author_user_id uuid not null references auth.users(id),
  note text not null check (char_length(trim(note)) between 3 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists platform_restaurant_notes_restaurant_idx
  on public.platform_restaurant_notes (restaurant_id, created_at desc);

alter table public.platform_restaurant_notes enable row level security;
revoke all on table public.platform_restaurant_notes from public, anon, authenticated;

create or replace function public.get_platform_restaurant_activity(p_restaurant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  if not private.has_platform_admin_permission('restaurants:view') then
    raise exception 'You do not have permission to view restaurant activity' using errcode = '42501';
  end if;

  if not exists (select 1 from public.restaurants r where r.id = p_restaurant_id) then
    raise exception 'Restaurant not found' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'notes', coalesce((
      select jsonb_agg(note_row order by note_row.created_at desc)
      from (
        select
          n.id,
          n.note,
          n.created_at,
          n.updated_at,
          n.author_user_id,
          coalesce(pa.display_name, split_part(u.email, '@', 1), 'Platform admin') as author_name,
          u.email as author_email
        from public.platform_restaurant_notes n
        left join public.platform_admins pa on pa.user_id = n.author_user_id
        left join auth.users u on u.id = n.author_user_id
        where n.restaurant_id = p_restaurant_id
        order by n.created_at desc
        limit 100
      ) note_row
    ), '[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(activity_row order by activity_row.created_at desc)
      from (
        select
          l.id,
          l.action,
          l.details,
          l.created_at,
          l.actor_user_id,
          coalesce(pa.display_name, split_part(u.email, '@', 1), 'Platform admin') as actor_name,
          u.email as actor_email
        from public.platform_admin_audit_log l
        left join public.platform_admins pa on pa.user_id = l.actor_user_id
        left join auth.users u on u.id = l.actor_user_id
        where l.target_type = 'restaurant'
          and l.target_id = p_restaurant_id
        order by l.created_at desc
        limit 150
      ) activity_row
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$function$;

revoke all on function public.get_platform_restaurant_activity(uuid) from public, anon, authenticated;
grant execute on function public.get_platform_restaurant_activity(uuid) to authenticated;

create or replace function public.add_platform_restaurant_note(
  p_restaurant_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := (select auth.uid());
  clean_note text := trim(coalesce(p_note, ''));
  inserted_note public.platform_restaurant_notes%rowtype;
begin
  if not private.has_platform_admin_permission('restaurants:manage') then
    raise exception 'You do not have permission to add restaurant notes' using errcode = '42501';
  end if;

  if char_length(clean_note) < 3 or char_length(clean_note) > 4000 then
    raise exception 'Note must be between 3 and 4000 characters' using errcode = '22023';
  end if;

  if not exists (select 1 from public.restaurants r where r.id = p_restaurant_id) then
    raise exception 'Restaurant not found' using errcode = 'P0002';
  end if;

  insert into public.platform_restaurant_notes (restaurant_id, author_user_id, note)
  values (p_restaurant_id, actor_id, clean_note)
  returning * into inserted_note;

  insert into public.platform_admin_audit_log (
    actor_user_id,
    action,
    target_type,
    target_id,
    details
  ) values (
    actor_id,
    'restaurant_internal_note_added',
    'restaurant',
    p_restaurant_id,
    jsonb_build_object('note_id', inserted_note.id, 'preview', left(clean_note, 160))
  );

  return jsonb_build_object(
    'id', inserted_note.id,
    'note', inserted_note.note,
    'created_at', inserted_note.created_at,
    'updated_at', inserted_note.updated_at,
    'author_user_id', inserted_note.author_user_id
  );
end;
$function$;

revoke all on function public.add_platform_restaurant_note(uuid, text) from public, anon, authenticated;
grant execute on function public.add_platform_restaurant_note(uuid, text) to authenticated;

commit;
