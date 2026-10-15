-- S10x proof: event bus operations (migrations *_s10x_a_bus_operations.sql and *_s10x_b_partner_webhook_subscriber.sql).
--
-- Proves in one rolled-back transaction:
--   1. Config: version 3 is the single active row; lag floor (120 s) and partner-failure floor (5) are enforced.
--   2. Ordering (opt-in per event type): an ordered type claims only the earliest open delivery per subscriber, patient and aggregate;
--      the next one is released when the earlier completes; a DEAD earlier delivery does not block; an unordered type is unaffected.
--   3. Attempt history: done, retry and dead are recorded; a stale-token completion records nothing.
--   4. Lag alert: one incident per lagging subscriber, none for test events by default, none for urgent events or deliveries still
--      in backoff, no duplicate while open, a new one after resolution; expired leases count; summary names no payload.
--   5. Admin reads: explorer returns payload ids only and no patient_id; status and subscriber views; a clinician is refused;
--      RLS on the new tables; no anon, PUBLIC or authenticated execute on service-only functions.
--   6. partner.webhook: mapping is admin only and creates the subscriber; the envelope is ids only (no patient id, no neutral facts);
--      a test event reaches sandbox endpoints only; idempotent; a removed mapping sends nothing.
--   7. Key rotation: new secret returned once, previous secret kept for the grace window and handed to the drainer, never written to
--      the audit log; inactive endpoints are not claimed.
--   8. Auto-disable: at the configured failure count the endpoint is switched off, one incident opens, re-enable resets it.
--   9. SABOTAGE: with ordering switched off the ordering check must FAIL; with the failure threshold raised the auto-disable check
--      must FAIL. A test that cannot fail is not a test.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;

create or replace function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's10x-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S10x ' || p_label, (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_p uuid; v_admin uuid; v_clin uuid;
  v_agg1 uuid := gen_random_uuid(); v_agg2 uuid := gen_random_uuid();
  e1 uuid; e2 uuid; e3 uuid; e4 uuid; e5 uuid; e6 uuid;
  d1 uuid; d2 uuid; d3 uuid; dfree uuid; l1 uuid; l2 uuid;
  v_tok uuid; v_n integer; v_s text; v_err text; v_arr uuid[]; v_txt text;
  v_partner uuid; v_ep uuid; v_ep_live uuid; v_out uuid; v_old text; v_new text; v_deliv uuid; v_key text;
  v_agg3 uuid := gen_random_uuid(); n1 uuid; n2 uuid; d_tie uuid; v_cid uuid; v_cts timestamptz; v_cur_ts timestamptz; v_cur_id uuid; v_seen integer; i integer; v_q integer;
  v_j1 jsonb; v_j2 jsonb; v_j3 jsonb; v_j4 jsonb;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_p := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_clin := pg_temp.mkuser(v_org, 'clinician', 'clinician');

  update public.event_subscribers set is_active = false where subscriber_key not like 's10x.%';
  update public.domain_event_deliveries set status = 'done', done_at = now(), locked_until = null, lease_token = null;

  -- 1. Config ----------------------------------------------------------------------------------
  insert into results values ('real', 'exactly one active config row', '1', (select count(*)::text from public.event_bus_config where is_active));
  insert into results values ('real', 'the active config is version 3 or later with the lag and partner values',
    'true', (select (version >= 3 and lag_alert_seconds = 600 and partner_disable_after_failures = 20)::text from public.event_bus_config where is_active));
  begin update public.event_bus_config set lag_alert_seconds = 60 where is_active; v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  insert into results values ('real', 'lag alert below the 120 s floor is refused', '23514', v_err);
  begin update public.event_bus_config set partner_disable_after_failures = 4 where is_active; v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  insert into results values ('real', 'auto-disable below 5 failures is refused', '23514', v_err);

  -- 2. Ordering --------------------------------------------------------------------------------
  insert into public.event_types (event_type, description, ordered) values ('s10x.ordered_probe', 'proof only', true), ('s10x.free_probe', 'proof only', false);
  insert into public.event_type_versions (event_type, version, required_keys) values ('s10x.ordered_probe', 1, array['thing_id']), ('s10x.free_probe', 1, array['thing_id']);
  insert into public.event_subscribers (subscriber_key, event_type, handler_key) values
    ('s10x.ord', 's10x.ordered_probe', 'bus.noop'), ('s10x.free', 's10x.free_probe', 'bus.noop');

  e1 := public.emit_domain_event('s10x.ordered_probe', v_org, '{"thing_id":"1"}', 'o1', v_p, 'thing', v_agg1, 'normal', null, null, now() - interval '3 minutes');
  e2 := public.emit_domain_event('s10x.ordered_probe', v_org, '{"thing_id":"2"}', 'o2', v_p, 'thing', v_agg1, 'normal', null, null, now() - interval '2 minutes');
  e3 := public.emit_domain_event('s10x.ordered_probe', v_org, '{"thing_id":"3"}', 'o3', v_p, 'thing', v_agg1, 'normal', null, null, now() - interval '1 minute');
  e4 := public.emit_domain_event('s10x.ordered_probe', v_org, '{"thing_id":"4"}', 'o4', v_p, 'thing', v_agg2, 'normal', null, null, now());
  perform public.emit_domain_event('s10x.free_probe', v_org, '{"thing_id":"f1"}', 'f1', v_p, 'thing', v_agg1, 'normal', null, null, now() - interval '3 minutes');
  perform public.emit_domain_event('s10x.free_probe', v_org, '{"thing_id":"f2"}', 'f2', v_p, 'thing', v_agg1, 'normal', null, null, now() - interval '2 minutes');
  perform public.emit_domain_event('s10x.free_probe', v_org, '{"thing_id":"f3"}', 'f3', v_p, 'thing', v_agg1, 'normal', null, null, now() - interval '1 minute');

  create temp table c1 on commit drop as select * from public.claim_event_deliveries(50, false);
  insert into results values ('real', 'ordered: only the earliest per aggregate and the other aggregate are claimed', 'e1,e4',
    (select string_agg(case event_id when e1 then 'e1' when e2 then 'e2' when e3 then 'e3' when e4 then 'e4' end, ',' order by occurred_at)
       from c1 where subscriber_key in ('s10x.ord')));
  insert into results values ('real', 'unordered: all three are claimed together', '3', (select count(*)::text from c1 where subscriber_key in ('s10x.free')));

  select count(*) into v_n from public.claim_event_deliveries(50, false) c where c.subscriber_key in ('s10x.ord');
  insert into results values ('real', 'ordered: while the first is processing nothing behind it is claimed', '0', v_n::text);

  select delivery_id, lease_token into d1, v_tok from c1 where subscriber_key in ('s10x.ord') and event_id = e1;
  perform public.complete_event_delivery(d1, v_tok);
  create temp table c2 on commit drop as select * from public.claim_event_deliveries(50, false);
  insert into results values ('real', 'ordered: completing the first releases exactly the second', 'e2',
    (select string_agg(case event_id when e2 then 'e2' when e3 then 'e3' else 'other' end, ',') from c2 where subscriber_key in ('s10x.ord')));

  select delivery_id, lease_token into d2, v_tok from c2 where subscriber_key in ('s10x.ord') and event_id = e2;
  perform public.fail_event_delivery(d2, v_tok, 'proof: permanent', true);
  create temp table c3 on commit drop as select * from public.claim_event_deliveries(50, false);
  insert into results values ('real', 'ordered: a DEAD earlier delivery does not block the chain', 'e3',
    (select string_agg(case event_id when e3 then 'e3' else 'other' end, ',') from c3 where subscriber_key in ('s10x.ord')));

  -- 3. Attempt history ------------------------------------------------------------------------
  select delivery_id, lease_token into d3, v_tok from c3 where subscriber_key in ('s10x.ord') and event_id = e3;
  select delivery_id, lease_token into dfree, v_tok from c1 where subscriber_key in ('s10x.free') order by occurred_at limit 1;
  perform public.fail_event_delivery(dfree, v_tok, 'proof: transient', false);
  select lease_token into v_tok from c3 where delivery_id = d3;
  v_s := case when public.complete_event_delivery(d3, gen_random_uuid()) then 'accepted' else 'refused' end;
  insert into results values ('real', 'a stale-token completion is refused', 'refused', v_s);
  insert into results values ('real', 'and records no attempt', '0', (select count(*)::text from public.domain_event_delivery_attempts where delivery_id = d3));
  perform public.complete_event_delivery(d3, v_tok);
  insert into results values ('real', 'attempts: done', 'done', (select string_agg(outcome, ',') from public.domain_event_delivery_attempts where delivery_id = d1));
  insert into results values ('real', 'attempts: dead keeps its error', 'dead|proof: permanent',
    (select outcome || '|' || error from public.domain_event_delivery_attempts where delivery_id = d2));
  insert into results values ('real', 'attempts: retry keeps its error', 'retry|proof: transient',
    (select outcome || '|' || error from public.domain_event_delivery_attempts where delivery_id = dfree));
  insert into results values ('real', 'attempts carry the attempt number', '1', (select attempt_no::text from public.domain_event_delivery_attempts where delivery_id = d1));

  -- Ties and chains: two events emitted in one transaction share occurred_at and created_at; emission order decides. Events with
  -- neither patient nor aggregate form no chain.
  e5 := public.emit_domain_event('s10x.ordered_probe', v_org, '{"thing_id":"t1"}', 'tie1', v_p, 'thing', v_agg3);
  e6 := public.emit_domain_event('s10x.ordered_probe', v_org, '{"thing_id":"t2"}', 'tie2', v_p, 'thing', v_agg3);
  n1 := public.emit_domain_event('s10x.ordered_probe', v_org, '{"thing_id":"n1"}', 'nc1');
  n2 := public.emit_domain_event('s10x.ordered_probe', v_org, '{"thing_id":"n2"}', 'nc2');
  create temp table c4 on commit drop as select * from public.claim_event_deliveries(50, false);
  insert into results values ('real', 'tie: of two events with the same timestamps the first emitted is claimed', 'true|false',
    ((select count(*) from c4 where event_id = e5) = 1)::text || '|' || ((select count(*) from c4 where event_id = e6) = 1)::text);
  insert into results values ('real', 'events with no patient and no aggregate are not held back', '2',
    (select count(*)::text from c4 where event_id in (n1, n2)));
  select delivery_id into d_tie from c4 where event_id = e5;
  update public.domain_event_deliveries set locked_until = now() - interval '1 second' where id = d_tie;
  perform public.claim_event_deliveries(50, false);
  insert into results values ('real', 'a lease that expired is recorded as a lost attempt', 'retry|1|lease expired before the handler reported',
    (select outcome || '|' || attempt_no::text || '|' || error from public.domain_event_delivery_attempts where delivery_id = d_tie));
  update public.domain_event_deliveries set attempt_count = 8, locked_until = now() - interval '1 second' where id = d_tie;
  perform public.claim_event_deliveries(50, false);
  insert into results values ('real', 'a crashed final attempt goes dead and is recorded', 'dead|dead',
    (select d.status || '|' || (select a.outcome from public.domain_event_delivery_attempts a where a.delivery_id = d_tie and a.attempt_no = 8)
       from public.domain_event_deliveries d where d.id = d_tie));
  update public.domain_event_deliveries set status = 'done', done_at = now(), locked_until = null, lease_token = null where status <> 'done';

  -- 9a. SABOTAGE: ordering switched off, the ordered check must now fail --------------------------
  v_arr := array[gen_random_uuid()];
  update public.event_types set ordered = false where event_type = 's10x.ordered_probe';
  e5 := public.emit_domain_event('s10x.ordered_probe', v_org, '{"thing_id":"5a"}', 'o5a', v_p, 'thing', v_arr[1], 'normal', null, null, now() - interval '2 minutes');
  e6 := public.emit_domain_event('s10x.ordered_probe', v_org, '{"thing_id":"6a"}', 'o6a', v_p, 'thing', v_arr[1], 'normal', null, null, now() - interval '1 minute');
  insert into results values ('sabotaged', 'ordering off: chained events are claimed one at a time', '1',
    (select count(*)::text from public.claim_event_deliveries(50, false) c where c.subscriber_key in ('s10x.ord') and c.event_id in (e5, e6)));
  update public.event_types set ordered = true where event_type = 's10x.ordered_probe';
  update public.domain_event_deliveries set status = 'done', done_at = now(), locked_until = null, lease_token = null where status <> 'done';

  -- 4. Lag alert -----------------------------------------------------------------------------
  insert into public.event_types (event_type, description) values ('s10x.lag_probe', 'proof only');
  insert into public.event_types (event_type, description, is_urgent) values ('s10x.lag_urgent', 'proof only', true);
  insert into public.event_type_versions (event_type, version, required_keys) values ('s10x.lag_probe', 1, array['thing_id']), ('s10x.lag_urgent', 1, array['thing_id']);
  insert into public.event_subscribers (subscriber_key, event_type, handler_key) values
    ('s10x.lag', 's10x.lag_probe', 'bus.noop'), ('s10x.lag_fresh', 's10x.lag_probe', 'bus.noop'),
    ('s10x.lag_lease', 's10x.lag_probe', 'bus.noop'), ('s10x.lag_backoff', 's10x.lag_probe', 'bus.noop'),
    ('s10x.lag_urgent', 's10x.lag_urgent', 'bus.noop');
  perform public.emit_domain_event('s10x.lag_probe', v_org, '{"thing_id":"lagsecret","grade":"red","patient_id":"pat-secret"}', 'lag1', v_p);
  perform public.emit_domain_event('s10x.lag_urgent', v_org, '{"thing_id":"lagsecret"}', 'lagu1', v_p);
  update public.domain_event_deliveries set next_attempt_at = now() - interval '2 hours' where subscriber_key in ('s10x.lag', 's10x.lag_urgent');
  update public.domain_event_deliveries set next_attempt_at = now() - interval '1 minute' where subscriber_key in ('s10x.lag_fresh');
  update public.domain_event_deliveries set status = 'processing', lease_token = gen_random_uuid(), locked_until = now() - interval '2 hours', attempt_count = 1
   where subscriber_key in ('s10x.lag_lease');
  update public.domain_event_deliveries set next_attempt_at = now() + interval '1 hour' where subscriber_key in ('s10x.lag_backoff');
  insert into public.domain_event_delivery_attempts (delivery_id, subscriber_key, organisation_id, attempt_no, outcome, created_at)
    select id, subscriber_key, organisation_id, 1, 'done', now() - interval '40 days' from public.domain_event_deliveries where subscriber_key in ('s10x.lag');

  insert into results values ('real', 'lag sweep ignores test events by default', '0', public.event_bus_lag_sweep()::text);
  insert into results values ('real', 'lag sweep (tests included) opens one incident per lagging subscriber: stale, expired lease, stale urgent', '3', public.event_bus_lag_sweep(true)::text);
  insert into results values ('real', 'no incident for fresh or backed-off deliveries', '0',
    (select count(*)::text from public.ops_incidents where external_reference in ('event_bus_lag:s10x.lag_fresh', 'event_bus_lag:s10x.lag_backoff')));
  insert into results values ('real', 'an urgent delivery waiting long opens an incident too', '1',
    (select count(*)::text from public.ops_incidents where external_reference = 'event_bus_lag:s10x.lag_urgent'));
  insert into results values ('real', 'the incident is technical sev3', 'technical|sev3',
    (select category::text || '|' || severity::text from public.ops_incidents where external_reference = 'event_bus_lag:s10x.lag'));
  insert into results values ('real', 'the incident names the subscriber but no payload', 'true',
    (select (summary like '%s10x.lag%' and summary not like '%lagsecret%' and summary not like '%red%')::text from public.ops_incidents where external_reference = 'event_bus_lag:s10x.lag'));
  insert into results values ('real', 'a second sweep adds no duplicate while open', '0', public.event_bus_lag_sweep(true)::text);
  update public.ops_incidents set status = 'resolved', root_cause = 'proof' where external_reference = 'event_bus_lag:s10x.lag';
  insert into results values ('real', 'after resolution the next sweep opens a new one', '1', public.event_bus_lag_sweep(true)::text);
  insert into results values ('real', 'two incidents exist for the subscriber in total', '2', (select count(*)::text from public.ops_incidents where external_reference = 'event_bus_lag:s10x.lag'));
  insert into results values ('real', 'attempt rows older than 30 days are pruned by the sweep', '0',
    (select count(*)::text from public.domain_event_delivery_attempts where created_at < now() - interval '30 days'));

  -- 5. Admin reads, RLS, grants ------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  v_j1 := (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.event_bus_explorer(null, 's10x.lag', null, 50, null) x);
  v_j2 := (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.event_bus_explorer('done', null, null, 200, null) x);
  v_j3 := (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.event_bus_subscriber_status() x);
  v_j4 := (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.event_bus_delivery_attempts(d1) x);
  begin perform * from public.event_bus_explorer('bogus'); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  v_n := (select count(*) from public.domain_event_delivery_attempts);
  v_seen := 0; v_cur_ts := null; v_cur_id := null;
  for i in 1..5 loop
    v_cid := null;
    select x.delivery_id, x.created_at into v_cid, v_cts from public.event_bus_explorer(null, 's10x.free', null, 1, v_cur_ts, v_cur_id) x;
    exit when v_cid is null;
    v_seen := v_seen + 1; v_cur_ts := v_cts; v_cur_id := v_cid;
  end loop;
  reset role;
  insert into results values ('real', 'paging one row at a time over deliveries sharing a timestamp loses none', '3', v_seen::text);
  insert into results values ('real', 'explorer: admin reads the delivery', '1', jsonb_array_length(v_j1)::text);
  insert into results values ('real', 'explorer payload shows ids only, not neutral facts', 'true|false',
    ((v_j1 -> 0 -> 'payload_ids' ? 'thing_id')::text || '|' || (v_j1 -> 0 -> 'payload_ids' ? 'grade')::text));
  insert into results values ('real', 'explorer payload never shows a person id', 'false', (v_j1 -> 0 -> 'payload_ids' ? 'patient_id')::text);
  insert into results values ('real', 'explorer returns no patient_id column', 'true',
    (pg_get_function_result('public.event_bus_explorer(text,text,text,integer,timestamptz,uuid)'::regprocedure) not like '%patient_id%')::text);
  insert into results values ('real', 'explorer status filter holds', '0', (select count(*)::text from jsonb_array_elements(v_j2) e where e ->> 'status' <> 'done'));
  insert into results values ('real', 'explorer rejects an unknown status', '22023', v_err);
  insert into results values ('real', 'attempts view returns the done attempt', 'done', v_j4 -> 0 ->> 'outcome');
  insert into results values ('real', 'subscriber view: ordered subscriber shows a success and a failure time', 'true|true',
    (select ((e ->> 'last_success_at') is not null)::text || '|' || ((e ->> 'last_failure_at') is not null)::text from jsonb_array_elements(v_j3) e where e ->> 'subscriber_key' in ('s10x.ord')));
  insert into results values ('real', 'subscriber view: lagging subscriber shows its open incident and age', 'true|true',
    (select (e ->> 'lag_incident_open') || '|' || ((e ->> 'oldest_due_seconds')::bigint > 3600)::text from jsonb_array_elements(v_j3) e where e ->> 'subscriber_key' in ('s10x.lag')));
  insert into results values ('real', 'subscriber view: fresh subscriber has no incident', 'false',
    (select e ->> 'lag_incident_open' from jsonb_array_elements(v_j3) e where e ->> 'subscriber_key' in ('s10x.lag_fresh')));
  insert into results values ('real', 'admin can read attempts through row security', 'true', (v_n > 0)::text);

  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform * from public.event_bus_explorer(); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  v_s := v_err;
  begin perform * from public.event_bus_subscriber_status(); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  v_txt := v_err;
  begin perform * from public.event_bus_delivery_attempts(d1); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  v_n := (select count(*) from public.domain_event_delivery_attempts) + (select count(*) from public.partner_event_map);
  reset role;
  insert into results values ('real', 'a clinician is refused the explorer', '42501', v_s);
  insert into results values ('real', 'a clinician is refused the subscriber view', '42501', v_txt);
  insert into results values ('real', 'a clinician is refused the attempts view', '42501', v_err);
  insert into results values ('real', 'a clinician sees no attempt or mapping rows', '0', v_n::text);

  insert into results
  select 'real', 'no anon or PUBLIC execute on ' || p.oid::regprocedure::text, 'false',
         (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('public', p.oid, 'EXECUTE'))::text
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('event_bus_lag_sweep', 'event_bus_explorer', 'event_bus_delivery_attempts',
     'event_bus_subscriber_status', 'partner_webhook_enqueue_for_delivery', 'set_partner_event_mapping', 'rotate_partner_webhook_secret',
     'reenable_partner_webhook_endpoint', 'claim_integration_outbound_batch', 'record_integration_delivery_result', 'claim_event_deliveries',
     'complete_event_delivery', 'fail_event_delivery');
  insert into results values ('real', 'authenticated cannot run the service-only functions', 'false',
    (has_function_privilege('authenticated', 'public.event_bus_lag_sweep(boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.partner_webhook_enqueue_for_delivery(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.claim_integration_outbound_batch(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_integration_delivery_result(uuid, boolean, integer, text, integer)', 'EXECUTE'))::text);
  insert into results values ('real', 'new tables have row security and no anon access', '2|false',
    (select count(*)::text from pg_class where relnamespace = 'public'::regnamespace and relrowsecurity and relname in ('domain_event_delivery_attempts', 'partner_event_map'))
    || '|' || (has_table_privilege('anon', 'public.domain_event_delivery_attempts', 'SELECT') or has_table_privilege('anon', 'public.partner_event_map', 'SELECT'))::text);

  -- 6. partner.webhook -------------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.set_partner_event_mapping('lab_result.released', 'result.available', array['lab_result_id']); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  reset role;
  insert into results values ('real', 'a clinician cannot map a bus event to partners', '42501', v_err);

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.set_partner_event_mapping('lab_result.released', 'result.available', array['patient_id']); v_s := 'accepted'; exception when others then v_s := sqlstate; end;
  v_key := public.set_partner_event_mapping('lab_result.released', 'result.available', array['lab_result_id']);
  begin perform public.set_partner_event_mapping('no.such_type', 'result.available'); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  reset role;
  insert into results values ('real', 'a person id cannot be put on the allow-list', '22023', v_s);
  insert into results values ('real', 'mapping creates the subscriber', 'partner.webhook.lab_result_released|partner.webhook|true',
    (select s.subscriber_key || '|' || s.handler_key || '|' || s.is_active::text from public.event_subscribers s where s.subscriber_key = v_key));
  insert into results values ('real', 'mapping an unknown type is refused', '22023', v_err);
  insert into results values ('real', 'mapping is audited', '1', (select count(*)::text from public.audit_log where action = 'event_bus.partner_mapping'));

  insert into public.partner_integrations (organisation_id, name, base_url) values (v_org, 's10x partner', 'https://example.invalid') returning id into v_partner;
  insert into public.partner_webhook_endpoints (organisation_id, partner_integration_id, name, url, secret, event_types, environment)
    values (v_org, v_partner, 's10x sandbox', 'https://example.invalid/hook', repeat('a', 40), array['result.available']::public.integration_event_type[], 'sandbox')
    returning id into v_ep;
  insert into public.partner_webhook_endpoints (organisation_id, partner_integration_id, name, url, secret, event_types, environment)
    values (v_org, v_partner, 's10x live', 'https://example.invalid/live', repeat('b', 40), array['result.available']::public.integration_event_type[], 'live')
    returning id into v_ep_live;

  perform public.emit_domain_event('lab_result.released', v_org, '{"lab_result_id":"lr1","dependent_id":"dep-1","result_value":"HIV positive"}', 'pw1', v_p, 'lab_result', v_agg1);
  select id into v_deliv from public.domain_event_deliveries where subscriber_key = v_key;
  insert into results values ('real', 'the event fans out to the partner subscriber', 'true', (v_deliv is not null)::text);
  insert into results values ('real', 'a test event queues for the sandbox endpoint only', '1', public.partner_webhook_enqueue_for_delivery(v_deliv)::text);
  select id into v_out from public.integration_outbound_events where webhook_endpoint_id = v_ep;
  insert into results values ('real', 'and not for the live endpoint', '0', (select count(*)::text from public.integration_outbound_events where webhook_endpoint_id = v_ep_live));
  insert into results values ('real', 'the envelope holds only ids and routing facts', 'aggregate_id,aggregate_type,bus_event_id,bus_event_type,event_version,ids,occurred_at',
    (select string_agg(k, ',' order by k) from public.integration_outbound_events o, jsonb_object_keys(o.payload) k where o.id = v_out));
  insert into results values ('real', 'ids inside it are the allow-listed keys only (not dependent_id)', 'lab_result_id',
    (select string_agg(k, ',') from public.integration_outbound_events o, jsonb_object_keys(o.payload -> 'ids') k where o.id = v_out));
  insert into results values ('real', 'no patient id and no result text reaches the partner', 'true',
    (select (o.payload::text not like '%' || v_p::text || '%' and o.payload::text not like '%HIV%')::text from public.integration_outbound_events o where o.id = v_out));
  insert into results values ('real', 'queuing again is a no-op (dedupe on the bus event)', '0', public.partner_webhook_enqueue_for_delivery(v_deliv)::text);
  update public.integration_outbound_events set status = 'dead_letter', attempt_count = 8 where id = v_out;
  v_q := public.partner_webhook_enqueue_for_delivery(v_deliv);
  insert into results values ('real', 'replaying the bus delivery puts a dead-lettered partner row back in the queue', '1|pending|0',
    v_q::text || '|' || (select status::text || '|' || attempt_count::text from public.integration_outbound_events where id = v_out));
  begin perform public.partner_webhook_enqueue_for_delivery(gen_random_uuid()); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  insert into results values ('real', 'an unknown delivery raises so the bus retries it', '22023', v_err);

  -- 7. Rotation and claim ---------------------------------------------------------------------------
  select secret into v_old from public.partner_webhook_endpoints where id = v_ep;
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.rotate_partner_webhook_secret(v_ep); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  reset role;
  insert into results values ('real', 'a clinician cannot rotate a secret', '42501', v_err);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.rotate_partner_webhook_secret(v_ep, 0); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  v_new := public.rotate_partner_webhook_secret(v_ep, 24);
  begin perform public.rotate_partner_webhook_secret(v_ep, 24); v_s := 'accepted'; exception when others then v_s := sqlstate; end;
  reset role;
  insert into results values ('real', 'a second rotation inside the grace window is refused', '55000', v_s);
  insert into results values ('real', 'a zero grace period is refused', '22023', v_err);
  insert into results values ('real', 'rotation returns a new 64 character secret', 'true', (length(v_new) = 64 and v_new <> v_old)::text);
  insert into results values ('real', 'the old secret is kept for the grace window and the version moves', 'true|2|true',
    (select (previous_secret = v_old)::text || '|' || signing_key_version::text || '|' || (previous_secret_expires_at > now() + interval '23 hours')::text
       from public.partner_webhook_endpoints where id = v_ep));
  insert into results values ('real', 'the audit log never holds a secret', 'true',
    (select (count(*) = 1 and bool_and(event::text not like '%' || v_new || '%' and event::text not like '%' || v_old || '%'))::text
       from public.audit_log where action = 'integration.webhook.secret_rotated'));

  create temp table k1 on commit drop as select * from public.claim_integration_outbound_batch(25);
  insert into results values ('real', 'the drainer is handed both secrets during the grace window', 'true|2',
    (select (secret = v_new and previous_secret = v_old)::text || '|' || signing_key_version::text from k1 where id = v_out));
  update public.integration_outbound_events set status = 'pending', attempt_count = 0, next_attempt_at = now(), last_attempt_at = null where id = v_out;
  update public.partner_webhook_endpoints set previous_secret_expires_at = now() - interval '1 hour' where id = v_ep;
  create temp table k2 on commit drop as select * from public.claim_integration_outbound_batch(25);
  insert into results values ('real', 'after the grace window the previous secret is no longer handed out', 'true',
    (select (previous_secret is null)::text from k2 where id = v_out));
  update public.integration_outbound_events set status = 'pending', attempt_count = 0, next_attempt_at = now(), last_attempt_at = null where id = v_out;
  update public.partner_webhook_endpoints set is_active = false where id = v_ep;
  insert into results values ('real', 'an inactive endpoint is not claimed', '0', (select count(*)::text from public.claim_integration_outbound_batch(25) where id = v_out));
  update public.partner_webhook_endpoints set is_active = true where id = v_ep;

  -- 8. Auto-disable ---------------------------------------------------------------------------------------
  update public.partner_webhook_endpoints set consecutive_failures = 19 where id = v_ep;
  perform 1 from public.claim_integration_outbound_batch(25) where id = v_out;
  perform public.record_integration_delivery_result(v_out, false, 500, 'proof failure', 10);
  insert into results values ('real', 'the 20th straight failure switches the endpoint off with a reason', 'false|true|20|true',
    (select is_active::text || '|' || (auto_disabled_at is not null)::text || '|' || consecutive_failures::text || '|' || (disabled_reason like 'Switched off automatically%')::text
       from public.partner_webhook_endpoints where id = v_ep));
  perform public.emit_domain_event('lab_result.released', v_org, '{"lab_result_id":"lr2"}', 'pw2', v_p, 'lab_result', v_agg2);
  insert into results values ('real', 'an event emitted while the endpoint is switched off is still queued, not lost', '1',
    public.partner_webhook_enqueue_for_delivery((select id from public.domain_event_deliveries where subscriber_key = v_key
      and event_id = (select id from public.domain_events where idempotency_key in ('pw2'))))::text);
  insert into results values ('real', 'one incident opens, technical sev3', '1|technical|sev3',
    (select count(*)::text || '|' || min(category::text) || '|' || min(severity::text) from public.ops_incidents where external_reference = 'partner_webhook:' || v_ep::text));
  insert into results values ('real', 'the switch-off is audited', '1', (select count(*)::text from public.audit_log where action = 'integration.webhook.auto_disabled' and entity_id = v_ep));
  update public.integration_outbound_events set status = 'pending', attempt_count = 0, next_attempt_at = now(), last_attempt_at = null where id = v_out;
  insert into results values ('real', 'a switched-off endpoint is not claimed', '0', (select count(*)::text from public.claim_integration_outbound_batch(25) where id = v_out));

  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.reenable_partner_webhook_endpoint(v_ep); v_err := 'accepted'; exception when others then v_err := sqlstate; end;
  reset role;
  insert into results values ('real', 'a clinician cannot switch an endpoint back on', '42501', v_err);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.reenable_partner_webhook_endpoint(v_ep);
  reset role;
  insert into results values ('real', 're-enable resets the endpoint', 'true|0|true',
    (select is_active::text || '|' || consecutive_failures::text || '|' || (auto_disabled_at is null and disabled_reason is null)::text from public.partner_webhook_endpoints where id = v_ep));

  update public.partner_webhook_endpoints set consecutive_failures = 19 where id = v_ep;
  perform 1 from public.claim_integration_outbound_batch(25) where id = v_out;
  perform public.record_integration_delivery_result(v_out, false, 500, 'proof failure', 10);
  insert into results values ('real', 'disabling again while the incident is open adds no duplicate', '1',
    (select count(*)::text from public.ops_incidents where external_reference = 'partner_webhook:' || v_ep::text));

  update public.partner_webhook_endpoints set is_active = true where id = v_ep;
  insert into results values ('real', 'switching on by a plain update (the integrations toggle) also clears the automatic switch-off', 'true|0',
    (select (auto_disabled_at is null and disabled_reason is null)::text || '|' || consecutive_failures::text from public.partner_webhook_endpoints where id = v_ep));
  update public.partner_webhook_endpoints set consecutive_failures = 3 where id = v_ep;
  update public.integration_outbound_events set status = 'pending', attempt_count = 0, next_attempt_at = now(), last_attempt_at = null where id = v_out;
  perform 1 from public.claim_integration_outbound_batch(25) where id = v_out;
  perform public.record_integration_delivery_result(v_out, false, 500, 'proof failure', 10);
  insert into results values ('real', 'below the threshold the endpoint stays on', 'true|4',
    (select is_active::text || '|' || consecutive_failures::text from public.partner_webhook_endpoints where id = v_ep));
  update public.integration_outbound_events set status = 'pending', attempt_count = 0, next_attempt_at = now(), last_attempt_at = null where id = v_out;
  perform 1 from public.claim_integration_outbound_batch(25) where id = v_out;
  perform public.record_integration_delivery_result(v_out, true, 200, null, 10);
  insert into results values ('real', 'a success resets the failure count', '0', (select consecutive_failures::text from public.partner_webhook_endpoints where id = v_ep));

  -- 9b. SABOTAGE: threshold raised, the auto-disable check must now fail
  update public.event_bus_config set partner_disable_after_failures = 1000 where is_active;
  update public.partner_webhook_endpoints set consecutive_failures = 19, is_active = true where id = v_ep;
  update public.integration_outbound_events set status = 'pending', attempt_count = 0, next_attempt_at = now(), last_attempt_at = null, delivered_at = null where id = v_out;
  perform 1 from public.claim_integration_outbound_batch(25) where id = v_out;
  perform public.record_integration_delivery_result(v_out, false, 500, 'proof failure', 10);
  insert into results values ('sabotaged', 'threshold raised: the 20th failure switches the endpoint off', 'false',
    (select is_active::text from public.partner_webhook_endpoints where id = v_ep));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S10x proof FAILED on the real migrations: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then
    raise exception 'VACUOUS TEST: expected both sabotages (ordering off, threshold raised) to fail their checks, only % did', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- Sabotaged rows are asserted to FAIL inside the DO block above (a vacuous test raises). They are deliberately not
-- printed: the runner treats any FAIL verdict in the output as a failed proof.

rollback;
