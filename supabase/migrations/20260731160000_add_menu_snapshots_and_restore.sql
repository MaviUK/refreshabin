create table if not exists public.menu_snapshots (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  reason text not null default 'manual_backup',
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists menu_snapshots_restaurant_created_idx on public.menu_snapshots(restaurant_id, created_at desc);
alter table public.menu_snapshots enable row level security;
grant select on public.menu_snapshots to authenticated;
create policy "Restaurant owners can view menu snapshots" on public.menu_snapshots for select to authenticated using (
  exists (select 1 from public.restaurant_members rm where rm.restaurant_id=menu_snapshots.restaurant_id and rm.user_id=(select auth.uid()) and rm.role in ('owner','manager'))
);

create or replace function public.capture_restaurant_menu(p_restaurant_id uuid)
returns jsonb language sql stable security definer set search_path='' as $function$
  select jsonb_build_object(
    'categories',coalesce((select jsonb_agg(to_jsonb(x)) from public.menu_categories x where x.restaurant_id=p_restaurant_id),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(to_jsonb(x)) from public.menu_items x where x.restaurant_id=p_restaurant_id),'[]'::jsonb),
    'ingredients',coalesce((select jsonb_agg(to_jsonb(x)) from public.menu_item_ingredients x where x.restaurant_id=p_restaurant_id),'[]'::jsonb),
    'extras',coalesce((select jsonb_agg(to_jsonb(x)) from public.menu_item_extras x where x.restaurant_id=p_restaurant_id),'[]'::jsonb),
    'groups',coalesce((select jsonb_agg(to_jsonb(x)) from public.modifier_groups x where x.restaurant_id=p_restaurant_id),'[]'::jsonb),
    'options',coalesce((select jsonb_agg(to_jsonb(x)) from public.modifier_options x where x.restaurant_id=p_restaurant_id),'[]'::jsonb),
    'assignments',coalesce((select jsonb_agg(to_jsonb(x)) from public.menu_item_modifier_groups x where x.restaurant_id=p_restaurant_id),'[]'::jsonb)
  );
$function$;
revoke all on function public.capture_restaurant_menu(uuid) from public, anon, authenticated;

create or replace function public.reset_restaurant_menu(p_restaurant_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_snapshot_id uuid; v_category_count int; v_item_count int; v_group_count int;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.restaurant_members rm where rm.restaurant_id=p_restaurant_id and rm.user_id=auth.uid() and rm.role in ('owner','manager')) then raise exception 'You do not have permission to replace this menu'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_restaurant_id::text,0));
  insert into public.menu_snapshots(restaurant_id,created_by,reason,snapshot) values(p_restaurant_id,auth.uid(),'before_menu_replacement',public.capture_restaurant_menu(p_restaurant_id)) returning id into v_snapshot_id;
  select count(*) into v_category_count from public.menu_categories where restaurant_id=p_restaurant_id;
  select count(*) into v_item_count from public.menu_items where restaurant_id=p_restaurant_id;
  select count(*) into v_group_count from public.modifier_groups where restaurant_id=p_restaurant_id;
  delete from public.modifier_groups where restaurant_id=p_restaurant_id;
  delete from public.menu_categories where restaurant_id=p_restaurant_id;
  return jsonb_build_object('snapshot_id',v_snapshot_id,'categories_deleted',v_category_count,'items_deleted',v_item_count,'modifier_groups_deleted',v_group_count);
end;
$function$;

create or replace function public.restore_restaurant_menu_snapshot(p_snapshot_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_row public.menu_snapshots%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_row from public.menu_snapshots where id=p_snapshot_id;
  if not found then raise exception 'Menu backup not found'; end if;
  if not exists(select 1 from public.restaurant_members rm where rm.restaurant_id=v_row.restaurant_id and rm.user_id=auth.uid() and rm.role in ('owner','manager')) then raise exception 'You do not have permission to restore this menu'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_row.restaurant_id::text,0));
  insert into public.menu_snapshots(restaurant_id,created_by,reason,snapshot) values(v_row.restaurant_id,auth.uid(),'before_restore',public.capture_restaurant_menu(v_row.restaurant_id));
  delete from public.modifier_groups where restaurant_id=v_row.restaurant_id;
  delete from public.menu_categories where restaurant_id=v_row.restaurant_id;
  insert into public.menu_categories select * from jsonb_populate_recordset(null::public.menu_categories,v_row.snapshot->'categories');
  insert into public.menu_items select * from jsonb_populate_recordset(null::public.menu_items,v_row.snapshot->'items');
  insert into public.menu_item_ingredients select * from jsonb_populate_recordset(null::public.menu_item_ingredients,v_row.snapshot->'ingredients');
  insert into public.menu_item_extras select * from jsonb_populate_recordset(null::public.menu_item_extras,v_row.snapshot->'extras');
  insert into public.modifier_groups select * from jsonb_populate_recordset(null::public.modifier_groups,v_row.snapshot->'groups');
  insert into public.modifier_options select * from jsonb_populate_recordset(null::public.modifier_options,v_row.snapshot->'options');
  insert into public.menu_item_modifier_groups select * from jsonb_populate_recordset(null::public.menu_item_modifier_groups,v_row.snapshot->'assignments');
  return jsonb_build_object('restaurant_id',v_row.restaurant_id,'restored_snapshot_id',p_snapshot_id);
end;
$function$;

revoke all on function public.reset_restaurant_menu(uuid) from public,anon;
grant execute on function public.reset_restaurant_menu(uuid) to authenticated;
revoke all on function public.restore_restaurant_menu_snapshot(uuid) from public,anon;
grant execute on function public.restore_restaurant_menu_snapshot(uuid) to authenticated;
