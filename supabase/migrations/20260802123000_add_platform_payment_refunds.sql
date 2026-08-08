begin;

alter table public.orders add column if not exists refunded_pence integer not null default 0 check(refunded_pence>=0 and refunded_pence<=total_pence);
alter table public.orders add column if not exists last_refunded_at timestamptz;

create table public.platform_refunds(
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete restrict,
 amount_pence integer not null check(amount_pence>0), reason text not null check(length(trim(reason)) between 3 and 500),
 status text not null default 'processing' check(status in('processing','succeeded','failed')),
 stripe_refund_id text unique, failure_message text, requested_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(), completed_at timestamptz
);
create index platform_refunds_order_created_idx on public.platform_refunds(order_id,created_at desc);
create index platform_refunds_processing_idx on public.platform_refunds(created_at) where status='processing';
alter table public.platform_refunds enable row level security;
revoke all on public.platform_refunds from public,anon,authenticated;

create or replace function public.reserve_platform_refund(p_order_id uuid,p_amount_pence integer,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare o public.orders%rowtype; reserved integer; rid uuid;
begin
 if not private.has_platform_admin_permission('finance:manage') then raise exception 'You do not have permission to issue refunds' using errcode='42501'; end if;
 if p_amount_pence is null or p_amount_pence<=0 then raise exception 'Refund amount must be positive'; end if;
 if length(trim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'A refund reason between 3 and 500 characters is required'; end if;
 select * into o from public.orders where id=p_order_id for update;
 if not found then raise exception 'Order not found'; end if;
 if o.payment_status not in('paid','partially_refunded') or o.stripe_payment_intent_id is null then raise exception 'This order does not have a refundable Stripe payment'; end if;
 select coalesce(sum(amount_pence),0) into reserved from public.platform_refunds where order_id=p_order_id and status in('processing','succeeded');
 if p_amount_pence>o.total_pence-reserved then raise exception 'Refund exceeds the remaining refundable amount'; end if;
 insert into public.platform_refunds(order_id,amount_pence,reason,requested_by) values(p_order_id,p_amount_pence,trim(p_reason),auth.uid()) returning id into rid;
 insert into public.platform_admin_audit_log(actor_user_id,action,target_type,target_id,details) values(auth.uid(),'refund_requested','order',p_order_id,jsonb_build_object('refund_request_id',rid,'amount_pence',p_amount_pence,'reason',trim(p_reason)));
 return jsonb_build_object('refund_request_id',rid,'payment_intent_id',o.stripe_payment_intent_id);
end;$f$;
revoke all on function public.reserve_platform_refund(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.reserve_platform_refund(uuid,integer,text) to authenticated;

create or replace function public.complete_platform_refund(p_refund_request_id uuid,p_stripe_refund_id text,p_succeeded boolean,p_failure_message text default null)
returns void language plpgsql security definer set search_path='' as $f$
declare r public.platform_refunds%rowtype; total_refunded integer;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 select * into r from public.platform_refunds where id=p_refund_request_id for update; if not found then raise exception 'Refund request not found'; end if;
 if r.status<>'processing' then return; end if;
 update public.platform_refunds set status=case when p_succeeded then 'succeeded' else 'failed' end,stripe_refund_id=p_stripe_refund_id,failure_message=case when p_succeeded then null else left(p_failure_message,500) end,completed_at=now() where id=r.id;
 if p_succeeded then
  select coalesce(sum(amount_pence),0) into total_refunded from public.platform_refunds where order_id=r.order_id and status='succeeded';
  update public.orders set refunded_pence=least(total_refunded,total_pence),last_refunded_at=now(),payment_status=case when total_refunded>=total_pence then 'refunded' else 'partially_refunded' end where id=r.order_id;
 end if;
 insert into public.platform_admin_audit_log(actor_user_id,action,target_type,target_id,details) values(r.requested_by,case when p_succeeded then 'refund_succeeded' else 'refund_failed' end,'order',r.order_id,jsonb_build_object('refund_request_id',r.id,'stripe_refund_id',p_stripe_refund_id,'amount_pence',r.amount_pence,'failure_message',case when p_succeeded then null else left(p_failure_message,500) end));
end;$f$;
revoke all on function public.complete_platform_refund(uuid,text,boolean,text) from public,anon,authenticated;
grant execute on function public.complete_platform_refund(uuid,text,boolean,text) to service_role;

create or replace function public.get_platform_payments(p_payment_status text default null,p_search text default null,p_page integer default 1,p_page_size integer default 40)
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare result jsonb; clean text:=nullif(trim(coalesce(p_search,'')),''); pg integer:=greatest(coalesce(p_page,1),1); sz integer:=least(greatest(coalesce(p_page_size,40),1),100); can_customer boolean:=private.has_platform_admin_permission('orders:customer_details');
begin
 if not private.has_platform_admin_permission('finance:view') then raise exception 'You do not have permission to view payments' using errcode='42501'; end if;
 if p_payment_status is not null and p_payment_status not in('pending','requires_action','paid','failed','refunded','partially_refunded') then raise exception 'Unsupported payment status'; end if;
 with scoped as(select o.id,o.order_number,r.name restaurant_name,case when can_customer then o.customer_email else null end customer_email,o.total_pence,o.refunded_pence,greatest(o.total_pence-o.refunded_pence-coalesce((select sum(pr.amount_pence) from public.platform_refunds pr where pr.order_id=o.id and pr.status='processing'),0),0) refundable_pence,o.currency,o.payment_status,o.paid_at,o.created_at,o.stripe_payment_intent_id from public.orders o join public.restaurants r on r.id=o.restaurant_id where (p_payment_status is null or o.payment_status=p_payment_status) and (clean is null or o.order_number=case when clean~'^[0-9]+$' then clean::bigint else -1 end or r.name ilike '%'||clean||'%' or o.stripe_payment_intent_id ilike '%'||clean||'%' or (can_customer and o.customer_email ilike '%'||clean||'%'))), rows as(select * from scoped order by created_at desc limit sz offset (pg-1)*sz)
 select jsonb_build_object('payments',coalesce((select jsonb_agg(x order by x.created_at desc) from rows x),'[]'::jsonb),'pagination',jsonb_build_object('page',pg,'total',(select count(*) from scoped),'total_pages',greatest(ceil((select count(*) from scoped)::numeric/sz)::integer,1)),'summary',jsonb_build_object('captured_pence',(select coalesce(sum(total_pence),0) from public.orders where payment_status in('paid','partially_refunded','refunded')),'refunded_pence',(select coalesce(sum(refunded_pence),0) from public.orders),'failed_count',(select count(*) from public.orders where payment_status='failed'),'refund_pending_count',(select count(*) from public.platform_refunds where status='processing'))) into result;
 return result;
end;$f$;

create or replace function public.get_platform_payment(p_order_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare result jsonb; can_customer boolean:=private.has_platform_admin_permission('orders:customer_details');
begin
 if not private.has_platform_admin_permission('finance:view') then raise exception 'You do not have permission to view payments' using errcode='42501'; end if;
 select jsonb_build_object('payment',jsonb_build_object('id',o.id,'order_number',o.order_number,'restaurant_name',r.name,'customer_email',case when can_customer then o.customer_email else null end,'total_pence',o.total_pence,'refunded_pence',o.refunded_pence,'refundable_pence',greatest(o.total_pence-o.refunded_pence-coalesce((select sum(amount_pence) from public.platform_refunds where order_id=o.id and status='processing'),0),0),'currency',o.currency,'payment_status',o.payment_status,'paid_at',o.paid_at,'created_at',o.created_at,'stripe_payment_intent_id',o.stripe_payment_intent_id),'refunds',coalesce((select jsonb_agg(jsonb_build_object('id',pr.id,'amount_pence',pr.amount_pence,'reason',pr.reason,'status',pr.status,'stripe_refund_id',pr.stripe_refund_id,'failure_message',pr.failure_message,'requested_by_name',coalesce(pa.display_name,'Removed administrator'),'created_at',pr.created_at,'completed_at',pr.completed_at) order by pr.created_at desc) from public.platform_refunds pr left join public.platform_admins pa on pa.user_id=pr.requested_by where pr.order_id=o.id),'[]'::jsonb)) into result from public.orders o join public.restaurants r on r.id=o.restaurant_id where o.id=p_order_id;
 if result is null then raise exception 'Payment not found'; end if; return result;
end;$f$;
revoke all on function public.get_platform_payments(text,text,integer,integer),public.get_platform_payment(uuid) from public,anon,authenticated;
grant execute on function public.get_platform_payments(text,text,integer,integer),public.get_platform_payment(uuid) to authenticated;
commit;
