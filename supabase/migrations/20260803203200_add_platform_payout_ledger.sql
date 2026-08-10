begin;

create table if not exists public.platform_restaurant_payouts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  period_from date not null,
  period_to date not null,
  amount_pence bigint not null check (amount_pence > 0),
  status text not null default 'draft' check (status in ('draft','processing','paid','failed','cancelled')),
  external_reference text,
  notes text,
  created_by uuid references public.platform_admins(user_id) on delete set null,
  updated_by uuid references public.platform_admins(user_id) on delete set null,
  processed_at timestamptz,
  paid_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_from <= period_to),
  check (notes is null or length(notes) <= 1000),
  check (external_reference is null or length(external_reference) <= 200)
);

create index if not exists platform_restaurant_payouts_restaurant_idx
  on public.platform_restaurant_payouts (restaurant_id, created_at desc);
create index if not exists platform_restaurant_payouts_status_idx
  on public.platform_restaurant_payouts (status, created_at desc);

alter table public.platform_restaurant_payouts enable row level security;
revoke all on table public.platform_restaurant_payouts from public, anon, authenticated;

create or replace function public.get_platform_payout_dashboard(
  p_search text default null,
  p_status text default null
) returns jsonb
language plpgsql stable security definer set search_path=''
as $function$
declare result jsonb; clean text := nullif(trim(coalesce(p_search,'')),'');
begin
  if not private.has_platform_admin_permission('finance:view') then
    raise exception 'You do not have permission to view payouts' using errcode='42501';
  end if;
  if p_status is not null and p_status not in ('draft','processing','paid','failed','cancelled') then
    raise exception 'Unsupported payout status';
  end if;

  with restaurant_net as (
    select o.restaurant_id,
      coalesce(sum(greatest(o.restaurant_net_pence - least(o.refunded_pence, greatest(o.total_pence-o.service_fee_pence,0)),0)),0)::bigint earned_pence
    from public.orders o
    where o.payment_status in ('paid','partially_refunded','refunded')
    group by o.restaurant_id
  ), committed as (
    select p.restaurant_id,
      coalesce(sum(p.amount_pence) filter (where p.status in ('processing','paid')),0)::bigint committed_pence,
      coalesce(sum(p.amount_pence) filter (where p.status='paid'),0)::bigint paid_pence
    from public.platform_restaurant_payouts p group by p.restaurant_id
  ), balances as (
    select r.id restaurant_id,r.name restaurant_name,r.status restaurant_status,
      coalesce(n.earned_pence,0) earned_pence,
      coalesce(c.committed_pence,0) committed_pence,
      coalesce(c.paid_pence,0) paid_pence,
      greatest(coalesce(n.earned_pence,0)-coalesce(c.committed_pence,0),0)::bigint available_pence,
      (select max(p.paid_at) from public.platform_restaurant_payouts p where p.restaurant_id=r.id and p.status='paid') last_paid_at
    from public.restaurants r
    left join restaurant_net n on n.restaurant_id=r.id
    left join committed c on c.restaurant_id=r.id
    where r.status in ('active','suspended')
      and (clean is null or r.name ilike '%'||clean||'%')
  ), payouts as (
    select p.id,p.restaurant_id,r.name restaurant_name,p.period_from,p.period_to,p.amount_pence,p.status,
      p.external_reference,p.notes,p.processed_at,p.paid_at,p.failed_at,p.created_at,p.updated_at,
      coalesce(a.display_name,'Removed administrator') created_by_name
    from public.platform_restaurant_payouts p
    join public.restaurants r on r.id=p.restaurant_id
    left join public.platform_admins a on a.user_id=p.created_by
    where (p_status is null or p.status=p_status)
      and (clean is null or r.name ilike '%'||clean||'%' or p.external_reference ilike '%'||clean||'%')
  )
  select jsonb_build_object(
    'balances',coalesce((select jsonb_agg(b order by b.available_pence desc,b.restaurant_name) from balances b),'[]'::jsonb),
    'payouts',coalesce((select jsonb_agg(p order by p.created_at desc) from payouts p),'[]'::jsonb),
    'summary',jsonb_build_object(
      'available_pence',coalesce((select sum(available_pence) from balances),0),
      'processing_pence',coalesce((select sum(amount_pence) from public.platform_restaurant_payouts where status='processing'),0),
      'paid_pence',coalesce((select sum(amount_pence) from public.platform_restaurant_payouts where status='paid'),0),
      'failed_count',(select count(*) from public.platform_restaurant_payouts where status='failed')
    )
  ) into result;
  return result;
end;
$function$;

create or replace function public.create_platform_restaurant_payout(
  p_restaurant_id uuid,
  p_period_from date,
  p_period_to date,
  p_amount_pence bigint,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path=''
as $function$
declare payout_id uuid; available bigint; earned bigint; committed bigint;
begin
  if not private.has_platform_admin_permission('finance:manage') then
    raise exception 'You do not have permission to create payouts' using errcode='42501';
  end if;
  if p_period_from is null or p_period_to is null or p_period_from>p_period_to or p_period_to>current_date then raise exception 'Choose a valid completed payout period'; end if;
  if p_amount_pence is null or p_amount_pence<=0 then raise exception 'Payout amount must be positive'; end if;
  if not exists(select 1 from public.restaurants where id=p_restaurant_id) then raise exception 'Restaurant not found'; end if;

  select coalesce(sum(greatest(o.restaurant_net_pence-least(o.refunded_pence,greatest(o.total_pence-o.service_fee_pence,0)),0)),0)::bigint
    into earned from public.orders o where o.restaurant_id=p_restaurant_id and o.payment_status in ('paid','partially_refunded','refunded');
  select coalesce(sum(p.amount_pence),0)::bigint into committed from public.platform_restaurant_payouts p where p.restaurant_id=p_restaurant_id and p.status in ('processing','paid');
  available:=greatest(earned-committed,0);
  if p_amount_pence>available then raise exception 'Payout exceeds the available restaurant balance'; end if;

  insert into public.platform_restaurant_payouts(restaurant_id,period_from,period_to,amount_pence,notes,created_by,updated_by)
  values(p_restaurant_id,p_period_from,p_period_to,p_amount_pence,nullif(trim(coalesce(p_notes,'')),''),auth.uid(),auth.uid()) returning id into payout_id;
  insert into public.platform_admin_audit_log(actor_user_id,action,target_type,target_id,details)
  values(auth.uid(),'restaurant_payout_created','restaurant_payout',payout_id,jsonb_build_object('restaurant_id',p_restaurant_id,'amount_pence',p_amount_pence,'period_from',p_period_from,'period_to',p_period_to));
  return payout_id;
end;
$function$;

create or replace function public.manage_platform_restaurant_payout(
  p_payout_id uuid,
  p_action text,
  p_external_reference text default null,
  p_notes text default null
) returns void
language plpgsql security definer set search_path=''
as $function$
declare current public.platform_restaurant_payouts%rowtype; next_status text;
begin
  if not private.has_platform_admin_permission('finance:manage') then
    raise exception 'You do not have permission to manage payouts' using errcode='42501';
  end if;
  select * into current from public.platform_restaurant_payouts where id=p_payout_id for update;
  if not found then raise exception 'Payout not found'; end if;
  if p_action='start' and current.status='draft' then next_status:='processing';
  elsif p_action='mark_paid' and current.status='processing' then next_status:='paid';
  elsif p_action='mark_failed' and current.status='processing' then next_status:='failed';
  elsif p_action='retry' and current.status='failed' then next_status:='processing';
  elsif p_action='cancel' and current.status in ('draft','failed') then next_status:='cancelled';
  else raise exception 'This payout transition is not allowed'; end if;
  if p_action='mark_paid' and nullif(trim(coalesce(p_external_reference,'')),'') is null then raise exception 'A payment reference is required'; end if;

  update public.platform_restaurant_payouts set status=next_status,
    external_reference=coalesce(nullif(trim(coalesce(p_external_reference,'')),''),external_reference),
    notes=coalesce(nullif(trim(coalesce(p_notes,'')),''),notes),updated_by=auth.uid(),updated_at=now(),
    processed_at=case when next_status='processing' then now() else processed_at end,
    paid_at=case when next_status='paid' then now() else paid_at end,
    failed_at=case when next_status='failed' then now() else failed_at end
  where id=p_payout_id;
  insert into public.platform_admin_audit_log(actor_user_id,action,target_type,target_id,details)
  values(auth.uid(),'restaurant_payout_'||p_action,'restaurant_payout',p_payout_id,jsonb_build_object('from',current.status,'to',next_status,'reference',nullif(trim(coalesce(p_external_reference,'')),'')));
end;
$function$;

revoke all on function public.get_platform_payout_dashboard(text,text),public.create_platform_restaurant_payout(uuid,date,date,bigint,text),public.manage_platform_restaurant_payout(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.get_platform_payout_dashboard(text,text),public.create_platform_restaurant_payout(uuid,date,date,bigint,text),public.manage_platform_restaurant_payout(uuid,text,text,text) to authenticated;

commit;
