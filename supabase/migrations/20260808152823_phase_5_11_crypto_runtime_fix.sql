create or replace function private.validate_restaurant_group_api_key(p_raw_key text,p_required_scope text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_group uuid;
begin
 update public.restaurant_group_api_keys
 set last_used_at=now()
 where key_hash=encode(extensions.digest(p_raw_key,'sha256'),'hex')
   and status='active'
   and (expires_at is null or expires_at>now())
   and (p_required_scope is null or p_required_scope=any(scopes))
 returning group_id into v_group;
 return v_group;
end $$;

create or replace function public.create_restaurant_group_api_key(p_group_id uuid,p_name text,p_scopes text[] default array['analytics:read']::text[],p_expires_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_raw text;v_hash text;v_id uuid;v_prefix text;
begin
 if not private.restaurant_group_member_permission(p_group_id,'enterprise:manage') then raise exception 'Enterprise management permission required' using errcode='42501'; end if;
 if not coalesce((select api_enabled from public.restaurant_group_enterprise_settings where group_id=p_group_id),false) then raise exception 'Corporate API access is disabled'; end if;
 v_raw:='of_ent_'||encode(extensions.gen_random_bytes(28),'hex');
 v_prefix:=left(v_raw,14);
 v_hash:=encode(extensions.digest(v_raw,'sha256'),'hex');
 insert into public.restaurant_group_api_keys(group_id,name,key_prefix,key_hash,scopes,expires_at,created_by)
 values(p_group_id,btrim(p_name),v_prefix,v_hash,coalesce(p_scopes,array[]::text[]),p_expires_at,auth.uid()) returning id into v_id;
 perform private.restaurant_group_log(p_group_id,'api_key.created','api_key',v_id,null,jsonb_build_object('name',p_name,'prefix',v_prefix,'scopes',p_scopes));
 return jsonb_build_object('id',v_id,'api_key',v_raw,'prefix',v_prefix,'scopes',p_scopes,'expires_at',p_expires_at);
end $$;

create or replace function public.resolve_restaurant_group_api_key(p_raw_key text,p_required_scope text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare k public.restaurant_group_api_keys%rowtype; g public.restaurant_groups%rowtype;
begin
 if auth.role()<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 select * into k from public.restaurant_group_api_keys
 where key_hash=encode(extensions.digest(p_raw_key,'sha256'),'hex')
   and status='active' and (expires_at is null or expires_at>now())
   and (p_required_scope is null or p_required_scope=any(scopes))
 for update;
 if not found then return null; end if;
 select * into g from public.restaurant_groups where id=k.group_id and status='active';
 if not found then return null; end if;
 update public.restaurant_group_api_keys set last_used_at=now() where id=k.id;
 return jsonb_build_object('key_id',k.id,'group_id',k.group_id,'group_name',g.name,'scopes',k.scopes,'expires_at',k.expires_at);
end $$;
revoke all on function public.resolve_restaurant_group_api_key(text,text) from public,anon,authenticated;
grant execute on function public.resolve_restaurant_group_api_key(text,text) to service_role;

create or replace function public.redeem_loyalty_reward(p_reward_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); r public.restaurant_loyalty_rewards%rowtype; v public.customer_reward_vouchers%rowtype; a record; points integer:=0; remaining integer; take_points integer; c integer; v_code text;
begin
 if uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into r from public.restaurant_loyalty_rewards where id=p_reward_id and is_active and starts_at<=now() and (ends_at is null or ends_at>now()) for update;
 if not found then raise exception 'Reward is not currently available'; end if;
 if r.total_redemption_limit is not null and r.redemption_count>=r.total_redemption_limit then raise exception 'Reward redemption limit has been reached'; end if;
 if r.stock_remaining is not null and r.stock_remaining<=0 then raise exception 'Reward is out of stock'; end if;
 select coalesce(sum(x.points_balance),0) into points from public.customer_loyalty_accounts x where x.customer_user_id=uid and x.restaurant_id in(select s.restaurant_id from private.restaurant_group_feature_restaurants(r.restaurant_id,'loyalty') s);
 if points<r.points_cost then raise exception 'You do not have enough points'; end if;
 if r.per_customer_limit is not null then select count(*) into c from public.customer_reward_vouchers where reward_id=r.id and customer_user_id=uid and status<>'cancelled'; if c>=r.per_customer_limit then raise exception 'You have reached the redemption limit for this reward'; end if; end if;
 remaining:=r.points_cost;
 for a in select x.* from public.customer_loyalty_accounts x where x.customer_user_id=uid and x.restaurant_id in(select s.restaurant_id from private.restaurant_group_feature_restaurants(r.restaurant_id,'loyalty') s) and x.points_balance>0 order by (x.restaurant_id=r.restaurant_id) desc,x.updated_at for update loop
  exit when remaining<=0;
  take_points:=least(remaining,a.points_balance);
  update public.customer_loyalty_accounts set points_balance=points_balance-take_points,lifetime_points_redeemed=lifetime_points_redeemed+take_points,last_redeemed_at=now(),updated_at=now() where id=a.id;
  insert into public.customer_loyalty_ledger(loyalty_account_id,restaurant_id,customer_user_id,points_delta,entry_type,note) values(a.id,a.restaurant_id,uid,-take_points,'reward_redeemed','Shared loyalty redemption for '||r.name);
  remaining:=remaining-take_points;
 end loop;
 loop
   v_code:='RW-'||upper(substr(encode(extensions.gen_random_bytes(10),'hex'),1,14));
   exit when not exists(select 1 from public.customer_reward_vouchers cv where cv.customer_user_id=uid and cv.code=v_code);
 end loop;
 insert into public.customer_reward_vouchers(reward_id,restaurant_id,customer_user_id,code,points_spent,expires_at) values(r.id,r.restaurant_id,uid,v_code,r.points_cost,coalesce(r.ends_at,now()+interval '90 days')) returning * into v;
 update public.restaurant_loyalty_rewards set redemption_count=redemption_count+1,stock_remaining=case when stock_remaining is null then null else greatest(stock_remaining-1,0) end,updated_at=now() where id=r.id;
 return jsonb_build_object('voucher_id',v.id,'code',v.code,'expires_at',v.expires_at,'points_spent',r.points_cost,'shared_points_balance',points-r.points_cost);
end $$;
revoke execute on function public.redeem_loyalty_reward(uuid) from public,anon;
grant execute on function public.redeem_loyalty_reward(uuid) to authenticated;
