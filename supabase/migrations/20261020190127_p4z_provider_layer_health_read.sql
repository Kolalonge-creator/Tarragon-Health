-- P4z: provider layer health, one read for the chain-health page. Counts, seconds and provider names only: no webhook body, no email, no
-- patient. It adds NO setting and NO threshold of its own: every judgement is read from the existing `provider_layer_config`
-- (providers.layer), so the numbers that decide "needs a look" are the ones the inbox, breaker and reconciliation already run on.
--
--   * an event that gave up after every retry (status dead)                                   -> needs a look
--   * an event still waiting longer than a retry can ever be delayed (backoffMaxSeconds + leaseSeconds): nothing is draining the inbox
--     (provider-event-drain is not scheduled until the founder adds the cron) -> needs a look. This is the "it silently stopped" case.
--   * a circuit breaker open (the platform has stopped calling that vendor operation)         -> needs a look
--   * a reconciliation break older than reconciliation.unsettledAfterHours                     -> needs a look
--   * a payout ledger posting that failed or was skipped                                        -> needs a look
-- Rejected (forged or unverifiable) deliveries in the last day are SHOWN but never judged: a count of strangers knocking is not an outage.
--
-- Read only. Admin or the Chief Medical Officer (the same two people the chain-health page admits). Counts before: provider_events 2 rows.

create function public.provider_layer_health() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_lease integer := coalesce((private.provider_layer_setting('inbox', 'leaseSeconds'))::integer, 120);
  v_back integer := coalesce((private.provider_layer_setting('inbox', 'backoffMaxSeconds'))::integer, 3600);
  v_unsettled integer := coalesce((private.provider_layer_setting('reconciliation', 'unsettledAfterHours'))::integer, 72);
  v_stale integer;
  v_reasons text[] := '{}';
  v_dead integer; v_stuck integer; v_rejected integer; v_open integer; v_oldest numeric;
  v_breakers_open integer; v_breakers_half integer;
  v_breaks integer; v_breaks_old integer; v_oldest_break numeric;
  v_gl_failed integer; v_gl_skipped integer;
  v_per jsonb;
begin
  if (select auth.uid()) is null or not (private.is_admin() or private.credential_is_cmo()) then
    raise exception 'provider_health_not_authorised' using errcode = '42501';
  end if;
  v_stale := v_back + v_lease;

  select count(*) filter (where status = 'dead'),
         count(*) filter (where status in ('received', 'failed', 'processing') and received_at < now() - make_interval(secs => v_stale)),
         count(*) filter (where status = 'rejected' and received_at >= now() - interval '24 hours'),
         count(*) filter (where status in ('received', 'failed', 'processing')),
         extract(epoch from (now() - min(received_at) filter (where status in ('received', 'failed', 'processing'))))
    into v_dead, v_stuck, v_rejected, v_open, v_oldest
    from public.provider_events;

  select coalesce(jsonb_agg(jsonb_build_object(
           'provider', p.provider,
           'open', p.open,
           'oldest_open_seconds', p.oldest,
           'dead', p.dead,
           'last_received_at', p.last_received) order by p.provider), '[]'::jsonb)
    into v_per
    from (select e.provider,
                 count(*) filter (where e.status in ('received', 'failed', 'processing'))::integer as open,
                 coalesce(floor(extract(epoch from (now() - min(e.received_at) filter (where e.status in ('received', 'failed', 'processing')))))::integer, 0) as oldest,
                 count(*) filter (where e.status = 'dead')::integer as dead,
                 max(e.received_at) as last_received
            from public.provider_events e group by e.provider) p;

  select count(*) filter (where state = 'open'), count(*) filter (where state = 'half_open') into v_breakers_open, v_breakers_half from public.provider_health;

  select count(*), count(*) filter (where first_seen_at < now() - make_interval(hours => v_unsettled)),
         extract(epoch from (now() - min(first_seen_at))) / 3600
    into v_breaks, v_breaks_old, v_oldest_break
    from public.reconciliation_breaks where status = 'open';

  select count(*) filter (where status = 'failed'), count(*) filter (where status = 'skipped') into v_gl_failed, v_gl_skipped from public.payout_gl_postings;

  if v_dead > 0 then v_reasons := v_reasons || (v_dead || ' webhook event(s) gave up after every retry'); end if;
  if v_stuck > 0 then v_reasons := v_reasons || (v_stuck || ' webhook event(s) have waited longer than a retry can take: nothing is draining the inbox (is provider-event-drain scheduled?)'); end if;
  if v_breakers_open > 0 then v_reasons := v_reasons || (v_breakers_open || ' vendor operation(s) are switched off by the circuit breaker'); end if;
  if v_breaks_old > 0 then v_reasons := v_reasons || (v_breaks_old || ' reconciliation break(s) are older than ' || v_unsettled || ' hours'); end if;
  if v_gl_failed + v_gl_skipped > 0 then v_reasons := v_reasons || ((v_gl_failed + v_gl_skipped) || ' payout ledger posting(s) need finance'); end if;

  return jsonb_build_object(
    'generated_at', now(),
    'status', case when cardinality(v_reasons) = 0 then 'ok' else 'attention' end,
    'reasons', to_jsonb(v_reasons),
    'inbox', jsonb_build_object('open', coalesce(v_open, 0), 'oldest_open_seconds', coalesce(floor(v_oldest)::integer, 0), 'dead', coalesce(v_dead, 0),
                                'waiting_too_long', coalesce(v_stuck, 0), 'rejected_24h', coalesce(v_rejected, 0), 'stale_after_seconds', v_stale, 'by_provider', v_per),
    'breakers', jsonb_build_object('open', v_breakers_open, 'half_open', v_breakers_half),
    'reconciliation', jsonb_build_object('open_breaks', v_breaks, 'older_than_limit', v_breaks_old, 'limit_hours', v_unsettled, 'oldest_hours', coalesce(floor(v_oldest_break)::integer, 0)),
    'payout_postings', jsonb_build_object('failed', v_gl_failed, 'skipped', v_gl_skipped)
  );
end;
$$;
revoke all on function public.provider_layer_health() from public, anon;
grant execute on function public.provider_layer_health() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.provider_layer_health()', 'EXECUTE') then raise exception 'p4z: anon must not run provider_layer_health'; end if;
  if not has_function_privilege('authenticated', 'public.provider_layer_health()', 'EXECUTE') then raise exception 'p4z: authenticated must be able to call it (the function checks the role)'; end if;
end $$;
