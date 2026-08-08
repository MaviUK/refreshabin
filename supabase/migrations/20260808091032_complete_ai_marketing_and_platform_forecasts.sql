create or replace function public.get_restaurant_ai_marketing_intelligence(p_days integer default 90)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  rid uuid:=public.marketing_member_restaurant_id();
  d integer:=least(greatest(coalesce(p_days,90),7),365);
  base jsonb;
  summary jsonb;
  sent numeric:=0;
  opened numeric:=0;
  orders_generated numeric:=0;
  revenue numeric:=0;
  reward_cost numeric:=0;
  open_rate numeric:=0;
  conversion_rate numeric:=0;
  roi numeric:=null;
  best_send record;
begin
  if rid is null then raise exception 'Restaurant membership not found' using errcode='42501'; end if;
  base:=public.get_restaurant_marketing_reports(d);
  summary:=coalesce(base->'summary','{}'::jsonb);
  sent:=coalesce((summary->>'sent')::numeric,0);
  opened:=coalesce((summary->>'opened')::numeric,0);
  orders_generated:=coalesce((summary->>'orders_generated')::numeric,0);
  revenue:=coalesce((summary->>'revenue_generated_pence')::numeric,0);
  reward_cost:=coalesce((summary->>'reward_cost_pence')::numeric,0);
  open_rate:=case when sent>0 then 100*opened/sent else 0 end;
  conversion_rate:=case when sent>0 then 100*orders_generated/sent else 0 end;
  roi:=case when reward_cost>0 then 100*(revenue-reward_cost)/reward_cost else null end;

  select extract(dow from coalesce(opened_at,clicked_at,sent_at))::int as day_of_week,
         extract(hour from coalesce(opened_at,clicked_at,sent_at))::int as hour_of_day,
         count(*)::int as engagement_events
    into best_send
  from public.restaurant_marketing_deliveries
  where restaurant_id=rid
    and created_at>=now()-(d||' days')::interval
    and (opened_at is not null or clicked_at is not null)
  group by 1,2 order by count(*) desc limit 1;

  return base || jsonb_build_object(
    'ai_summary',jsonb_build_object(
      'open_rate_percent',round(open_rate,2),
      'conversion_rate_percent',round(conversion_rate,2),
      'roi_percent',case when roi is null then null else round(roi,2) end,
      'customer_acquisition_cost_pence',null,
      'customer_acquisition_cost_note','Paid acquisition media spend is not stored in ordered.food, so CAC cannot be calculated truthfully yet.',
      'best_send_time',case when best_send.day_of_week is null then null else jsonb_build_object('day_of_week',best_send.day_of_week,'hour_of_day',best_send.hour_of_day,'engagement_events',best_send.engagement_events) end,
      'retention_percent',coalesce((summary->>'retention_percent')::numeric,0),
      'reactivation_percent',coalesce((summary->>'reactivation_percent')::numeric,0)
    ),
    'recommendations',coalesce((select jsonb_agg(to_jsonb(x) order by x.confidence desc,x.generated_at desc) from (
      select id,category,insight_type,severity,title,summary,explanation,confidence,evidence,suggested_action,generated_at
      from public.restaurant_ai_insights
      where restaurant_id=rid and status in('active','seen') and category in('marketing','customer','growth','revenue')
      order by confidence desc,generated_at desc limit 20
    ) x),'[]'::jsonb),
    'methodology',jsonb_build_object('analytics_source','existing_phase_5_8_marketing_reports','provider','internal','version','5.9.1','cac_available',false)
  );
end $$;

create or replace function public.get_platform_ai_intelligence_forecasts()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if not private.has_platform_admin_permission('overview:view') then raise exception 'Platform overview permission required' using errcode='42501'; end if;
  return jsonb_build_object(
    'weekly_customer_growth',coalesce((select round(sum(predicted_value),1) from public.restaurant_ai_forecasts where metric='customer_growth_count' and horizon='weekly' and period_end>now()),0),
    'monthly_customer_growth',coalesce((select round(sum(predicted_value),1) from public.restaurant_ai_forecasts where metric='customer_growth_count' and horizon='monthly' and period_end>now()),0),
    'weekly_campaign_revenue_pence',coalesce((select round(sum(predicted_value)) from public.restaurant_ai_forecasts where metric='campaign_revenue_pence' and horizon='weekly' and period_end>now()),0),
    'monthly_campaign_revenue_pence',coalesce((select round(sum(predicted_value)) from public.restaurant_ai_forecasts where metric='campaign_revenue_pence' and horizon='monthly' and period_end>now()),0),
    'weekly_repeat_customer_percent',coalesce((select round(avg(predicted_value),1) from public.restaurant_ai_forecasts where metric='repeat_customer_percent' and horizon='weekly' and period_end>now()),0),
    'monthly_repeat_customer_percent',coalesce((select round(avg(predicted_value),1) from public.restaurant_ai_forecasts where metric='repeat_customer_percent' and horizon='monthly' and period_end>now()),0),
    'average_engagement_score',coalesce((select round(avg(engagement_score),1) from public.restaurant_ai_customer_scores),0),
    'average_return_probability',coalesce((select round(avg(return_probability),1) from public.restaurant_ai_customer_scores),0),
    'generated_at',now(),
    'methodology',jsonb_build_object('provider','internal','version','5.9.1','aggregation','current restaurant forecasts')
  );
end $$;

revoke all on function public.get_restaurant_ai_marketing_intelligence(integer) from public,anon;
revoke all on function public.get_platform_ai_intelligence_forecasts() from public,anon;
grant execute on function public.get_restaurant_ai_marketing_intelligence(integer) to authenticated;
grant execute on function public.get_platform_ai_intelligence_forecasts() to authenticated;
