begin;

create table if not exists public.edge_function_rate_limits (
  id bigint generated always as identity primary key,
  function_name text not null,
  subject_key text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  updated_at timestamptz not null default now(),
  unique (function_name, subject_key, window_started_at)
);

create index if not exists edge_function_rate_limits_cleanup_idx
  on public.edge_function_rate_limits (window_started_at);

alter table public.edge_function_rate_limits enable row level security;
revoke all on public.edge_function_rate_limits from public, anon, authenticated;

create or replace function public.consume_edge_function_rate_limit(
  p_function_name text,
  p_subject_key text,
  p_window_seconds integer,
  p_max_requests integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  bucket timestamptz;
  current_count integer;
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_function_name, ''))) < 2
    or length(trim(coalesce(p_subject_key, ''))) < 2
    or p_window_seconds < 1
    or p_window_seconds > 86400
    or p_max_requests < 1
    or p_max_requests > 10000 then
    raise exception 'Invalid rate-limit configuration' using errcode = '22023';
  end if;

  bucket := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.edge_function_rate_limits(function_name, subject_key, window_started_at, request_count)
  values(trim(p_function_name), left(trim(p_subject_key), 300), bucket, 1)
  on conflict (function_name, subject_key, window_started_at)
  do update set request_count = public.edge_function_rate_limits.request_count + 1, updated_at = now()
  returning request_count into current_count;

  delete from public.edge_function_rate_limits
  where window_started_at < now() - interval '2 days';

  return jsonb_build_object(
    'allowed', current_count <= p_max_requests,
    'request_count', current_count,
    'limit', p_max_requests,
    'window_started_at', bucket,
    'retry_after_seconds', greatest(p_window_seconds - floor(extract(epoch from now() - bucket))::integer, 1)
  );
end;
$function$;

revoke all on function public.consume_edge_function_rate_limit(text,text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.consume_edge_function_rate_limit(text,text,integer,integer)
  to service_role;

commit;
