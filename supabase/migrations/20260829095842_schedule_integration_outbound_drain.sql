create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'integration-outbound-drain',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/integration-outbound-drain',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_publishable_key'),
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 25000
  ) as request_id;
  $$
);

create or replace function public.enqueue_integration_event(
  p_organisation_id uuid,
  p_event_type      public.integration_event_type,
  p_payload         jsonb,
  p_dedupe_key      text,
  p_environment     public.api_environment default 'live'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid := gen_random_uuid();
  v_queued   integer := 0;
begin
  if p_dedupe_key is null or length(trim(p_dedupe_key)) = 0 then
    raise exception 'enqueue_integration_event: a dedupe_key is required';
  end if;

  insert into public.integration_outbound_events (
    organisation_id, partner_integration_id, webhook_endpoint_id,
    event_id, event_type, dedupe_key, payload, environment
  )
  select
    w.organisation_id, w.partner_integration_id, w.id,
    v_event_id, p_event_type, p_dedupe_key, p_payload, p_environment
  from public.partner_webhook_endpoints w
  where w.organisation_id = p_organisation_id
    and w.is_active
    and w.environment = p_environment
    and p_event_type = any (w.event_types)
  on conflict (webhook_endpoint_id, dedupe_key) do nothing;

  get diagnostics v_queued = row_count;

  if v_queued > 0 then
    begin
      perform net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
          || '/functions/v1/integration-outbound-drain',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_publishable_key'),
          'Content-Type', 'application/json'
        ),
        timeout_milliseconds := 8000
      );
    exception when others then
      null;
    end;
  end if;

  return v_queued;
end;
$$;

revoke all on function public.enqueue_integration_event(uuid, public.integration_event_type, jsonb, text, public.api_environment) from public, anon, authenticated;
grant execute on function public.enqueue_integration_event(uuid, public.integration_event_type, jsonb, text, public.api_environment) to service_role;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'integration-outbound-drain') then
    raise exception 'integration-outbound-drain cron job was not registered';
  end if;

  if has_function_privilege('anon', 'public.enqueue_integration_event(uuid, public.integration_event_type, jsonb, text, public.api_environment)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.enqueue_integration_event(uuid, public.integration_event_type, jsonb, text, public.api_environment)', 'EXECUTE')
  then
    raise exception 'enqueue_integration_event: anon or authenticated can still EXECUTE after re-creation';
  end if;
end $$;
