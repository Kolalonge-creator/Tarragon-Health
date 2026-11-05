-- Tarragon Health: the integration-outbound-drain edge function now requires the internal cron secret.
--
-- Security audit 2026-11-05, finding M-3. The function did no authentication of its own, and pg_cron called it with
-- only the publishable key, which is public. So anyone could trigger outbound partner-webhook drains, early or
-- repeatedly. The function now refuses a call without x-internal-cron-secret matching PROCESS_EVENTS_SECRET (the
-- same Vault/Edge secret process-events already requires), and this migration re-schedules the cron job to send it.
-- Live check 2026-11-05: integration_outbound_events has never held a row, so nothing is waiting to be delivered.

select cron.unschedule('integration-outbound-drain')
where exists (select 1 from cron.job where jobname = 'integration-outbound-drain');

select cron.schedule(
  'integration-outbound-drain',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/integration-outbound-drain',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_publishable_key'),
      'x-internal-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'process_events_secret'),
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 25000
  ) as request_id;
  $$
);

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'integration-outbound-drain' and command like '%x-internal-cron-secret%') then
    raise exception 'M-3: integration-outbound-drain cron job does not send the internal cron secret';
  end if;
end $$;
