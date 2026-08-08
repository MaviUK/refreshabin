create or replace function private.restaurant_group_feature_restaurants(p_restaurant_id uuid,p_feature text)
returns table(restaurant_id uuid) language plpgsql stable security definer set search_path='' as $$
declare l public.restaurant_group_locations%rowtype; v_scope text;
begin
 select gl.* into l from public.restaurant_group_locations gl where gl.restaurant_id=p_restaurant_id and gl.status='active';
 if not found then return query select p_restaurant_id; return; end if;
 if not exists(select 1 from public.restaurant_groups g where g.id=l.group_id and g.status='active') then return query select p_restaurant_id; return; end if;
 v_scope:=coalesce(private.restaurant_group_feature_scope(l.group_id,p_feature),'restaurant');
 if v_scope='group' then
   return query select gl.restaurant_id from public.restaurant_group_locations gl where gl.group_id=l.group_id and gl.status='active';
 elsif v_scope='brand' and l.brand_id is not null then
   return query select gl.restaurant_id from public.restaurant_group_locations gl where gl.group_id=l.group_id and gl.brand_id=l.brand_id and gl.status='active';
 elsif v_scope='region' and l.region_id is not null then
   return query select gl.restaurant_id from public.restaurant_group_locations gl where gl.group_id=l.group_id and gl.status='active' and gl.region_id is not null and private.restaurant_group_region_contains(l.region_id,gl.region_id);
 else
   return query select p_restaurant_id;
 end if;
end $$;
