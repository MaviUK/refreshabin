do $$
begin
  if not exists(select 1 from vault.secrets where name='phase_5_11_group_notification_cron_secret') then
    perform vault.create_secret(encode(gen_random_bytes(32),'hex'),'phase_5_11_group_notification_cron_secret','Random internal secret for Phase 5.11 group notification cron authentication');
  end if;
end $$;

create or replace function public.verify_restaurant_group_notification_cron_token(p_token text)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.role()='service_role'
    and exists(
      select 1 from vault.decrypted_secrets s
      where s.name='phase_5_11_group_notification_cron_secret'
        and encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex')=encode(extensions.digest(s.decrypted_secret,'sha256'),'hex')
    )
$$;
revoke all on function public.verify_restaurant_group_notification_cron_token(text) from public,anon,authenticated;
grant execute on function public.verify_restaurant_group_notification_cron_token(text) to service_role;

do $$
begin
  if exists(select 1 from cron.job where jobname='ordered-group-notifications') then perform cron.unschedule('ordered-group-notifications'); end if;
  perform cron.schedule(
    'ordered-group-notifications',
    '*/5 * * * *',
    format(
      $cmd$select net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','x-ordered-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='phase_5_11_group_notification_cron_secret' limit 1)), body := '{}'::jsonb)$cmd$,
      'https://uvlzxrsqylwksgwpsslp.supabase.co/functions/v1/process-group-notifications'
    )
  );
end $$;
