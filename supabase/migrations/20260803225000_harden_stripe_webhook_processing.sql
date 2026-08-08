begin;

alter table public.stripe_webhook_events
  add column if not exists status text not null default 'processed',
  add column if not exists attempts integer not null default 1,
  add column if not exists last_error text,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'stripe_webhook_events_status_check'
      and conrelid = 'public.stripe_webhook_events'::regclass
  ) then
    alter table public.stripe_webhook_events
      add constraint stripe_webhook_events_status_check
      check (status in ('processing','processed','failed'));
  end if;
end
$$;

create index if not exists stripe_webhook_events_status_idx
  on public.stripe_webhook_events (status, updated_at desc);

create or replace function public.claim_stripe_webhook_event(
  p_event_id text,
  p_event_type text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  existing public.stripe_webhook_events%rowtype;
  inserted_count integer := 0;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_event_id, ''))) < 3 or length(trim(coalesce(p_event_type, ''))) < 3 then
    raise exception 'Invalid Stripe event' using errcode = '22023';
  end if;

  insert into public.stripe_webhook_events(event_id, event_type, status, attempts, last_error, updated_at)
  values(trim(p_event_id), trim(p_event_type), 'processing', 1, null, now())
  on conflict (event_id) do nothing;
  get diagnostics inserted_count = row_count;

  if inserted_count = 1 then
    return jsonb_build_object('claimed', true, 'duplicate', false, 'status', 'processing');
  end if;

  select * into existing
  from public.stripe_webhook_events
  where event_id = trim(p_event_id)
  for update;

  if existing.status = 'processed' then
    return jsonb_build_object('claimed', false, 'duplicate', true, 'status', existing.status);
  end if;

  if existing.status = 'processing' and existing.updated_at > now() - interval '10 minutes' then
    return jsonb_build_object('claimed', false, 'duplicate', true, 'status', existing.status);
  end if;

  update public.stripe_webhook_events
  set status = 'processing',
      event_type = trim(p_event_type),
      attempts = existing.attempts + 1,
      last_error = null,
      updated_at = now()
  where event_id = trim(p_event_id);

  return jsonb_build_object('claimed', true, 'duplicate', false, 'status', 'processing');
end;
$function$;

create or replace function public.complete_stripe_webhook_event(
  p_event_id text,
  p_succeeded boolean,
  p_error_message text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  update public.stripe_webhook_events
  set status = case when p_succeeded then 'processed' else 'failed' end,
      last_error = case when p_succeeded then null else left(coalesce(p_error_message, 'Webhook processing failed'), 500) end,
      updated_at = now()
  where event_id = trim(p_event_id);
end;
$function$;

revoke all on function public.claim_stripe_webhook_event(text,text), public.complete_stripe_webhook_event(text,boolean,text)
  from public, anon, authenticated;
grant execute on function public.claim_stripe_webhook_event(text,text), public.complete_stripe_webhook_event(text,boolean,text)
  to service_role;

commit;
