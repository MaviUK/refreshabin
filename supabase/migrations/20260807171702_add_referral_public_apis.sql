create or replace function public.save_restaurant_referral_program(
  p_is_enabled boolean,p_referrer_reward_type text,p_referrer_reward_value integer,p_referee_reward_type text,p_referee_reward_value integer,
  p_minimum_qualifying_order_pence integer default 0,p_qualifying_order_count integer default 1,p_reward_delay_hours integer default 0,
  p_starts_at timestamptz default null,p_ends_at timestamptz default null,p_maximum_referrals_per_customer integer default null,p_campaign_referral_cap integer default null,p_terms_text text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare rid uuid; p public.restaurant_referral_programs%rowtype; refcat uuid; friendcat uuid;
begin
  select restaurant_id into rid from public.restaurant_members where user_id=auth.uid() order by created_at limit 1;
  if rid is null then raise exception 'Restaurant membership not found' using errcode='42501'; end if;
  if p_referrer_reward_type not in ('store_credit','loyalty_points','fixed_value_voucher','percentage_voucher','free_delivery') or p_referee_reward_type not in ('store_credit','loyalty_points','fixed_value_voucher','percentage_voucher','free_delivery') then raise exception 'Invalid referral reward type'; end if;
  if p_qualifying_order_count not between 1 and 20 or p_reward_delay_hours not between 0 and 2160 or p_minimum_qualifying_order_pence<0 then raise exception 'Invalid qualification settings'; end if;
  if p_ends_at is not null and p_starts_at is not null and p_ends_at<=p_starts_at then raise exception 'End date must be after start date'; end if;
  if (p_referrer_reward_type='free_delivery' and p_referrer_reward_value<>0) or (p_referrer_reward_type<>'free_delivery' and p_referrer_reward_value<=0) then raise exception 'Invalid referrer reward value'; end if;
  if (p_referee_reward_type='free_delivery' and p_referee_reward_value<>0) or (p_referee_reward_type<>'free_delivery' and p_referee_reward_value<=0) then raise exception 'Invalid referee reward value'; end if;
  if (p_referrer_reward_type='percentage_voucher' and p_referrer_reward_value>10000) or (p_referee_reward_type='percentage_voucher' and p_referee_reward_value>10000) then raise exception 'Percentage reward cannot exceed 100%%'; end if;
  insert into public.restaurant_referral_programs(restaurant_id,is_enabled,referrer_reward_type,referrer_reward_value,referee_reward_type,referee_reward_value,minimum_qualifying_order_pence,qualifying_order_count,reward_delay_hours,starts_at,ends_at,maximum_referrals_per_customer,campaign_referral_cap,terms_text,created_by)
  values(rid,p_is_enabled,p_referrer_reward_type,p_referrer_reward_value,p_referee_reward_type,p_referee_reward_value,p_minimum_qualifying_order_pence,p_qualifying_order_count,p_reward_delay_hours,p_starts_at,p_ends_at,p_maximum_referrals_per_customer,p_campaign_referral_cap,nullif(trim(p_terms_text),''),auth.uid())
  on conflict(restaurant_id) do update set is_enabled=excluded.is_enabled,referrer_reward_type=excluded.referrer_reward_type,referrer_reward_value=excluded.referrer_reward_value,referee_reward_type=excluded.referee_reward_type,referee_reward_value=excluded.referee_reward_value,minimum_qualifying_order_pence=excluded.minimum_qualifying_order_pence,qualifying_order_count=excluded.qualifying_order_count,reward_delay_hours=excluded.reward_delay_hours,starts_at=excluded.starts_at,ends_at=excluded.ends_at,maximum_referrals_per_customer=excluded.maximum_referrals_per_customer,campaign_referral_cap=excluded.campaign_referral_cap,terms_text=excluded.terms_text,updated_at=now() returning * into p;
  refcat:=private.sync_referral_catalogue_reward(p.id,'referrer',p_referrer_reward_type,p_referrer_reward_value);
  friendcat:=private.sync_referral_catalogue_reward(p.id,'referee',p_referee_reward_type,p_referee_reward_value);
  update public.restaurant_referral_programs set referrer_reward_catalogue_id=refcat,referee_reward_catalogue_id=friendcat,updated_at=now() where id=p.id returning * into p;
  return to_jsonb(p);
end$$;

create or replace function private.new_referral_code() returns text language plpgsql volatile set search_path='' as $$declare c text; begin loop c:='OF-'||upper(substr(encode(extensions.gen_random_bytes(8),'hex'),1,10)); exit when not exists(select 1 from public.customer_referral_codes where code=c); end loop; return c; end$$;

create or replace function public.get_customer_referral_dashboard() returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); result jsonb;
begin
  if uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
  insert into public.customer_referral_codes(program_id,restaurant_id,customer_user_id,code)
  select p.id,p.restaurant_id,uid,private.new_referral_code() from public.restaurant_referral_programs p where p.is_enabled and not p.disabled_by_platform and (p.starts_at is null or p.starts_at<=now()) and (p.ends_at is null or p.ends_at>now()) and exists(select 1 from public.orders o where o.restaurant_id=p.restaurant_id and o.customer_user_id=uid and o.payment_status='paid' and o.order_status='completed')
  on conflict(program_id,customer_user_id) do nothing;
  select jsonb_build_object(
    'summary',jsonb_build_object('friends',count(distinct cr.id),'qualified',count(distinct cr.id) filter(where cr.status in ('qualified','rewarded')),'rewarded',count(distinct cr.id) filter(where cr.status='rewarded'),'pending_rewards',(select count(*) from public.referral_rewards rw where rw.customer_user_id=uid and rw.status='pending'),'available_rewards',(select count(*) from public.referral_rewards rw where rw.customer_user_id=uid and rw.status='available')),
    'programs',coalesce((select jsonb_agg(jsonb_build_object('program_id',p.id,'restaurant_id',p.restaurant_id,'restaurant_name',r.name,'restaurant_slug',r.slug,'code',c.code,'referrer_reward',private.referral_reward_label(p.referrer_reward_type,p.referrer_reward_value),'referee_reward',private.referral_reward_label(p.referee_reward_type,p.referee_reward_value),'minimum_order_pence',p.minimum_qualifying_order_pence,'qualifying_order_count',p.qualifying_order_count,'reward_delay_hours',p.reward_delay_hours,'ends_at',p.ends_at,'terms_text',p.terms_text) order by r.name) from public.customer_referral_codes c join public.restaurant_referral_programs p on p.id=c.program_id join public.restaurants r on r.id=p.restaurant_id where c.customer_user_id=uid and c.is_active and p.is_enabled and not p.disabled_by_platform and (p.ends_at is null or p.ends_at>now())),'[]'::jsonb),
    'referrals',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'restaurant_name',r.name,'friend_name',coalesce(cp.first_name,'Friend'),'status',x.status,'qualifying_order_count',x.qualifying_order_count,'qualifying_revenue_pence',x.qualifying_revenue_pence,'registered_at',x.registered_at,'qualified_at',x.qualified_at,'rewarded_at',x.rewarded_at,'created_at',x.created_at) order by x.created_at desc) from public.customer_referrals x join public.restaurants r on r.id=x.restaurant_id left join public.customer_profiles cp on cp.user_id=x.referred_user_id where x.referrer_user_id=uid),'[]'::jsonb),
    'rewards',coalesce((select jsonb_agg(jsonb_build_object('id',rw.id,'restaurant_name',r.name,'recipient_role',rw.recipient_role,'reward_type',rw.reward_type,'reward_value',rw.reward_value,'reward_label',private.referral_reward_label(rw.reward_type,rw.reward_value),'status',rw.status,'available_at',rw.available_at,'issued_at',rw.issued_at,'created_at',rw.created_at) order by rw.created_at desc) from public.referral_rewards rw join public.restaurants r on r.id=rw.restaurant_id where rw.customer_user_id=uid),'[]'::jsonb)
  ) into result from public.customer_referrals cr where cr.referrer_user_id=uid;
  return result;
end$$;

create or replace function public.get_referral_program_by_code(p_code text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  select jsonb_build_object('valid',true,'restaurant_id',p.restaurant_id,'restaurant_name',r.name,'restaurant_slug',r.slug,'referrer_reward',private.referral_reward_label(p.referrer_reward_type,p.referrer_reward_value),'referee_reward',private.referral_reward_label(p.referee_reward_type,p.referee_reward_value),'minimum_order_pence',p.minimum_qualifying_order_pence,'qualifying_order_count',p.qualifying_order_count,'reward_delay_hours',p.reward_delay_hours,'ends_at',p.ends_at,'terms_text',p.terms_text) into result from public.customer_referral_codes c join public.restaurant_referral_programs p on p.id=c.program_id join public.restaurants r on r.id=p.restaurant_id where upper(c.code)=upper(trim(p_code)) and c.is_active and p.is_enabled and not p.disabled_by_platform and (p.starts_at is null or p.starts_at<=now()) and (p.ends_at is null or p.ends_at>now()) limit 1;
  return coalesce(result,jsonb_build_object('valid',false));
end$$;

create or replace function public.create_referral_attribution(p_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.customer_referral_codes%rowtype; p public.restaurant_referral_programs%rowtype; t public.referral_attribution_tokens%rowtype; r public.restaurants%rowtype;
begin
  select * into c from public.customer_referral_codes where upper(code)=upper(trim(p_code)) and is_active limit 1;
  if not found then return jsonb_build_object('valid',false,'error','Referral link is invalid.'); end if;
  select * into p from public.restaurant_referral_programs where id=c.program_id and is_enabled and not disabled_by_platform and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>now());
  if not found then return jsonb_build_object('valid',false,'error','Referral programme is not currently available.'); end if;
  if (select count(*) from public.referral_attribution_tokens x where x.referral_code_id=c.id and x.created_at>=now()-interval '1 hour')>=200 then raise exception 'Referral link traffic limit reached. Please try again later.'; end if;
  insert into public.referral_attribution_tokens(program_id,referral_code_id) values(p.id,c.id) returning * into t;
  update public.customer_referral_codes set share_count=share_count+1 where id=c.id;
  select * into r from public.restaurants where id=p.restaurant_id;
  return jsonb_build_object('valid',true,'token',t.id,'expires_at',t.expires_at,'restaurant_id',r.id,'restaurant_name',r.name,'restaurant_slug',r.slug,'referee_reward',private.referral_reward_label(p.referee_reward_type,p.referee_reward_value));
end$$;
