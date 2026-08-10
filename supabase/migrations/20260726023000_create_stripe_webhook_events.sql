begin;

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

alter table public.stripe_webhook_events enable row level security;

comment on table public.stripe_webhook_events is 'Processed Stripe webhook event IDs used to prevent duplicate handling.';

commit;
