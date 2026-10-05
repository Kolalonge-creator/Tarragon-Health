-- S10 proof: event bus and transactional outbox (migration *_s10_event_bus_and_outbox.sql).
--
-- Proves in one rolled-back transaction:
--   1. Emit: validation (unknown type, unknown or deprecated version, missing required key, bad
--      priority), idempotency (a repeat returns the same event and adds no delivery), is_test
--      carried from the patient, a new event type works with an insert only (Section 18).
--   2. Fan-out: one delivery per matching, active subscriber in the producer's transaction; the
--      version range is honoured; an inactive subscriber and a later subscriber get nothing.
--   3. Exactly once: claims never overlap while a lease holds, urgent first, a done delivery is
--      never claimed again, the batch limit holds.
--   4. Leases: a stale or wrong token cannot complete or fail; an expired lease is reclaimed
--      (crash recovery) and the old token is then refused; an expired lease at the attempt limit
--      goes to the dead letter, not to another run.
--   5. Retry: backoff grows and is capped (with jitter), max attempts and a permanent failure go
--      dead, the error text is kept.
--   6. Replay: admin only, audited, resets the delivery; effects make a replay safe, and
--      p_redo_effects clears them. Requeue of dead letters is admin only and audited.
--   7. Health RPC counts; append only events; RLS (patient and clinician see nothing, admin reads);
--      no anon or PUBLIC execute on any function; the processor RPCs are not callable by
--      authenticated.
--   8. SABOTAGE: with the lease-token check removed from complete, the stale-token check must FAIL.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;

create or replace function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's10-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S10 ' || p_label, (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_p uuid; v_admin uuid; v_clin uuid;
  v_e1 uuid; v_e1b uuid; v_e2 uuid; v_e3 uuid; v_eu uuid; v_ev2 uuid;
  v_n integer; v_n2 integer; v_t text; v_rows integer;
  v_d record; v_c record; v_ids uuid[];
  v_lease uuid; v_status text; v_delay numeric; v_ok boolean; v_err text;
  v_dlv uuid; v_h jsonb; v_org2 uuid; v_p2 uuid; v_buf text[] := '{}';
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_p := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_clin := pg_temp.mkuser(v_org, 'clinician', 'clinician');

  -- Subscribers: two on observation.recorded (v1 only, v1 and later), one inactive, one on another type.
  insert into public.event_subscribers (subscriber_key, event_type, handler_key, min_version, max_version) values
    ('s10.a', 'observation.recorded', 'bus.noop', 1, 1),
    ('s10.b', 'observation.recorded', 'bus.noop', 1, null),
    ('s10.v2only', 'observation.recorded', 'bus.noop', 2, null),
    ('s10.page', 'page.unacknowledged', 'bus.noop', 1, null);
  insert into public.event_subscribers (subscriber_key, event_type, handler_key, min_version, is_active) values
    ('s10.off', 'observation.recorded', 'bus.noop', 1, false);

  -- 1. Emit ---------------------------------------------------------------------------------
  v_e1 := public.emit_domain_event('observation.recorded', v_org, '{"observation_id":"abc"}', 'k1', v_p);
  v_e1b := public.emit_domain_event('observation.recorded', v_org, '{"observation_id":"abc"}', 'k1', v_p);
  insert into results values ('real', 'a repeated idempotency key returns the same event', 'true', (v_e1 = v_e1b)::text);
  select count(*) into v_n from public.domain_events where event_type = 'observation.recorded' and idempotency_key = 'k1';
  insert into results values ('real', 'and stores one row', '1', v_n::text);
  select count(*) into v_n from public.domain_event_deliveries where event_id = v_e1;
  insert into results values ('real', 'fan-out: two matching active subscribers (not v2only, not off)', '2', v_n::text);
  insert into results values ('real', 'is_test is carried from the patient', 'true',
    (select is_test::text from public.domain_events where id = v_e1));

  begin perform public.emit_domain_event('no.such_type', v_org, '{}', 'x'); v_err := 'accepted';
  exception when others then v_err := sqlstate; end;
  insert into results values ('real', 'unknown type refused', '22023', v_err);
  begin perform public.emit_domain_event('observation.recorded', v_org, '{"observation_id":"a"}', 'x2', null, null, null, 'normal', 7); v_err := 'accepted';
  exception when others then v_err := sqlstate; end;
  insert into results values ('real', 'unknown version refused', '22023', v_err);
  begin perform public.emit_domain_event('observation.recorded', v_org, '{"other":"a"}', 'x3'); v_err := 'accepted';
  exception when others then v_err := sqlstate; end;
  insert into results values ('real', 'missing required key refused', '22023', v_err);
  begin perform public.emit_domain_event('observation.recorded', v_org, '{"observation_id":"a"}', 'x4', null, null, null, 'rush'); v_err := 'accepted';
  exception when others then v_err := sqlstate; end;
  insert into results values ('real', 'bad priority refused', '22023', v_err);
  begin perform public.emit_domain_event('observation.recorded', v_org, to_jsonb(repeat('x', 9000)), 'x5'); v_err := 'accepted';
  exception when others then v_err := sqlstate; end;
  insert into results values ('real', 'non-object payload refused', '22023', v_err);
  begin perform public.emit_domain_event('observation.recorded', v_org, jsonb_build_object('observation_id', repeat('x', 9000)), 'x6'); v_err := 'accepted';
  exception when others then v_err := sqlstate; end;
  insert into results values ('real', 'oversize payload refused', '23514', v_err);

  -- Section 18: a brand new event type and version is an insert, then it emits and fans out.
  insert into public.event_types (event_type, description) values ('s10.demo_new', 'proof only');
  insert into public.event_type_versions (event_type, version, required_keys) values ('s10.demo_new', 1, array['thing_id']);
  insert into public.event_subscribers (subscriber_key, event_type, handler_key) values ('s10.demo', 's10.demo_new', 'bus.noop');
  v_e3 := public.emit_domain_event('s10.demo_new', v_org, '{"thing_id":"1"}', 'n1');
  insert into results values ('real', 'a new event type needs no schema change and fans out', '1',
    (select count(*)::text from public.domain_event_deliveries where event_id = v_e3));

  -- Version 2 of an existing type (range honoured), and a deprecated version is refused.
  insert into public.event_type_versions (event_type, version, required_keys) values ('observation.recorded', 2, array['observation_id', 'unit']);
  v_ev2 := public.emit_domain_event('observation.recorded', v_org, '{"observation_id":"a","unit":"mmHg"}', 'v2a', v_p, null, null, 'normal', 2);
  insert into results values ('real', 'version 2 reaches the open-ended subscribers, not the v1-only one', 's10.b,s10.v2only',
    (select string_agg(subscriber_key, ',' order by subscriber_key) from public.domain_event_deliveries where event_id = v_ev2));
  update public.event_type_versions set deprecated_at = now() where event_type = 'observation.recorded' and version = 2;
  begin perform public.emit_domain_event('observation.recorded', v_org, '{"observation_id":"a","unit":"mmHg"}', 'v2b', null, null, null, 'normal', 2); v_err := 'accepted';
  exception when others then v_err := sqlstate; end;
  insert into results values ('real', 'a deprecated version is refused', '22023', v_err);

  -- A subscriber added later gets nothing from past events.
  insert into public.event_subscribers (subscriber_key, event_type, handler_key) values ('s10.late', 'observation.recorded', 'bus.noop');
  insert into results values ('real', 'a later subscriber does not receive earlier events', '0',
    (select count(*)::text from public.domain_event_deliveries where subscriber_key = 's10.late'));

  -- 3. Exactly once -------------------------------------------------------------------------
  -- Park everything so far, then build a clean set of 5 events x 1 subscriber ('s10.page' is urgent only).
  update public.domain_event_deliveries set status = 'done', done_at = now();
  for i in 1..5 loop
    perform public.emit_domain_event('observation.recorded', v_org, jsonb_build_object('observation_id', i::text), 'batch' || i, v_p);
  end loop;
  update public.event_subscribers set is_active = false where subscriber_key in ('s10.b');
  -- The batch fanned out to s10.a, s10.b and s10.late; only s10.a's five stay pending.
  update public.domain_event_deliveries set status = 'done', done_at = now() where subscriber_key <> 's10.a';
  select count(*) into v_n from public.domain_event_deliveries where status = 'pending';
  insert into results values ('real', 'five pending deliveries for the batch', '5', v_n::text);

  select array_agg(delivery_id) into v_ids from public.claim_event_deliveries(3, false);
  insert into results values ('real', 'first claim takes the batch limit', '3', cardinality(v_ids)::text);
  select count(*) into v_n from public.claim_event_deliveries(10, false) c where c.delivery_id = any (v_ids);
  insert into results values ('real', 'a second claim never returns a leased delivery', '0', v_n::text);
  select count(*) into v_n2 from public.domain_event_deliveries where status = 'processing';
  insert into results values ('real', 'the second claim took the other two (5 leased in all)', '5', v_n2::text);
  insert into results values ('real', 'a third claim finds nothing', '0', (select count(*)::text from public.claim_event_deliveries(10, false)));

  -- complete each exactly once with its own token
  v_n := 0;
  for v_d in select id, lease_token from public.domain_event_deliveries where status = 'processing' loop
    if public.complete_event_delivery(v_d.id, v_d.lease_token) then v_n := v_n + 1; end if;
    if public.complete_event_delivery(v_d.id, v_d.lease_token) then v_n := v_n + 100; end if;
  end loop;
  insert into results values ('real', 'each delivery completes once; a second completion is refused', '5', v_n::text);
  insert into results values ('real', 'a done delivery is never claimed again', '0', (select count(*)::text from public.claim_event_deliveries(50, false)));

  -- urgent first, and urgent_only filters
  update public.domain_event_deliveries set status = 'done', done_at = now() where status <> 'done';
  perform public.emit_domain_event('observation.recorded', v_org, '{"observation_id":"n"}', 'urg-n', v_p);
  v_eu := public.emit_domain_event('page.unacknowledged', v_org, '{"page_id":"p"}', 'urg-p', v_p);
  insert into results values ('real', 'page.unacknowledged is urgent by type', 'urgent', (select priority from public.domain_events where id = v_eu));
  select event_type into v_t from public.claim_event_deliveries(1, false);
  insert into results values ('real', 'urgent events are claimed first', 'page.unacknowledged', v_t);
  update public.domain_event_deliveries set status = 'pending', locked_until = null, lease_token = null where status = 'processing';
  select count(*) into v_n from public.claim_event_deliveries(10, true) where priority = 'urgent';
  insert into results values ('real', 'urgent_only returns only urgent', '1', v_n::text);
  update public.domain_event_deliveries set status = 'done', done_at = now();

  -- 4. Leases ---------------------------------------------------------------------------------
  v_e2 := public.emit_domain_event('observation.recorded', v_org, '{"observation_id":"lease"}', 'lease1', v_p);
  update public.domain_event_deliveries set status = 'done', done_at = now() where subscriber_key <> 's10.a' and event_id = v_e2;
  select delivery_id, lease_token into v_dlv, v_lease from public.claim_event_deliveries(1, false);
  insert into results values ('real', 'a wrong token cannot complete', 'false', public.complete_event_delivery(v_dlv, gen_random_uuid())::text);
  insert into results values ('real', 'a wrong token cannot fail it either', 'stale', public.fail_event_delivery(v_dlv, gen_random_uuid(), 'x'));
  -- crash recovery: the lease expires, another worker reclaims, the first worker's token is dead
  update public.domain_event_deliveries set locked_until = now() - interval '1 second' where id = v_dlv;
  select count(*) into v_n from public.claim_event_deliveries(5, false) where delivery_id = v_dlv;
  insert into results values ('real', 'an expired lease is reclaimed', '1', v_n::text);
  insert into results values ('real', 'the old worker can no longer complete it', 'false', public.complete_event_delivery(v_dlv, v_lease)::text);
  insert into results values ('real', 'the reclaim counted a second attempt', '2', (select attempt_count::text from public.domain_event_deliveries where id = v_dlv));
  -- expired lease on the final attempt goes dead rather than running again
  update public.domain_event_deliveries set attempt_count = 8, locked_until = now() - interval '1 second' where id = v_dlv;
  select count(*) into v_n from public.claim_event_deliveries(5, false) where delivery_id = v_dlv;
  insert into results values ('real', 'expired lease at the attempt limit is not run again', '0', v_n::text);
  insert into results values ('real', 'it is dead with a reason', 'dead|lease expired at the attempt limit',
    (select status || '|' || last_error from public.domain_event_deliveries where id = v_dlv));

  -- 5. Retry and backoff -----------------------------------------------------------------------
  update public.domain_event_deliveries set status = 'pending', attempt_count = 0, next_attempt_at = now(), last_error = null where id = v_dlv;
  select delivery_id, lease_token into v_dlv, v_lease from public.claim_event_deliveries(1, false);
  v_status := public.fail_event_delivery(v_dlv, v_lease, 'boom');
  select extract(epoch from next_attempt_at - now()) into v_delay from public.domain_event_deliveries where id = v_dlv;
  insert into results values ('real', 'first failure retries', 'pending', v_status);
  insert into results values ('real', 'first backoff is 15s plus up to 20 percent', 'true', (v_delay between 14 and 18.5)::text);
  insert into results values ('real', 'error text kept', 'boom', (select last_error from public.domain_event_deliveries where id = v_dlv));
  insert into results values ('real', 'not claimable before its time', '0', (select count(*)::text from public.claim_event_deliveries(5, false) where delivery_id = v_dlv));
  -- attempt 4 -> 15 * 2^3 = 120..144
  update public.domain_event_deliveries set status = 'processing', attempt_count = 4, lease_token = v_lease, locked_until = now() + interval '60 seconds' where id = v_dlv;
  perform public.fail_event_delivery(v_dlv, v_lease, 'again');
  select extract(epoch from next_attempt_at - now()) into v_delay from public.domain_event_deliveries where id = v_dlv;
  insert into results values ('real', 'backoff doubles', 'true', (v_delay between 119 and 145)::text);
  -- attempt 7 -> would be 960, capped at 900..1080
  update public.domain_event_deliveries set status = 'processing', attempt_count = 7, lease_token = v_lease, locked_until = now() + interval '60 seconds' where id = v_dlv;
  perform public.fail_event_delivery(v_dlv, v_lease, 'again');
  select extract(epoch from next_attempt_at - now()) into v_delay from public.domain_event_deliveries where id = v_dlv;
  insert into results values ('real', 'backoff is capped at 900s plus jitter', 'true', (v_delay between 899 and 1081)::text);
  -- attempt 8 = max -> dead
  update public.domain_event_deliveries set status = 'processing', attempt_count = 8, lease_token = v_lease, locked_until = now() + interval '60 seconds' where id = v_dlv;
  insert into results values ('real', 'failing at max attempts goes dead', 'dead', public.fail_event_delivery(v_dlv, v_lease, 'last'));
  -- permanent failure goes dead on the first attempt
  v_e2 := public.emit_domain_event('observation.recorded', v_org, '{"observation_id":"perm"}', 'perm1', v_p);
  update public.domain_event_deliveries set status = 'done', done_at = now() where subscriber_key <> 's10.a' and event_id = v_e2;
  select delivery_id, lease_token into v_dlv, v_lease from public.claim_event_deliveries(1, false);
  insert into results values ('real', 'a permanent failure goes dead at once', 'dead', public.fail_event_delivery(v_dlv, v_lease, 'no handler', true));

  -- 6. Effects, replay, requeue ----------------------------------------------------------------
  insert into results values ('real', 'an effect records the first time', 'true', public.record_event_effect(v_dlv, v_dlv || ':notify')::text);
  insert into results values ('real', 'the effect carries the delivery''s organisation', 'true',
    (select (e.organisation_id = dl.organisation_id)::text from public.event_effects e join public.domain_event_deliveries dl on dl.id = e.delivery_id where e.effect_key = v_dlv || ':notify'));
  insert into results values ('real', 'and not the second (replay safe)', 'false', public.record_event_effect(v_dlv, v_dlv || ':notify')::text);
  insert into results values ('real', 'releasing an effect lets the retry run it again', 'true,true',
    public.release_event_effect(v_dlv, v_dlv || ':notify')::text || ',' || public.record_event_effect(v_dlv, v_dlv || ':notify')::text);
  insert into results values ('real', 'release does nothing for another delivery', 'false', public.release_event_effect(gen_random_uuid(), v_dlv || ':notify')::text);

  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin perform public.replay_event_delivery(v_dlv); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  v_buf := v_buf || ('a clinician cannot replay' || '|' || '42501' || '|' || coalesce(v_err, 'null'));
  begin perform public.requeue_dead_event_deliveries('s10.a'); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  v_buf := v_buf || ('a clinician cannot requeue' || '|' || '42501' || '|' || coalesce(v_err, 'null'));
  begin perform public.event_bus_health(); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  v_buf := v_buf || ('a clinician cannot read bus health' || '|' || '42501' || '|' || coalesce(v_err, 'null'));
  v_buf := v_buf || ('a clinician sees no events or deliveries' || '|' || '0' || '|' || coalesce(((select count(*) from public.domain_events) + (select count(*) from public.domain_event_deliveries))::text, 'null'));
  begin perform public.claim_event_deliveries(1, false); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  v_buf := v_buf || ('authenticated cannot call the processor claim' || '|' || '42501' || '|' || coalesce(v_err, 'null'));
  begin perform public.emit_domain_event('observation.recorded', v_org, '{"observation_id":"z"}', 'z1'); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  v_buf := v_buf || ('authenticated cannot emit' || '|' || '42501' || '|' || coalesce(v_err, 'null'));
  begin perform public.record_event_effect(v_dlv, 'q'); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  v_buf := v_buf || ('authenticated cannot record an effect' || '|' || '42501' || '|' || coalesce(v_err, 'null'));
  begin update public.domain_event_deliveries set status = 'done'; get diagnostics v_rows = row_count; v_err := v_rows::text; exception when others then v_err := sqlstate; end;
  v_buf := v_buf || ('authenticated cannot write deliveries' || '|' || '42501' || '|' || coalesce(v_err, 'null'));
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_buf := v_buf || ('an admin reads events' || '|' || 'true' || '|' || coalesce(((select count(*) from public.domain_events) > 0)::text, 'null'));
  v_ok := public.replay_event_delivery(v_dlv, false);
  v_buf := v_buf || ('admin replays a dead delivery' || '|' || 'true' || '|' || coalesce(v_ok::text, 'null'));
  reset role;
  insert into results values ('real', 'replay resets it and counts', 'pending|0|1',
    (select status || '|' || attempt_count || '|' || replay_count from public.domain_event_deliveries where id = v_dlv));
  insert into results values ('real', 'replay keeps effects (a repeat is skipped)', 'false', public.record_event_effect(v_dlv, v_dlv || ':notify')::text);
  insert into results values ('real', 'replay is audited', '1',
    (select count(*)::text from public.audit_log where action = 'event_bus.replay' and entity_id = v_dlv));
  set local role authenticated;
  perform public.replay_event_delivery(v_dlv, true);
  reset role;
  insert into results values ('real', 'redo_effects clears them', 'true', public.record_event_effect(v_dlv, v_dlv || ':notify')::text);

  update public.domain_event_deliveries set status = 'dead' where id = v_dlv;
  set local role authenticated;
  v_n := public.requeue_dead_event_deliveries('s10.a', 10);
  reset role;
  insert into results values ('real', 'admin requeues dead letters for a subscriber', 'true', (v_n >= 1)::text);
  insert into results values ('real', 'requeue is audited', 'true',
    ((select count(*) from public.audit_log where action = 'event_bus.requeue_dead') = 1)::text);

  set local role authenticated;
  v_h := public.event_bus_health();
  reset role;
  insert into results values ('real', 'health reports counts', 'true', (v_h ? 'pending' and v_h ? 'dead_urgent' and (v_h ->> 'pending')::int >= 1)::text);

  insert into results select 'real', split_part(x, '|', 1), split_part(x, '|', 2), split_part(x, '|', 3) from unnest(v_buf) x;

  -- Dead urgent delivery opens one ops incident per subscriber; a normal event's dead letter opens none.
  select count(*) into v_n from public.ops_incidents where external_reference like 'event_bus:s10.%';
  insert into results values ('real', 'earlier dead normal deliveries opened no incident', '0', v_n::text);
  v_eu := public.emit_domain_event('page.unacknowledged', v_org, '{"page_id":"dead1"}', 'dead-urg-1', v_p);
  select delivery_id, lease_token into v_dlv, v_lease from public.claim_event_deliveries(1, true);
  perform public.fail_event_delivery(v_dlv, v_lease, 'handler bug', true);
  insert into results values ('real', 'a dead urgent delivery opens a sev2 technical incident', 'technical|sev2|1',
    (select category::text || '|' || severity::text || '|' || count(*)::text from public.ops_incidents
      where external_reference = 'event_bus:s10.page' group by category, severity));
  insert into results values ('real', 'the incident names no patient or payload', 'true',
    (select (summary not like '%dead1%' and summary like '%s10.page%')::text from public.ops_incidents where external_reference = 'event_bus:s10.page'));
  v_eu := public.emit_domain_event('page.unacknowledged', v_org, '{"page_id":"dead2"}', 'dead-urg-2', v_p);
  select delivery_id, lease_token into v_dlv, v_lease from public.claim_event_deliveries(1, true);
  perform public.fail_event_delivery(v_dlv, v_lease, 'handler bug', true);
  insert into results values ('real', 'a second dead delivery for the same subscriber adds no duplicate', '1',
    (select count(*)::text from public.ops_incidents where external_reference = 'event_bus:s10.page'));
  -- crash path: lease expired at the attempt limit also raises it (after resolving the first)
  update public.ops_incidents set status = 'resolved', root_cause = 'proof' where external_reference = 'event_bus:s10.page';
  v_eu := public.emit_domain_event('page.unacknowledged', v_org, '{"page_id":"dead3"}', 'dead-urg-3', v_p);
  select delivery_id into v_dlv from public.claim_event_deliveries(1, true);
  update public.domain_event_deliveries set attempt_count = 8, locked_until = now() - interval '1 second' where id = v_dlv;
  perform public.claim_event_deliveries(1, true);
  insert into results values ('real', 'a crashed final attempt on an urgent event opens a new incident once the old one is resolved', '2',
    (select count(*)::text from public.ops_incidents where external_reference = 'event_bus:s10.page'));
  update public.domain_event_deliveries set status = 'done', done_at = now() where status <> 'done';

  -- Org check and erasure.
  insert into public.organisations (name, type) select 'S10 Other Org', type from public.organisations where id = v_org returning id into v_org2;
  begin perform public.emit_domain_event('observation.recorded', v_org2, '{"observation_id":"x"}', 'wrongorg', v_p); v_err := 'accepted';
  exception when others then v_err := sqlstate; end;
  insert into results values ('real', 'an event for a patient of another organisation is refused', '22023', v_err);
  v_p2 := pg_temp.mkuser(v_org, 'erased', 'patient');
  v_ev2 := public.emit_domain_event('observation.recorded', v_org, '{"observation_id":"gone"}', 'erase1', v_p2);
  -- A full account delete is exercised by the platform's own purge path (other tables' triggers can
  -- interfere in a fixture); here we prove the two halves: the FK nulls, and the trigger allows exactly that.
  insert into results values ('real', 'the patient foreign key is ON DELETE SET NULL', 'n',
    (select confdeltype::text from pg_constraint where conrelid = 'public.domain_events'::regclass and contype = 'f'
        and conkey = (select array_agg(attnum) from pg_attribute where attrelid = 'public.domain_events'::regclass and attname = 'patient_id')));
  update public.domain_events set patient_id = null where id = v_ev2;
  insert into results values ('real', 'the erasure update (patient_id to null only) is allowed and the event survives', 'true',
    (select (patient_id is null and payload ->> 'observation_id' = 'gone')::text from public.domain_events where id = v_ev2));
  begin update public.domain_events set payload = '{}'::jsonb, patient_id = null where id = v_e1; v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  insert into results values ('real', 'nulling patient_id together with another change is still refused', '55000', v_err);

  -- 7. Append only, grants ----------------------------------------------------------------------
  begin update public.domain_events set payload = '{}'::jsonb where id = v_e1; v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  insert into results values ('real', 'events cannot be updated', '55000', v_err);
  begin delete from public.domain_events where id = v_e1; v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  insert into results values ('real', 'events cannot be deleted', '55000', v_err);
  begin truncate public.domain_events cascade; v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  insert into results values ('real', 'events cannot be truncated', '55000', v_err);

  insert into results
  select 'real', 'no anon or PUBLIC execute on ' || p.oid::regprocedure::text, 'false',
         (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('public', p.oid, 'EXECUTE'))::text
    from pg_proc p
   where (p.pronamespace = 'public'::regnamespace and p.proname in ('emit_domain_event', 'claim_event_deliveries', 'complete_event_delivery',
            'fail_event_delivery', 'record_event_effect', 'release_event_effect', 'replay_event_delivery', 'requeue_dead_event_deliveries', 'event_bus_health'))
      or (p.pronamespace = 'private'::regnamespace and p.proname in ('emit_domain_event', 'event_bus_setting'));
  insert into results values ('real', 'anon has no table access', 'false',
    (has_table_privilege('anon', 'public.domain_events', 'SELECT') or has_table_privilege('anon', 'public.domain_event_deliveries', 'SELECT'))::text);
  insert into results values ('real', 'authenticated has no write on any bus table', 'false',
    (has_table_privilege('authenticated', 'public.domain_events', 'INSERT') or has_table_privilege('authenticated', 'public.domain_event_deliveries', 'UPDATE')
     or has_table_privilege('authenticated', 'public.event_subscribers', 'INSERT'))::text);
  insert into results values ('real', 'every bus table has row security', '7',
    (select count(*)::text from pg_class where relnamespace = 'public'::regnamespace and relrowsecurity
        and relname in ('event_types', 'event_type_versions', 'domain_events', 'event_subscribers', 'domain_event_deliveries', 'event_effects', 'event_bus_config')));
  insert into results values ('real', 'exactly one active config row', '1', (select count(*)::text from public.event_bus_config where is_active));
  insert into results values ('real', 'the 13 spec event types are seeded', '13',
    (select count(*)::text from public.event_types where event_type in ('observation.recorded','triage.graded','dose.recorded','dose.missed','silence.detected',
      'lab_result.received','lab_result.released','encounter.completed','care_plan_change.signed','order.paid','entitlement.expiring','clinician.task_completed','page.unacknowledged')));

  -- 8. SABOTAGE: remove the lease-token check from complete, the stale-token check must now fail -
  v_e2 := public.emit_domain_event('observation.recorded', v_org, '{"observation_id":"sab"}', 'sab1', v_p);
  update public.domain_event_deliveries set status = 'done', done_at = now() where subscriber_key <> 's10.a' and event_id = v_e2;
  select delivery_id, lease_token into v_dlv, v_lease from public.claim_event_deliveries(1, false);
  create or replace function public.complete_event_delivery(p_delivery_id uuid, p_lease_token uuid) returns boolean
  language plpgsql security definer set search_path = '' as $s$
  declare v_rows integer;
  begin
    update public.domain_event_deliveries set status = 'done', done_at = now() where id = p_delivery_id and status = 'processing';
    get diagnostics v_rows = row_count;
    return v_rows = 1;
  end $s$;
  insert into results values ('sabotaged', 'a wrong token cannot complete', 'false', public.complete_event_delivery(v_dlv, gen_random_uuid())::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S10 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught = 0 then
    raise exception 'VACUOUS TEST: removing the lease token check did not fail the stale-token check';
  end if;
end $$;

select phase, check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- The sabotaged row is asserted to FAIL inside the DO block above (a vacuous test raises). It is
-- deliberately not printed: the runner treats any FAIL verdict in the output as a failed proof.

rollback;
