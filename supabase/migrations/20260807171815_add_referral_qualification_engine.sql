create or replace function private.evaluate_referral(p_referral_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare ref public.customer_referrals%rowtype; p public.restaurant_referral_programs%rowtype; qcount integer; revenue integer; first_order uuid; oldstatus text; available timestamptz; rw_id uuid;
begin
  select * into ref from public.customer_referrals where id=p_referral_id for update;
  if not found or ref.status='rejected' or ref.referred_user_id is null then return; end if;
  select * into p from public.restaurant_referral_programs where id=ref.program_id;
  select count(*),coalesce(sum(o.total_pence+o.customer_credit_used_pence+o.gift_card_used_pence+coalesce(o.reward_discount_pence,0)),0),(array_agg(o.id order by o.created_at,o.id))[1] into qcount,revenue,first_order
  from public.orders o where o.restaurant_id=ref.restaurant_id and o.customer_user_id=ref.referred_user_id and o.payment_status='paid' and o.order_status='completed' and o.created_at>=coalesce(ref.registered_at,ref.created_at) and o.subtotal_pence>=p.minimum_qualifying_order_pence;
  update public.customer_referrals set qualifying_order_count=qcount,qualifying_revenue_pence=revenue,qualifying_order_id=case when qcount>0 then coalesce(qualifying_order_id,first_order) else null end,ordered_at=case when qcount>0 then coalesce(ordered_at,now()) else ordered_at end,updated_at=now() where id=ref.id;
  if qcount>0 and ref.status='registered' then update public.customer_referrals set status='ordered',ordered_at=coalesce(ordered_at,now()),updated_at=now() where id=ref.id; insert into public.referral_events(referral_id,restaurant_id,event_type,old_status,new_status,order_id,actor_kind) values(ref.id,ref.restaurant_id,'ordered','registered','ordered',first_order,'system'); ref.status:='ordered'; end if;
  if qcount>=p.qualifying_order_count and ref.status in ('registered','ordered') then
    oldstatus:=ref.status; available:=now()+make_interval(hours=>p.reward_delay_hours);
    update public.customer_referrals set status='qualified',qualified_at=now(),reward_available_at=available,updated_at=now() where id=ref.id;
    insert into public.referral_events(referral_id,restaurant_id,event_type,old_status,new_status,order_id,actor_kind,metadata) values(ref.id,ref.restaurant_id,'qualified',oldstatus,'qualified',first_order,'system',jsonb_build_object('qualifying_orders',qcount,'qualifying_revenue_pence',revenue));
    insert into public.referral_rewards(referral_id,restaurant_id,customer_user_id,recipient_role,reward_type,reward_value,status,available_at) values(ref.id,ref.restaurant_id,ref.referrer_user_id,'referrer',p.referrer_reward_type,p.referrer_reward_value,'pending',available) on conflict(referral_id,recipient_role) do nothing returning id into rw_id;
    perform private.queue_referral_notification(ref.id,rw_id,ref.referrer_user_id,ref.restaurant_id,'friend_qualified','Your friend qualified','Your referral has qualified. '||private.referral_reward_label(p.referrer_reward_type,p.referrer_reward_value)||case when p.reward_delay_hours>0 then ' will become available after the pending period.' else ' is being added to your account.' end);
    rw_id:=null;
    insert into public.referral_rewards(referral_id,restaurant_id,customer_user_id,recipient_role,reward_type,reward_value,status,available_at) values(ref.id,ref.restaurant_id,ref.referred_user_id,'referee',p.referee_reward_type,p.referee_reward_value,'pending',available) on conflict(referral_id,recipient_role) do nothing returning id into rw_id;
    perform private.queue_referral_notification(ref.id,rw_id,ref.referred_user_id,ref.restaurant_id,'reward_earned','Referral reward earned','You earned '||private.referral_reward_label(p.referee_reward_type,p.referee_reward_value)||case when p.reward_delay_hours>0 then '. It will become available after the pending period.' else '.' end);
    if p.reward_delay_hours=0 then for rw_id in select id from public.referral_rewards where referral_id=ref.id and status='pending' loop perform private.issue_referral_reward(rw_id); end loop; end if;
    if exists(select 1 from public.orders ro join public.orders fo on fo.id=first_order where ro.restaurant_id=ref.restaurant_id and ro.customer_user_id=ref.referrer_user_id and ro.payment_status='paid' and upper(regexp_replace(coalesce(ro.postcode,''),'[^A-Z0-9]','','g'))=upper(regexp_replace(coalesce(fo.postcode,''),'[^A-Z0-9]','','g')) and lower(regexp_replace(coalesce(ro.address_line_1,''),'[^a-z0-9]','','g'))=lower(regexp_replace(coalesce(fo.address_line_1,''),'[^a-z0-9]','','g')) and coalesce(fo.postcode,'')<>'' and coalesce(fo.address_line_1,'')<>'') then insert into public.referral_fraud_flags(referral_id,restaurant_id,flag_type,severity,details) values(ref.id,ref.restaurant_id,'shared_delivery_address','medium',jsonb_build_object('qualifying_order_id',first_order)); end if;
    if exists(select 1 from public.orders ro join public.orders fo on fo.id=first_order where ro.restaurant_id=ref.restaurant_id and ro.customer_user_id=ref.referrer_user_id and ro.payment_status='paid' and regexp_replace(coalesce(ro.customer_phone,''),'[^0-9]','','g')=regexp_replace(coalesce(fo.customer_phone,''),'[^0-9]','','g') and length(regexp_replace(coalesce(fo.customer_phone,''),'[^0-9]','','g'))>=7) then insert into public.referral_fraud_flags(referral_id,restaurant_id,flag_type,severity,details) values(ref.id,ref.restaurant_id,'shared_contact_pattern','high',jsonb_build_object('signal','phone')); end if;
  elsif qcount<p.qualifying_order_count and ref.status in ('qualified','rewarded') then
    perform private.reverse_referral_rewards(ref.id,'Qualifying order was refunded or cancelled');
    update public.customer_referrals set status='rejected',rejected_at=now(),rejection_reason='qualification_reversed',updated_at=now() where id=ref.id;
    insert into public.referral_events(referral_id,restaurant_id,event_type,old_status,new_status,actor_kind,metadata) values(ref.id,ref.restaurant_id,'qualification_reversed',ref.status,'rejected','system',jsonb_build_object('qualifying_orders_remaining',qcount));
    perform private.queue_referral_notification(ref.id,null,ref.referrer_user_id,ref.restaurant_id,'referral_rejected','Referral reward reversed','The qualifying order was refunded or cancelled, so this referral no longer qualifies.');
  end if;
end$$;

create or replace function private.process_order_referral_status() returns trigger language plpgsql security definer set search_path='' as $$
declare refid uuid;
begin
  if new.customer_user_id is null then return new; end if;
  select id into refid from public.customer_referrals where restaurant_id=new.restaurant_id and referred_user_id=new.customer_user_id and status<>'rejected' order by created_at desc limit 1;
  if refid is not null then update public.orders set referral_id=refid where id=new.id and referral_id is null; perform private.evaluate_referral(refid); end if;
  return new;
end$$;
drop trigger if exists orders_referral_status_trigger on public.orders;
create trigger orders_referral_status_trigger after insert or update of payment_status,order_status on public.orders for each row execute function private.process_order_referral_status();

create or replace function public.process_due_referral_rewards(p_limit integer default 100) returns jsonb language plpgsql security definer set search_path='' as $$
declare rid uuid; processed integer:=0;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  for rid in select id from public.referral_rewards where status='pending' and available_at<=now() order by available_at limit greatest(1,least(coalesce(p_limit,100),500)) for update skip locked loop perform private.issue_referral_reward(rid); processed:=processed+1; end loop;
  return jsonb_build_object('processed',processed);
end$$;
