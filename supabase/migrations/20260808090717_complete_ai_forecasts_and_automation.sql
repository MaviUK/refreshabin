create extension if not exists pg_cron with schema pg_catalog;

create or replace function private.ai_generate_extended_forecasts(rid uuid,runid uuid) returns integer language plpgsql security definer set search_path='' as $$
declare new28 numeric:=0;newprev numeric:=0;repeatpct numeric:=0;camp28 numeric:=0;campprev numeric:=0;newtrend numeric:=1;camptrend numeric:=1;confidence numeric:=.5;wk timestamptz:=date_trunc('week',now())+interval '1 week';mo timestamptz:=date_trunc('month',now())+interval '1 month';
begin
 with firsts as(select customer_user_id,min(created_at) first_at from public.orders where restaurant_id=rid and customer_user_id is not null and payment_status='paid' and order_status<>'rejected' group by customer_user_id)
 select count(*) filter(where first_at>=now()-interval '28 days'),count(*) filter(where first_at>=now()-interval '56 days' and first_at<now()-interval '28 days') into new28,newprev from firsts;
 with c as(select customer_user_id,count(*) n from public.orders where restaurant_id=rid and customer_user_id is not null and payment_status='paid' and order_status<>'rejected' and created_at>=now()-interval '90 days' group by customer_user_id)
 select coalesce(100.0*count(*) filter(where n>=2)/nullif(count(*),0),0) into repeatpct from c;
 select coalesce(sum(revenue_pence),0) into camp28 from public.restaurant_marketing_conversions where restaurant_id=rid and attributed_at>=now()-interval '28 days';
 select coalesce(sum(revenue_pence),0) into campprev from public.restaurant_marketing_conversions where restaurant_id=rid and attributed_at>=now()-interval '56 days' and attributed_at<now()-interval '28 days';
 newtrend:=least(1.5,greatest(.5,case when newprev>0 then new28/newprev else 1 end));camptrend:=least(1.5,greatest(.5,case when campprev>0 then camp28/campprev else 1 end));confidence:=least(.88,.45+least(new28+(select count(*) from public.restaurant_marketing_deliveries where restaurant_id=rid and created_at>=now()-interval '28 days'),200)/500);
 insert into public.restaurant_ai_forecasts(restaurant_id,metric,horizon,period_start,period_end,predicted_value,lower_bound,upper_bound,confidence,explanation,evidence,run_id,generated_at)
 select rid,v.metric,v.horizon,v.start_at,v.end_at,round(v.val,2),round(greatest(0,v.val*.78),2),round(v.val*1.22,2),case when v.horizon='weekly' then confidence else greatest(.35,confidence-.08) end,v.explanation,v.evidence,runid,now()
 from(values
 ('customer_growth_count','weekly',wk,wk+interval '7 days',(new28/4)*newtrend,'New-customer forecast uses first paid order dates over two rolling 28-day windows with a bounded trend factor.',jsonb_build_object('new_customers_28d',new28,'previous_new_customers_28d',newprev,'trend_factor',newtrend)),
 ('customer_growth_count','monthly',mo,mo+interval '1 month',(new28/28*30)*newtrend,'Monthly new-customer forecast annualises the recent first-order rate and applies the bounded comparison trend.',jsonb_build_object('new_customers_28d',new28,'previous_new_customers_28d',newprev,'trend_factor',newtrend)),
 ('repeat_customer_percent','weekly',wk,wk+interval '7 days',repeatpct,'Repeat-customer prediction uses the share of identified customers with at least two paid orders in the last 90 days.',jsonb_build_object('repeat_customer_percent_90d',repeatpct)),
 ('repeat_customer_percent','monthly',mo,mo+interval '1 month',repeatpct,'Monthly repeat-customer prediction uses the current 90-day repeat baseline with wider uncertainty.',jsonb_build_object('repeat_customer_percent_90d',repeatpct)),
 ('campaign_revenue_pence','weekly',wk,wk+interval '7 days',(camp28/4)*camptrend,'Campaign performance forecast uses existing attributed marketing conversion revenue across two rolling 28-day windows.',jsonb_build_object('campaign_revenue_28d',camp28,'previous_campaign_revenue_28d',campprev,'trend_factor',camptrend)),
 ('campaign_revenue_pence','monthly',mo,mo+interval '1 month',(camp28/28*30)*camptrend,'Monthly campaign revenue forecast annualises current attributed revenue and applies a bounded trend factor.',jsonb_build_object('campaign_revenue_28d',camp28,'previous_campaign_revenue_28d',campprev,'trend_factor',camptrend)))v(metric,horizon,start_at,end_at,val,explanation,evidence)
 on conflict(restaurant_id,metric,horizon,period_start) do update set predicted_value=excluded.predicted_value,lower_bound=excluded.lower_bound,upper_bound=excluded.upper_bound,confidence=excluded.confidence,explanation=excluded.explanation,evidence=excluded.evidence,run_id=excluded.run_id,generated_at=now();
 return 6;
end$$;
revoke all on function private.ai_generate_extended_forecasts(uuid,uuid) from public;

create or replace function public.refresh_restaurant_ai_intelligence() returns jsonb language plpgsql security definer set search_path='' as $$declare rid uuid:=public.marketing_member_restaurant_id();r jsonb;begin if rid is null then raise exception 'Restaurant membership not found' using errcode='42501';end if;r:=private.generate_restaurant_ai_intelligence(rid,'refresh');perform private.ai_generate_extended_forecasts(rid,(r->>'run_id')::uuid);return r||jsonb_build_object('extended_forecasts',6);end$$;

create or replace function public.run_ai_intelligence_cycle(p_mode text default 'daily',p_limit integer default 100) returns jsonb language plpgsql security definer set search_path='' as $$declare r record;result jsonb;n int:=0;failed int:=0;errs jsonb:='[]';m text:=case when p_mode in('daily','weekly','monthly') then p_mode else 'daily' end;begin if current_user not in('postgres','service_role') and coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required' using errcode='42501';end if;for r in select id from public.restaurants where status='active'::public.restaurant_status order by id limit least(greatest(coalesce(p_limit,100),1),500) loop begin result:=private.generate_restaurant_ai_intelligence(r.id,m);perform private.ai_generate_extended_forecasts(r.id,(result->>'run_id')::uuid);n:=n+1;exception when others then failed:=failed+1;errs:=errs||jsonb_build_array(jsonb_build_object('restaurant_id',r.id,'error',sqlerrm));end;end loop;return jsonb_build_object('mode',m,'processed',n,'failed',failed,'errors',errs,'generated_at',now());end$$;
revoke all on function public.run_ai_intelligence_cycle(text,int) from public,anon,authenticated;
grant execute on function public.run_ai_intelligence_cycle(text,int) to service_role;

do $$declare j record;begin for j in select jobid from cron.job where jobname in('ordered-ai-daily','ordered-ai-weekly','ordered-ai-monthly') loop perform cron.unschedule(j.jobid);end loop;end$$;
select cron.schedule('ordered-ai-daily','10 5 * * *',$$select public.run_ai_intelligence_cycle('daily',500)$$);
select cron.schedule('ordered-ai-weekly','20 5 * * 1',$$select public.run_ai_intelligence_cycle('weekly',500)$$);
select cron.schedule('ordered-ai-monthly','30 5 1 * *',$$select public.run_ai_intelligence_cycle('monthly',500)$$);
