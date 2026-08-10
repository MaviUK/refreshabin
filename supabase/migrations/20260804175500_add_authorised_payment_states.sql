begin;

alter table public.orders drop constraint if exists orders_payment_status_check;

alter table public.orders
  add constraint orders_payment_status_check
  check (payment_status in (
    'pending',
    'requires_action',
    'authorized',
    'paid',
    'failed',
    'cancelled',
    'refunded',
    'partially_refunded'
  ));

comment on column public.orders.payment_status is
  'pending while checkout is incomplete, authorized while funds are held awaiting restaurant acceptance, paid after capture, cancelled when an authorisation is released, and refund states after capture.';

commit;
