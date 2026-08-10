begin;

alter table public.orders
  add column if not exists stripe_processing_fee_pence integer not null default 0 check (stripe_processing_fee_pence >= 0),
  add column if not exists stripe_transfer_reversal_id text,
  add column if not exists settlement_finalised_at timestamptz;

create table if not exists public.restaurant_weekly_invoices (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  invoice_number text not null unique,
  period_start date not null,
  period_end date not null,
  order_count integer not null default 0,
  gross_sales_pence bigint not null default 0,
  delivery_sales_pence bigint not null default 0,
  collection_sales_pence bigint not null default 0,
  refunded_pence bigint not null default 0,
  stripe_fees_pence bigint not null default 0,
  ordered_food_fees_pence bigint not null default 0,
  ordered_food_vat_pence bigint not null default 0,
  net_settlement_pence bigint not null default 0,
  currency text not null default 'gbp',
  status text not null default 'generated' check (status in ('generated','sent','failed','void')),
  pdf_path text,
  csv_path text,
  sent_to text,
  sent_at timestamptz,
  send_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, period_start, period_end),
  check (period_end >= period_start)
);

create index if not exists restaurant_weekly_invoices_restaurant_period_idx
  on public.restaurant_weekly_invoices (restaurant_id, period_end desc);

alter table public.restaurant_weekly_invoices enable row level security;
revoke all on public.restaurant_weekly_invoices from public, anon, authenticated;

create or replace function public.get_restaurant_finance_dashboard(
  p_from date default (current_date - 29),
  p_to date default current_date
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $function$
declare
  restaurant_id uuid;
  result jsonb;
begin
  select rm.restaurant_id into restaurant_id
  from public.restaurant_members rm
  where rm.user_id = auth.uid()
  order by rm.created_at
  limit 1;

  if restaurant_id is null then
    raise exception 'Restaurant membership not found' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 731 then
    raise exception 'Choose a valid reporting period of no more than two years';
  end if;

  with settled as (
    select o.id, o.order_number, o.fulfilment_method, o.created_at, o.paid_at,
      o.total_pence, o.delivery_fee_pence, o.refunded_pence,
      o.stripe_processing_fee_pence,
      o.platform_commission_pence,
      o.platform_commission_vat_pence,
      greatest(
        o.total_pence - o.refunded_pence - o.stripe_processing_fee_pence
        - o.platform_commission_pence - o.platform_commission_vat_pence,
        0
      ) as net_settlement_pence
    from public.orders o
    where o.restaurant_id = restaurant_id
      and o.payment_status in ('paid','partially_refunded','refunded')
      and coalesce(o.paid_at,o.created_at) >= p_from::timestamptz
      and coalesce(o.paid_at,o.created_at) < (p_to + 1)::timestamptz
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'summary', jsonb_build_object(
      'order_count', coalesce(count(*),0),
      'customer_paid_pence', coalesce(sum(total_pence),0),
      'refunded_pence', coalesce(sum(refunded_pence),0),
      'stripe_fees_pence', coalesce(sum(stripe_processing_fee_pence),0),
      'ordered_food_fees_pence', coalesce(sum(platform_commission_pence),0),
      'ordered_food_vat_pence', coalesce(sum(platform_commission_vat_pence),0),
      'net_settlement_pence', coalesce(sum(net_settlement_pence),0)
    ),
    'orders', coalesce(jsonb_agg(jsonb_build_object(
      'id', id,
      'order_number', order_number,
      'fulfilment_method', fulfilment_method,
      'paid_at', coalesce(paid_at,created_at),
      'customer_paid_pence', total_pence,
      'stripe_fee_pence', stripe_processing_fee_pence,
      'ordered_food_fee_pence', platform_commission_pence,
      'ordered_food_vat_pence', platform_commission_vat_pence,
      'refund_pence', refunded_pence,
      'net_settlement_pence', net_settlement_pence
    ) order by coalesce(paid_at,created_at) desc), '[]'::jsonb),
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'invoice_number', i.invoice_number,
        'period_start', i.period_start,
        'period_end', i.period_end,
        'order_count', i.order_count,
        'gross_sales_pence', i.gross_sales_pence,
        'stripe_fees_pence', i.stripe_fees_pence,
        'ordered_food_fees_pence', i.ordered_food_fees_pence,
        'ordered_food_vat_pence', i.ordered_food_vat_pence,
        'net_settlement_pence', i.net_settlement_pence,
        'status', i.status,
        'sent_at', i.sent_at,
        'pdf_path', i.pdf_path,
        'csv_path', i.csv_path
      ) order by i.period_end desc)
      from public.restaurant_weekly_invoices i
      where i.restaurant_id = restaurant_id
    ), '[]'::jsonb)
  ) into result
  from settled;

  return result;
end;
$function$;

revoke all on function public.get_restaurant_finance_dashboard(date,date) from public, anon, authenticated;
grant execute on function public.get_restaurant_finance_dashboard(date,date) to authenticated;

create or replace function public.generate_restaurant_weekly_invoice(
  p_restaurant_id uuid,
  p_period_start date,
  p_period_end date
) returns uuid
language plpgsql security definer set search_path = ''
as $function$
declare
  invoice_id uuid;
  invoice_no text;
  next_sequence bigint;
begin
  if auth.role() <> 'service_role' and not private.has_platform_admin_permission('finance:manage') then
    raise exception 'You do not have permission to generate invoices' using errcode = '42501';
  end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start or p_period_end - p_period_start > 31 then
    raise exception 'Invalid invoice period';
  end if;

  select coalesce(max((regexp_match(invoice_number, '([0-9]+)$'))[1]::bigint),0) + 1
  into next_sequence
  from public.restaurant_weekly_invoices
  where extract(year from period_end) = extract(year from p_period_end);

  invoice_no := 'OF-' || to_char(p_period_end, 'YYYY') || '-' || lpad(next_sequence::text, 6, '0');

  insert into public.restaurant_weekly_invoices (
    restaurant_id, invoice_number, period_start, period_end, order_count,
    gross_sales_pence, delivery_sales_pence, collection_sales_pence,
    refunded_pence, stripe_fees_pence, ordered_food_fees_pence,
    ordered_food_vat_pence, net_settlement_pence
  )
  select p_restaurant_id, invoice_no, p_period_start, p_period_end,
    count(*)::integer,
    coalesce(sum(o.total_pence),0),
    coalesce(sum(case when o.fulfilment_method = 'delivery' then o.total_pence else 0 end),0),
    coalesce(sum(case when o.fulfilment_method = 'collection' then o.total_pence else 0 end),0),
    coalesce(sum(o.refunded_pence),0),
    coalesce(sum(o.stripe_processing_fee_pence),0),
    coalesce(sum(o.platform_commission_pence),0),
    coalesce(sum(o.platform_commission_vat_pence),0),
    coalesce(sum(greatest(
      o.total_pence - o.refunded_pence - o.stripe_processing_fee_pence
      - o.platform_commission_pence - o.platform_commission_vat_pence,
      0
    )),0)
  from public.orders o
  where o.restaurant_id = p_restaurant_id
    and o.payment_status in ('paid','partially_refunded','refunded')
    and coalesce(o.paid_at,o.created_at) >= p_period_start::timestamptz
    and coalesce(o.paid_at,o.created_at) < (p_period_end + 1)::timestamptz
  on conflict (restaurant_id, period_start, period_end)
  do update set
    order_count = excluded.order_count,
    gross_sales_pence = excluded.gross_sales_pence,
    delivery_sales_pence = excluded.delivery_sales_pence,
    collection_sales_pence = excluded.collection_sales_pence,
    refunded_pence = excluded.refunded_pence,
    stripe_fees_pence = excluded.stripe_fees_pence,
    ordered_food_fees_pence = excluded.ordered_food_fees_pence,
    ordered_food_vat_pence = excluded.ordered_food_vat_pence,
    net_settlement_pence = excluded.net_settlement_pence,
    status = 'generated',
    send_error = null,
    updated_at = now()
  returning id into invoice_id;

  return invoice_id;
end;
$function$;

revoke all on function public.generate_restaurant_weekly_invoice(uuid,date,date) from public, anon, authenticated;
grant execute on function public.generate_restaurant_weekly_invoice(uuid,date,date) to service_role, authenticated;

commit;
