alter table public.orders add column if not exists vip_tier_id uuid references public.restaurant_vip_tiers(id) on delete set null;
alter table public.orders add column if not exists vip_discount_pence integer not null default 0 check (vip_discount_pence>=0);
alter table public.orders add column if not exists vip_delivery_discount_pence integer not null default 0 check (vip_delivery_discount_pence>=0);
alter table public.orders add column if not exists vip_menu_item_discount_pence integer not null default 0 check (vip_menu_item_discount_pence>=0);
alter table public.orders add column if not exists vip_benefits_snapshot jsonb not null default '[]'::jsonb;
create index if not exists orders_vip_tier_completed_idx on public.orders(restaurant_id,vip_tier_id,completed_at desc) where vip_tier_id is not null and order_status='completed';

alter table public.customer_loyalty_ledger add column if not exists vip_benefit_event_id uuid references public.customer_vip_benefit_events(id) on delete set null;
create unique index if not exists customer_loyalty_ledger_vip_event_unique on public.customer_loyalty_ledger(vip_benefit_event_id) where vip_benefit_event_id is not null;
alter table public.referral_rewards add column if not exists base_reward_value integer;
alter table public.referral_rewards add column if not exists vip_multiplier_basis_points integer not null default 10000 check (vip_multiplier_basis_points between 10000 and 100000);

create or replace function private.calculate_customer_vip_metrics(p_restaurant_id uuid,p_customer_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.restaurant_vip_programs%rowtype; cutoff timestamptz; spend bigint:=0; orders_count bigint:=0; points bigint:=0; stamps bigint:=0; referrals bigint:=0; custom jsonb:='{}'::jsonb;
begin
  select * into p from public.restaurant_vip_programs where restaurant_id=p_restaurant_id;
  if not found then return jsonb_build_object('lifetime_spend_pence',0,'orders_completed',0,'loyalty_points',0,'stamp_cards_completed',0,'referral_count',0,'custom_metrics','{}'::jsonb); end if;
  if p.qualification_window='rolling' then cutoff:=now()-make_interval(days=>p.rolling_days); end if;
  select count(*),coalesce(sum(o.total_pence+o.customer_credit_used_pence+o.gift_card_used_pence+o.reward_discount_pence+o.vip_discount_pence),0)
    into orders_count,spend from public.orders o where o.restaurant_id=p_restaurant_id and o.customer_user_id=p_customer_user_id and o.order_status='completed' and o.payment_status in ('paid','partially_refunded') and (cutoff is null or coalesce(o.completed_at,o.updated_at)>=cutoff);
  if cutoff is null then select coalesce((select a.lifetime_points_earned from public.customer_loyalty_accounts a where a.restaurant_id=p_restaurant_id and a.customer_user_id=p_customer_user_id),0) into points; select coalesce(sum(c.completed_cycles),0) into stamps from public.customer_stamp_cards c where c.restaurant_id=p_restaurant_id and c.customer_user_id=p_customer_user_id;
  else select coalesce(sum(greatest(l.points_delta,0)),0) into points from public.customer_loyalty_ledger l where l.restaurant_id=p_restaurant_id and l.customer_user_id=p_customer_user_id and l.created_at>=cutoff; select count(*) into stamps from public.customer_stamp_events e where e.restaurant_id=p_restaurant_id and e.customer_user_id=p_customer_user_id and e.event_type='completion' and e.created_at>=cutoff; end if;
  select count(*) into referrals from public.customer_referrals r where r.restaurant_id=p_restaurant_id and r.referrer_user_id=p_customer_user_id and r.status in ('qualified','rewarded') and (cutoff is null or coalesce(r.qualified_at,r.updated_at)>=cutoff);
  select coalesce(jsonb_object_agg(m.metric_key,m.metric_value),'{}'::jsonb) into custom from public.customer_vip_custom_metrics m where m.restaurant_id=p_restaurant_id and m.customer_user_id=p_customer_user_id;
  return jsonb_build_object('lifetime_spend_pence',coalesce(spend,0),'orders_completed',coalesce(orders_count,0),'loyalty_points',coalesce(points,0),'stamp_cards_completed',coalesce(stamps,0),'referral_count',coalesce(referrals,0),'custom_metrics',custom,'qualification_window',p.qualification_window,'rolling_days',case when p.qualification_window='rolling' then p.rolling_days else null end);
end $$;

create or replace function private.get_vip_order_benefits(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders%rowtype; m public.customer_vip_memberships%rowtype; t public.restaurant_vip_tiers%rowtype; b record; pct integer:=0; fixed integer:=0; delivery integer:=0; item_discount integer:=0; candidate integer:=0; discount integer:=0; benefits jsonb:='[]'::jsonb;
begin
  select * into o from public.orders where id=p_order_id;
  if not found or o.customer_user_id is null then return jsonb_build_object('tier_id',null,'discount_pence',0,'delivery_discount_pence',0,'menu_item_discount_pence',0,'benefits','[]'::jsonb); end if;
  perform private.evaluate_customer_vip_tier(o.restaurant_id,o.customer_user_id,'checkout','system',null);
  select * into m from public.customer_vip_memberships where restaurant_id=o.restaurant_id and customer_user_id=o.customer_user_id;
  if m.current_tier_id is null then return jsonb_build_object('tier_id',null,'discount_pence',0,'delivery_discount_pence',0,'menu_item_discount_pence',0,'benefits','[]'::jsonb); end if;
  select * into t from public.restaurant_vip_tiers where id=m.current_tier_id and is_active and archived_at is null;
  if not found then return jsonb_build_object('tier_id',null,'discount_pence',0,'delivery_discount_pence',0,'menu_item_discount_pence',0,'benefits','[]'::jsonb); end if;
  for b in select * from public.restaurant_vip_tier_benefits where tier_id=t.id and is_active loop
    benefits:=benefits||jsonb_build_array(jsonb_build_object('id',b.id,'type',b.benefit_type,'value',b.value,'menu_item_id',b.menu_item_id));
    if b.benefit_type='percentage_discount' then pct:=greatest(pct,coalesce(b.value,0));
    elsif b.benefit_type='fixed_discount' then fixed:=greatest(fixed,coalesce(b.value,0));
    elsif b.benefit_type='free_delivery' and o.fulfilment_method='delivery' then delivery:=o.delivery_fee_pence;
    elsif b.benefit_type='free_menu_item' then select coalesce(max(least(oi.unit_price_pence,mi.price_pence)),0) into candidate from public.order_items oi join public.menu_items mi on mi.id=oi.menu_item_id where oi.order_id=o.id and oi.menu_item_id=b.menu_item_id; item_discount:=item_discount+candidate; end if;
  end loop;
  discount:=least(o.subtotal_pence+o.delivery_fee_pence,greatest(round(o.subtotal_pence*pct/10000.0)::integer,fixed)+delivery+item_discount);
  return jsonb_build_object('tier_id',t.id,'tier_name',t.name,'tier_colour',t.colour,'tier_icon',t.icon,'discount_pence',discount,'delivery_discount_pence',delivery,'menu_item_discount_pence',item_discount,'benefits',benefits);
end $$;

create or replace function public.get_customer_vip_checkout_preview(p_restaurant_id uuid,p_subtotal_pence integer,p_delivery_fee_pence integer,p_fulfilment_method text,p_menu_item_ids uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); m public.customer_vip_memberships%rowtype; t public.restaurant_vip_tiers%rowtype; b record; pct integer:=0; fixed integer:=0; delivery integer:=0; item_discount integer:=0; base_price integer; benefits jsonb:='[]'::jsonb;
begin
  if uid is null then return jsonb_build_object('eligible',false,'discount_pence',0); end if;
  perform private.evaluate_customer_vip_tier(p_restaurant_id,uid,'checkout_preview','system',null);
  select * into m from public.customer_vip_memberships where restaurant_id=p_restaurant_id and customer_user_id=uid;
  select * into t from public.restaurant_vip_tiers where id=m.current_tier_id and is_active and archived_at is null;
  if not found then return jsonb_build_object('eligible',false,'discount_pence',0); end if;
  for b in select * from public.restaurant_vip_tier_benefits where tier_id=t.id and is_active loop
    benefits:=benefits||jsonb_build_array(jsonb_build_object('type',b.benefit_type,'value',b.value));
    if b.benefit_type='percentage_discount' then pct:=greatest(pct,coalesce(b.value,0)); elsif b.benefit_type='fixed_discount' then fixed:=greatest(fixed,coalesce(b.value,0)); elsif b.benefit_type='free_delivery' and p_fulfilment_method='delivery' then delivery:=greatest(p_delivery_fee_pence,0); elsif b.benefit_type='free_menu_item' and b.menu_item_id=any(coalesce(p_menu_item_ids,'{}')) then select price_pence into base_price from public.menu_items where id=b.menu_item_id and restaurant_id=p_restaurant_id; item_discount:=item_discount+coalesce(base_price,0); end if;
  end loop;
  return jsonb_build_object('eligible',true,'tier_id',t.id,'tier_name',t.name,'tier_colour',t.colour,'tier_icon',t.icon,'discount_pence',least(greatest(p_subtotal_pence,0)+greatest(p_delivery_fee_pence,0),greatest(round(greatest(p_subtotal_pence,0)*pct/10000.0)::integer,fixed)+delivery+item_discount),'delivery_discount_pence',delivery,'menu_item_discount_pence',item_discount,'benefits',benefits);
end $$;
revoke all on function public.get_customer_vip_checkout_preview(uuid,integer,integer,text,uuid[]) from public,anon;
grant execute on function public.get_customer_vip_checkout_preview(uuid,integer,integer,text,uuid[]) to authenticated,service_role;

create or replace function public.create_order_with_promotion(storefront_slug text,fulfilment_method text,customer_first_name text,customer_last_name text,customer_email text,customer_phone text,basket_items jsonb,address_line_1 text default null,address_line_2 text default null,town_city text default null,postcode text default null,delivery_instructions text default null,requested_fulfilment_at timestamptz default null,promotion_code text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare created jsonb; order_row public.orders%rowtype; validation jsonb; promotion_discount integer:=0; vip jsonb; vip_discount integer:=0; combined integer:=0; restaurant_gross integer; commission integer; commission_vat integer;
begin
  created:=public.create_order(storefront_slug,fulfilment_method,customer_first_name,customer_last_name,customer_email,customer_phone,basket_items,address_line_1,address_line_2,town_city,postcode,delivery_instructions,requested_fulfilment_at);
  select * into order_row from public.orders where id=(created->>'order_id')::uuid for update;
  vip:=private.get_vip_order_benefits(order_row.id); vip_discount:=greatest(coalesce((vip->>'discount_pence')::integer,0),0);
  if nullif(trim(promotion_code),'') is not null then validation:=public.validate_restaurant_promotion(order_row.restaurant_id,promotion_code,order_row.subtotal_pence,order_row.delivery_fee_pence,order_row.fulfilment_method,order_row.customer_email); if not coalesce((validation->>'valid')::boolean,false) then raise exception '%',coalesce(validation->>'error','Promotion code could not be applied.'); end if; promotion_discount:=greatest(coalesce((validation->>'discount_pence')::integer,0),0); end if;
  combined:=least(order_row.subtotal_pence+order_row.delivery_fee_pence,promotion_discount+vip_discount);
  restaurant_gross:=greatest(order_row.subtotal_pence+order_row.delivery_fee_pence-combined,0);
  commission:=round(restaurant_gross*order_row.platform_commission_basis_points/10000.0);
  commission_vat:=case when order_row.platform_commission_pence>0 then round(commission*order_row.platform_commission_vat_pence/order_row.platform_commission_pence::numeric) else 0 end;
  update public.orders set promotion_id=case when validation is null then null else (validation->>'promotion_id')::uuid end,promotion_code=case when validation is null then null else validation->>'code' end,discount_pence=combined,vip_tier_id=case when nullif(vip->>'tier_id','') is null then null else (vip->>'tier_id')::uuid end,vip_discount_pence=vip_discount,vip_delivery_discount_pence=coalesce((vip->>'delivery_discount_pence')::integer,0),vip_menu_item_discount_pence=coalesce((vip->>'menu_item_discount_pence')::integer,0),vip_benefits_snapshot=coalesce(vip->'benefits','[]'::jsonb),total_pence=greatest(subtotal_pence+delivery_fee_pence+service_fee_pence-combined,0),platform_commission_pence=commission,platform_commission_vat_pence=commission_vat,restaurant_net_pence=greatest(restaurant_gross-commission-commission_vat,0) where id=order_row.id returning * into order_row;
  insert into public.customer_vip_benefit_events(restaurant_id,customer_user_id,tier_id,benefit_id,order_id,event_type,amount,source_key,details)
  select order_row.restaurant_id,order_row.customer_user_id,order_row.vip_tier_id,(x->>'id')::uuid,order_row.id,'applied',case when x->>'type' in ('percentage_discount','fixed_discount','free_delivery','free_menu_item') then vip_discount else 0 end,'order:'||order_row.id::text||':benefit:'||(x->>'id'),jsonb_build_object('benefit_type',x->>'type','order_vip_discount_pence',vip_discount) from jsonb_array_elements(coalesce(vip->'benefits','[]'::jsonb)) x where order_row.customer_user_id is not null and x ? 'id' and x->>'type' in ('percentage_discount','fixed_discount','free_delivery','free_menu_item') on conflict do nothing;
  return created||jsonb_build_object('discount_pence',order_row.discount_pence,'promotion_code',order_row.promotion_code,'vip_tier_id',order_row.vip_tier_id,'vip_tier_name',vip->>'tier_name','vip_discount_pence',vip_discount,'vip_delivery_discount_pence',order_row.vip_delivery_discount_pence,'vip_menu_item_discount_pence',order_row.vip_menu_item_discount_pence,'vip_benefits',order_row.vip_benefits_snapshot,'total_pence',order_row.total_pence,'restaurant_net_pence',order_row.restaurant_net_pence);
end $$;

create or replace function private.process_completed_order_vip()
returns trigger language plpgsql security definer set search_path='' as $$
declare b record; e_id uuid; acct public.customer_loyalty_accounts%rowtype; program_id uuid; evaluation jsonb;
begin
  if new.order_status='completed' and old.order_status is distinct from 'completed' and new.customer_user_id is not null then
    if new.vip_tier_id is not null then
      for b in select * from public.restaurant_vip_tier_benefits where tier_id=new.vip_tier_id and is_active and benefit_type in ('bonus_loyalty_points','bonus_stamps') loop
        insert into public.customer_vip_benefit_events(restaurant_id,customer_user_id,tier_id,benefit_id,order_id,event_type,amount,source_key,details) values(new.restaurant_id,new.customer_user_id,new.vip_tier_id,b.id,new.id,'earned',coalesce(b.value,0),'order:'||new.id::text||':benefit:'||b.id::text||':earned',jsonb_build_object('benefit_type',b.benefit_type)) on conflict do nothing returning id into e_id;
        if e_id is null then continue; end if;
        if b.benefit_type='bonus_loyalty_points' and coalesce(b.value,0)>0 then
          insert into public.customer_loyalty_accounts(restaurant_id,customer_user_id,points_balance,lifetime_points_earned,lifetime_points_redeemed) values(new.restaurant_id,new.customer_user_id,0,0,0) on conflict(restaurant_id,customer_user_id) do nothing;
          select * into acct from public.customer_loyalty_accounts where restaurant_id=new.restaurant_id and customer_user_id=new.customer_user_id for update;
          insert into public.customer_loyalty_ledger(loyalty_account_id,restaurant_id,customer_user_id,order_id,points_delta,entry_type,note,vip_benefit_event_id) values(acct.id,new.restaurant_id,new.customer_user_id,new.id,b.value,'vip_bonus','VIP tier order bonus',e_id);
          update public.customer_loyalty_accounts set points_balance=points_balance+b.value,lifetime_points_earned=lifetime_points_earned+b.value,updated_at=now() where id=acct.id;
        elsif b.benefit_type='bonus_stamps' and coalesce(b.value,0)>0 then
          program_id:=case when nullif(b.metadata->>'program_id','') is null then null else (b.metadata->>'program_id')::uuid end;
          if program_id is not null and exists(select 1 from public.restaurant_stamp_programs sp where sp.id=program_id and sp.restaurant_id=new.restaurant_id and sp.is_active) then perform public.add_customer_stamp_progress(program_id,new.customer_user_id,b.value,'vip_bonus','VIP tier order bonus',null); end if;
        end if;
      end loop;
    end if;
    evaluation:=private.evaluate_customer_vip_tier(new.restaurant_id,new.customer_user_id,'completed_order','system',null);
  end if;
  return new;
end $$;
drop trigger if exists orders_vip_completed_trigger on public.orders;
create trigger orders_vip_completed_trigger after update of order_status on public.orders for each row execute function private.process_completed_order_vip();

create or replace function private.vip_apply_referral_multiplier(p_reward_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare rw public.referral_rewards%rowtype; mult integer:=10000;
begin
  select * into rw from public.referral_rewards where id=p_reward_id for update;
  if not found or rw.status<>'pending' or rw.recipient_role<>'referrer' or rw.vip_multiplier_basis_points<>10000 then return; end if;
  mult:=private.get_customer_vip_multiplier(rw.restaurant_id,rw.customer_user_id,'referral_multiplier');
  if mult>10000 then update public.referral_rewards set base_reward_value=reward_value,reward_value=round(reward_value*mult/10000.0),vip_multiplier_basis_points=mult,updated_at=now() where id=rw.id; end if;
end $$;
create or replace function public.process_due_referral_rewards(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rid uuid; processed integer:=0;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  for rid in select id from public.referral_rewards where status='pending' and available_at<=now() order by available_at limit greatest(1,least(coalesce(p_limit,100),500)) for update skip locked loop perform private.vip_apply_referral_multiplier(rid); perform private.issue_referral_reward(rid); processed:=processed+1; end loop;
  return jsonb_build_object('processed',processed);
end $$;

create or replace function public.get_checkout_reward_vouchers(p_restaurant_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid(); result jsonb; begin if uid is null then raise exception 'Authentication required' using errcode='42501'; end if; select coalesce(jsonb_agg(jsonb_build_object('voucher_id',v.id,'code',v.code,'reward_name',r.name,'reward_type',r.reward_type,'fixed_value_pence',coalesce(v.override_fixed_value_pence,r.fixed_value_pence),'percentage_basis_points',coalesce(v.override_percentage_basis_points,r.percentage_basis_points),'menu_item_id',r.menu_item_id,'minimum_order_pence',r.minimum_order_pence,'expires_at',v.expires_at,'benefit_source_type',v.benefit_source_type) order by v.created_at desc),'[]'::jsonb) into result from public.customer_reward_vouchers v join public.restaurant_loyalty_rewards r on r.id=v.reward_id where v.customer_user_id=uid and v.restaurant_id=p_restaurant_id and (v.status='available' or (v.status='reserved' and v.reservation_expires_at<=now())) and (v.expires_at is null or v.expires_at>now()); return result; end $$;

create or replace function public.reserve_order_reward_voucher(p_order_id uuid,p_voucher_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); o public.orders%rowtype; v public.customer_reward_vouchers%rowtype; r public.restaurant_loyalty_rewards%rowtype; discount integer:=0; item_discount integer:=0; fixed_value integer; pct integer;
begin
 if uid is null then raise exception 'Authentication required' using errcode='42501'; end if; select * into o from public.orders where id=p_order_id and customer_user_id=uid for update; if not found then raise exception 'Order not found' using errcode='42501'; end if; if o.order_status<>'pending_payment' then raise exception 'Order is no longer awaiting payment'; end if; if o.reward_voucher_id is not null then raise exception 'A reward is already applied to this order'; end if;
 select * into v from public.customer_reward_vouchers where id=p_voucher_id and customer_user_id=uid and restaurant_id=o.restaurant_id for update; if not found then raise exception 'Reward voucher not found'; end if; if v.expires_at is not null and v.expires_at<=now() then update public.customer_reward_vouchers set status='expired' where id=v.id; raise exception 'Reward voucher has expired'; end if; if v.status='reserved' and v.reservation_expires_at>now() then raise exception 'Reward voucher is already reserved'; end if; if v.status not in('available','reserved') then raise exception 'Reward voucher is not available'; end if;
 select * into r from public.restaurant_loyalty_rewards where id=v.reward_id; if not found then raise exception 'Reward is no longer available'; end if; if not(o.fulfilment_method=any(r.fulfilment_methods)) then raise exception 'This reward is not valid for this fulfilment method'; end if; if o.subtotal_pence<r.minimum_order_pence then raise exception 'Minimum order value has not been reached'; end if;
 fixed_value:=coalesce(v.override_fixed_value_pence,r.fixed_value_pence,0); pct:=coalesce(v.override_percentage_basis_points,r.percentage_basis_points,0);
 discount:=case r.reward_type when 'fixed_discount' then least(fixed_value,o.total_pence) when 'percentage_discount' then least(round(o.subtotal_pence*pct/10000.0)::integer,o.total_pence) when 'free_delivery' then least(o.delivery_fee_pence,o.total_pence) when 'wallet_credit' then least(fixed_value,o.total_pence) else 0 end;
 if r.reward_type='free_item' then select coalesce(max(unit_price_pence),0) into item_discount from public.order_items where order_id=o.id and menu_item_id=r.menu_item_id; if item_discount<=0 then raise exception 'The required reward item is not in this order'; end if; discount:=least(item_discount,o.total_pence); end if; if discount<=0 then raise exception 'This reward does not reduce the current order total'; end if;
 update public.customer_reward_vouchers set status='reserved',reserved_order_id=o.id,reserved_at=now(),reservation_expires_at=now()+interval '35 minutes' where id=v.id; update public.orders set reward_voucher_id=v.id,reward_discount_pence=discount,discount_pence=discount_pence+discount,total_pence=greatest(total_pence-discount,0),restaurant_net_pence=greatest(restaurant_net_pence-discount,0),updated_at=now() where id=o.id;
 return jsonb_build_object('voucher_id',v.id,'reward_name',r.name,'discount_pence',discount,'total_pence',greatest(o.total_pence-discount,0),'reservation_expires_at',now()+interval '35 minutes');
end $$;
