create or replace function public.run_ai_intelligence_cycle(p_mode text default 'daily',p_limit integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare r record;result jsonb;n int:=0;failed int:=0;errs jsonb:='[]';m text:=case when p_mode in('daily','weekly','monthly') then p_mode else 'daily' end;effective_limit bigint:=case when coalesce(p_limit,0)<=0 then 2147483647 else least(p_limit,5000) end;
begin
 if current_user not in('postgres','service_role') and coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required' using errcode='42501';end if;
 for r in select id from public.restaurants where status='active'::public.restaurant_status order by id limit effective_limit loop
  begin result:=private.generate_restaurant_ai_intelligence(r.id,m);perform private.ai_generate_extended_forecasts(r.id,(result->>'run_id')::uuid);n:=n+1;
  exception when others then failed:=failed+1;errs:=errs||jsonb_build_array(jsonb_build_object('restaurant_id',r.id,'error',sqlerrm));end;
 end loop;
 return jsonb_build_object('mode',m,'processed',n,'failed',failed,'errors',errs,'generated_at',now(),'limit',case when p_limit<=0 then null else effective_limit end);
end$$;
revoke all on function public.run_ai_intelligence_cycle(text,int) from public,anon,authenticated;
grant execute on function public.run_ai_intelligence_cycle(text,int) to service_role;

do $$declare j record;begin for j in select jobid from cron.job where jobname in('ordered-ai-daily','ordered-ai-weekly','ordered-ai-monthly') loop perform cron.unschedule(j.jobid);end loop;end$$;
select cron.schedule('ordered-ai-daily','10 5 * * *',$$select public.run_ai_intelligence_cycle('daily',0)$$);
select cron.schedule('ordered-ai-weekly','20 5 * * 1',$$select public.run_ai_intelligence_cycle('weekly',0)$$);
select cron.schedule('ordered-ai-monthly','30 5 1 * *',$$select public.run_ai_intelligence_cycle('monthly',0)$$);
