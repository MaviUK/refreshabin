alter table public.menu_snapshots
  add column if not exists label text;

create or replace function public.create_restaurant_menu_snapshot(
  p_restaurant_id uuid,
  p_label text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_snapshot_id uuid;
  v_label text := nullif(trim(p_label), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.restaurant_members rm
    where rm.restaurant_id = p_restaurant_id
      and rm.user_id = auth.uid()
      and rm.role in ('owner', 'manager')
  ) then
    raise exception 'You do not have permission to back up this menu';
  end if;

  if length(coalesce(v_label, '')) > 80 then
    raise exception 'Backup name must be 80 characters or fewer';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_restaurant_id::text, 0));

  insert into public.menu_snapshots (restaurant_id, created_by, reason, label, snapshot)
  values (
    p_restaurant_id,
    auth.uid(),
    'manual_backup',
    coalesce(v_label, 'Manual backup'),
    public.capture_restaurant_menu(p_restaurant_id)
  )
  returning id into v_snapshot_id;

  return v_snapshot_id;
end;
$function$;

revoke all on function public.create_restaurant_menu_snapshot(uuid, text) from public, anon;
grant execute on function public.create_restaurant_menu_snapshot(uuid, text) to authenticated;
