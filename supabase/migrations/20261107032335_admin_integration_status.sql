-- Superadmin console integrations centre (docs/design/SUPERADMIN-CONSOLE.md, phase 2d): what each platform provider
-- has actually done in the last 7 days, from the records the platform already keeps. Read-only (STABLE), SECURITY
-- DEFINER, admin only; a refused caller gets 42501. Counts and timestamps only: no error text (it can carry an address
-- or a name), no patient, no payload, no secret.
--
-- Per provider: ok_7d / failed_7d / last_ok_at / last_failed_at, plus webhook health for the three providers that call
-- us (webhooks_ok_7d / webhooks_bad_7d / last_webhook_at; bad = rejected signature, failed or dead). Definitions:
--   paystack   ok: payments 'success' (catalogue orders) + payment_transactions without error; failed:
--              payment_transactions that errored. A customer's declined card is not a Paystack failure.
--   email      notifications channel email: ok = sent, delivered or read (by sent_at); failed = failed (by failed_at).
--   push       the same for channel push.
--   sms        sms_delivery_log, provider termii: ok = sent; failed = failed. Rate limiting is our rule, not a failure.
--   zoom       ok: video consultations given a Zoom meeting (by created_at). Failures are not recorded per meeting;
--              Zoom's webhooks show the other side.
--   ai         ai_interaction_log: ok = completed; failed = failed or fallback (the model did not answer). 'blocked' is a
--              guardrail doing its job and is neither.
--   clamav     upload_scan_verdicts: ok = clean or infected (the scanner answered); failed = unavailable.
-- Test traffic is included on purpose: a test send still exercises the provider.
--
-- Writes nothing. ROLLBACK: drop function public.admin_integration_status().

create or replace function public.admin_integration_status()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_since timestamptz := now() - interval '7 days';
begin
  if not private.is_admin() then
    raise exception 'admin_integration_status_not_authorised' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'computed_at', now(),
    'since', v_since,
    'paystack', jsonb_build_object(
      'ok_7d', (select count(*) from public.payments where status = 'success' and verified_at >= v_since)
             + (select count(*) from public.payment_transactions where error is null and created_at >= v_since),
      'failed_7d', (select count(*) from public.payment_transactions where error is not null and created_at >= v_since),
      'last_ok_at', greatest(
        (select max(verified_at) from public.payments where status = 'success'),
        (select max(created_at) from public.payment_transactions where error is null)),
      'last_failed_at', (select max(created_at) from public.payment_transactions where error is not null)
    ) || private.integration_webhook_health('paystack', v_since),
    'email', private.integration_channel_health('email', v_since) || private.integration_webhook_health('resend', v_since),
    'push', private.integration_channel_health('push', v_since),
    'sms', jsonb_build_object(
      'ok_7d', (select count(*) from public.sms_delivery_log where provider = 'termii' and status = 'sent' and created_at >= v_since),
      'failed_7d', (select count(*) from public.sms_delivery_log where provider = 'termii' and status = 'failed' and created_at >= v_since),
      'last_ok_at', (select max(created_at) from public.sms_delivery_log where provider = 'termii' and status = 'sent'),
      'last_failed_at', (select max(created_at) from public.sms_delivery_log where provider = 'termii' and status = 'failed')
    ),
    'zoom', jsonb_build_object(
      'ok_7d', (select count(*) from public.video_consultations where zoom_meeting_id is not null and created_at >= v_since),
      'failed_7d', null,
      'last_ok_at', (select max(created_at) from public.video_consultations where zoom_meeting_id is not null),
      'last_failed_at', null
    ) || private.integration_webhook_health('zoom', v_since),
    'ai', jsonb_build_object(
      'ok_7d', (select count(*) from public.ai_interaction_log where status = 'completed' and created_at >= v_since),
      'failed_7d', (select count(*) from public.ai_interaction_log where status in ('failed', 'fallback') and created_at >= v_since),
      'last_ok_at', (select max(created_at) from public.ai_interaction_log where status = 'completed'),
      'last_failed_at', (select max(created_at) from public.ai_interaction_log where status in ('failed', 'fallback'))
    ),
    'clamav', jsonb_build_object(
      'ok_7d', (select count(*) from public.upload_scan_verdicts where verdict in ('clean', 'infected') and created_at >= v_since),
      'failed_7d', (select count(*) from public.upload_scan_verdicts where verdict = 'unavailable' and created_at >= v_since),
      'last_ok_at', (select max(created_at) from public.upload_scan_verdicts where verdict in ('clean', 'infected')),
      'last_failed_at', (select max(created_at) from public.upload_scan_verdicts where verdict = 'unavailable')
    )
  );
end;
$function$;

create or replace function private.integration_channel_health(p_channel text, p_since timestamptz)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  -- The enum is compared directly (no text cast) and the "last" times look back 90 days at most, so a page load reads
  -- a bounded slice of notifications rather than the whole table.
  select jsonb_build_object(
    'ok_7d', (select count(*) from public.notifications where channel = p_channel::public.notification_channel and status in ('sent', 'delivered', 'read') and sent_at >= p_since),
    'failed_7d', (select count(*) from public.notifications where channel = p_channel::public.notification_channel and status = 'failed' and failed_at >= p_since),
    'last_ok_at', (select max(sent_at) from public.notifications where channel = p_channel::public.notification_channel and status in ('sent', 'delivered', 'read') and sent_at >= now() - interval '90 days'),
    'last_failed_at', (select max(failed_at) from public.notifications where channel = p_channel::public.notification_channel and status = 'failed' and failed_at >= now() - interval '90 days')
  );
$function$;

create or replace function private.integration_webhook_health(p_provider text, p_since timestamptz)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  select jsonb_build_object(
    'webhooks_ok_7d', (select count(*) from public.provider_events where provider = p_provider and status = 'processed' and received_at >= p_since),
    'webhooks_bad_7d', (select count(*) from public.provider_events where provider = p_provider and status in ('rejected', 'failed', 'dead') and received_at >= p_since),
    'last_webhook_at', (select max(received_at) from public.provider_events where provider = p_provider)
  );
$function$;

-- anon inherits EXECUTE through PUBLIC (CLAUDE.md), so revoke from public.
revoke all on function public.admin_integration_status() from public, anon;
grant execute on function public.admin_integration_status() to authenticated, service_role;
revoke all on function private.integration_channel_health(text, timestamptz) from public, anon, authenticated;
revoke all on function private.integration_webhook_health(text, timestamptz) from public, anon, authenticated;
grant execute on function private.integration_channel_health(text, timestamptz) to service_role;
grant execute on function private.integration_webhook_health(text, timestamptz) to service_role;

-- Closing self-check: anon cannot call the public function, nobody signed in can call the private helpers directly
-- (they skip the admin gate), and all three are read-only.
do $$
begin
  if has_function_privilege('anon', 'public.admin_integration_status()', 'EXECUTE') then
    raise exception 'admin_integration_status: anon can execute';
  end if;
  if has_function_privilege('authenticated', 'private.integration_channel_health(text, timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.integration_webhook_health(text, timestamptz)', 'EXECUTE') then
    raise exception 'integration health helpers: callable without the admin gate';
  end if;
  if exists (select 1 from pg_proc where oid in ('public.admin_integration_status()'::regprocedure,
        'private.integration_channel_health(text, timestamptz)'::regprocedure,
        'private.integration_webhook_health(text, timestamptz)'::regprocedure) and provolatile <> 's') then
    raise exception 'admin_integration_status: a function is not STABLE';
  end if;
end $$;
