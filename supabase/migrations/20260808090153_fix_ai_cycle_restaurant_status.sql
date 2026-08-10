create or replace function public.run_ai_intelligence_cycle(p_mode text default 'daily',p_limit integer default 100) returns jsonb language plpgsql security definer set search_path='' as $$
declare r record;n int:=0;failed int:=0;errs jsonb:='[]';m text:=case when p_mode in('daily','weekly','monthly') then p_mode else 'daily' end;
begin
 if current_user not in('postgres','service_role') and coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required' using errcode='42501';end if;
 for r in select id from public.restaurants where status='active'::public.restaurant_status order by id limit least(greatest(coalesce(p_limit,100),1),500) loop
  begin perform private.generate_restaurant_ai_intelligence(r.id,m);n:=n+1;
  exception when others then failed:=failed+1;errs:=errs||jsonb_build_array(jsonb_build_object('restaurant_id',r.id,'error',sqlerrm));end;
 end loop;
 return jsonb_build_object('mode',m,'processed',n,'failed',failed,'errors',errs,'generated_at',now());
end$$;
revoke all on function public.run_ai_intelligence_cycle(text,int) from public,anon,authenticated;
grant execute on function public.run_ai_intelligence_cycle(text,int) to service_role;
