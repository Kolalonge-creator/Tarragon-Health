-- S14x proof: provider event inbox, settlement reconciliation break queue, provider circuit breaker health
-- (migration *_s14x_provider_inbox_reconciliation_health.sql).
--
-- Proves in one rolled-back transaction:
--   1. Config and flags: one active config row; the four new flags are off.
--   2. Inbox: a verified event is stored as received; a duplicate delivery is ONE row (delivery count goes up) and is claimed and
--      processed once; a different body under the same key keeps the first body; a bad signature is stored as 'rejected' under a
--      body-hash key (a flood of the same forged body is one row), is never claimable, never swept, never replayable; the raw body
--      cannot be updated, deleted or truncated; failed events back off but a provider redelivery may retry them; an exhausted event
--      goes dead; an expired lease is reclaimed; two events arriving in the reverse of their natural order are both claimable.
--   3. Replay: admin only, reason required, audited, resets a processed event for dispatch, refused while in flight.
--   4. Reconciliation: matching charge, amount mismatch, missing in ledger, settlement total mismatch, unsettled charge. Breaks do not
--      stack on a second run, a later matching report clears them, closing needs a note and is audited, nothing is posted to the GL.
--   5. Circuit breaker: opens at the threshold, one probe after the open window, a failed probe re-opens, a good probe closes;
--      provider_health_v is admin only.
--   6. Privileges: nothing service-only is executable by anon or authenticated.
--   9. SABOTAGE: with the unique key dropped the duplicate check must FAIL; with the failure threshold raised the breaker check
--      must FAIL. A test that cannot fail is not a test.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;

create or replace function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's14x-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S14x ' || p_label, (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;

-- Runs one statement as an authenticated user; returns the first column or 'ERR:<sqlstate>'.
create or replace function pg_temp.as_user(p_uid uuid, p_sql text) returns text
language plpgsql as $f$
declare r text;
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  return coalesce(r, 'null');
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_clin uuid;
  j jsonb; j2 jsonb; v_id uuid; v_id2 uuid; v_tok uuid; v_tok2 uuid; v_n integer; v_s text; v_t timestamptz;
  v_rej uuid; v_fail uuid; v_oo1 uuid; v_oo2 uuid; v_rep uuid;
  v_gl_before integer; v_gl_after integer; v_rep1 uuid; v_rep2 uuid; v_brk uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_clin := pg_temp.mkuser(v_org, 'clinician', 'clinician');

  -- 1. Config and flags --------------------------------------------------------------------------
  insert into results values ('real', 'exactly one active provider_layer_config row', '1', (select count(*)::text from public.provider_layer_config where is_active));
  insert into results values ('real', 'the four new flags exist and are off', '4', (select count(*)::text from public.feature_flags
    where key in ('provider_inbox_paystack', 'provider_circuit_breaker', 'payout_batch_maker_checker', 'payout_gl_posting') and status = 'off'));

  -- 2. Inbox -------------------------------------------------------------------------------------
  j := public.record_provider_event('paystack', 'charge.success', 'charge.success:s14x-ref-1', '{"event":"charge.success","data":{"reference":"s14x-ref-1"}}', true);
  v_id := (j ->> 'id')::uuid;
  insert into results values ('real', 'a verified event is stored as received and is new', 'received|false', (j ->> 'status') || '|' || (j ->> 'duplicate'));
  j2 := public.record_provider_event('paystack', 'charge.success', 'charge.success:s14x-ref-1', '{"event":"charge.success","data":{"reference":"s14x-ref-1"}}', true);
  insert into results values ('real', 'a duplicate delivery is the same row and is flagged', 'true|true', ((j2 ->> 'id')::uuid = v_id)::text || '|' || (j2 ->> 'duplicate'));
  insert into results values ('real', 'duplicate deliveries are ONE row', '1', (select count(*)::text from public.provider_events where idempotency_key = 'charge.success:s14x-ref-1'));
  insert into results values ('real', 'the delivery count went up', '2', (select delivery_count::text from public.provider_events where id = v_id));
  j2 := public.record_provider_event('paystack', 'charge.success', 'charge.success:s14x-ref-1', '{"event":"charge.success","data":{"reference":"s14x-ref-1","tampered":true}}', true);
  insert into results values ('real', 'a different body under the same key is flagged and the first body is kept', 'true|false',
    (j2 ->> 'body_differs') || '|' || (select (raw_body like '%tampered%')::text from public.provider_events where id = v_id));

  v_tok := public.claim_provider_event(v_id);
  insert into results values ('real', 'the first claim returns a lease', 'true', (v_tok is not null)::text);
  insert into results values ('real', 'a second claim while the lease is live returns nothing', 'null', coalesce(public.claim_provider_event(v_id)::text, 'null'));
  insert into results values ('real', 'a stale token cannot complete it', 'false', public.complete_provider_event(v_id, gen_random_uuid(), 'order', 'o-1')::text);
  v_s := public.complete_provider_event(v_id, v_tok, 'order', 'o-1')::text;
  insert into results values ('real', 'the right token completes it and links the entity', 'true|processed|order',
    v_s || '|' || (select status || '|' || linked_entity_type from public.provider_events where id = v_id));
  perform public.record_provider_event('paystack', 'charge.success', 'charge.success:s14x-ref-1', '{"event":"charge.success","data":{"reference":"s14x-ref-1"}}', true);
  insert into results values ('real', 'a third delivery after processing is not claimable: processed once', 'null|1',
    coalesce(public.claim_provider_event(v_id)::text, 'null') || '|' || (select attempt_count::text from public.provider_events where id = v_id));

  -- bad signature
  j := public.record_provider_event('paystack', 'charge.success', 'charge.success:s14x-forged', '{"event":"charge.success","data":{"reference":"s14x-forged"}}', false);
  v_rej := (j ->> 'id')::uuid;
  insert into results values ('real', 'a bad signature is stored as rejected, unverified', 'rejected|false', (j ->> 'status') || '|' || (j ->> 'verified'));
  insert into results values ('real', 'its key is the body hash, not the claimed key', 'true', (select (idempotency_key like 'unverified:%' and idempotency_key <> 'charge.success:s14x-forged')::text from public.provider_events where id = v_rej));
  perform public.record_provider_event('paystack', 'charge.success', 'charge.success:s14x-forged', '{"event":"charge.success","data":{"reference":"s14x-forged"}}', false);
  insert into results values ('real', 'the same forged body again is still one row', '1|2',
    (select count(*)::text || '|' || max(delivery_count)::text from public.provider_events where content_sha256 = (select content_sha256 from public.provider_events where id = v_rej)));
  insert into results values ('real', 'a rejected event is never claimable', 'null', coalesce(public.claim_provider_event(v_rej)::text, 'null'));
  insert into results values ('real', 'a rejected event is never swept', '0', (select count(*)::text from public.claim_provider_events(100) where id = v_rej));
  insert into results values ('real', 'a rejected event cannot be replayed even by an admin', 'ERR:23514',
    pg_temp.as_user(v_admin, format($q$select public.replay_provider_event(%L, 'proof: replaying a forged event')::text$q$, v_rej)));

  -- immutability
  begin update public.provider_events set raw_body = 'changed' where id = v_id; v_s := 'accepted'; exception when others then v_s := sqlstate; end;
  insert into results values ('real', 'the raw body cannot be updated', '42501', v_s);
  begin update public.provider_events set signature_verified = false, status = 'rejected' where id = v_id; v_s := 'accepted'; exception when others then v_s := sqlstate; end;
  insert into results values ('real', 'the signature result cannot be flipped', '42501', v_s);
  begin delete from public.provider_events where id = v_id; v_s := 'accepted'; exception when others then v_s := sqlstate; end;
  insert into results values ('real', 'a row cannot be deleted', '42501', v_s);
  begin truncate public.provider_events; v_s := 'accepted'; exception when others then v_s := sqlstate; end;
  insert into results values ('real', 'the table cannot be truncated', '42501', v_s);

  -- failure, backoff, redelivery, dead
  j := public.record_provider_event('zoom', 'meeting.ended', 'meeting.ended:s14x-m1:100', '{"event":"meeting.ended"}', true);
  v_fail := (j ->> 'id')::uuid;
  v_tok := public.claim_provider_event(v_fail);
  v_s := public.fail_provider_event(v_fail, v_tok, 'proof: transient', false);
  insert into results values ('real', 'a transient failure goes to failed with a later retry time', 'failed|true',
    v_s || '|' || (select (next_attempt_at > now())::text from public.provider_events where id = v_fail));
  insert into results values ('real', 'the sweeper does not take a failed event before it is due', '0', (select count(*)::text from public.claim_provider_events(100) where id = v_fail));
  v_tok := public.claim_provider_event(v_fail);
  insert into results values ('real', 'a provider redelivery may retry a failed event now', 'true|2', (v_tok is not null)::text || '|' || (select attempt_count::text from public.provider_events where id = v_fail));
  insert into results values ('real', 'a permanent failure goes dead', 'dead', public.fail_provider_event(v_fail, v_tok, 'proof: permanent', true));
  insert into results values ('real', 'a dead event is not claimable', 'null', coalesce(public.claim_provider_event(v_fail)::text, 'null'));

  -- attempt limit
  j := public.record_provider_event('resend', 'email.delivered', 'svix:s14x-limit', '{"type":"email.delivered"}', true);
  v_id2 := (j ->> 'id')::uuid;
  update public.provider_events set attempt_count = 8 where id = v_id2;
  v_s := coalesce(public.claim_provider_event(v_id2)::text, 'null');
  insert into results values ('real', 'an event at the attempt limit is not claimed and goes dead', 'null|dead',
    v_s || '|' || (select status from public.provider_events where id = v_id2));

  -- out of order: the later event arrives first
  v_oo2 := (public.record_provider_event('paystack', 'transfer.reversed', 'transfer.reversed:s14x-trf', '{"event":"transfer.reversed"}', true) ->> 'id')::uuid;
  v_oo1 := (public.record_provider_event('paystack', 'transfer.success', 'transfer.success:s14x-trf', '{"event":"transfer.success"}', true) ->> 'id')::uuid;
  create temp table swept on commit drop as select * from public.claim_provider_events(100);
  insert into results values ('real', 'two events that arrive in reverse order are both stored and both claimable', '2',
    (select count(*)::text from swept where id in (v_oo1, v_oo2)));
  -- expired lease is reclaimed
  update public.provider_events set locked_until = now() - interval '1 second' where id = v_oo1;
  select count(*) into v_n from public.claim_provider_events(100) where id = v_oo1;
  insert into results values ('real', 'an expired lease is reclaimed with a higher attempt count', '1|2',
    v_n::text || '|' || (select attempt_count::text from public.provider_events where id = v_oo1));
  insert into results values ('real', 'the sweeper result does not include a raw body for rejected events (none are returned)', '0', (select count(*)::text from public.claim_provider_events(100) where id = v_rej));

  -- 3. Replay ------------------------------------------------------------------------------------
  insert into results values ('real', 'a clinician cannot replay', 'ERR:42501', pg_temp.as_user(v_clin, format($q$select public.replay_provider_event(%L, 'proof: not allowed to do this')::text$q$, v_id)));
  insert into results values ('real', 'a replay needs a reason', 'ERR:22023', pg_temp.as_user(v_admin, format($q$select public.replay_provider_event(%L, 'short')::text$q$, v_id)));
  insert into results values ('real', 'an admin replays a processed event', 'true', pg_temp.as_user(v_admin, format($q$select public.replay_provider_event(%L, 'proof: handler was fixed, reprocess it')::text$q$, v_id)));
  insert into results values ('real', 'the replayed event is reset for dispatch and counted', 'received|1|0',
    (select status || '|' || replay_count || '|' || attempt_count from public.provider_events where id = v_id));
  insert into results values ('real', 'the replay is audited', '1', (select count(*)::text from public.audit_log where action = 'provider_event.replay' and entity_id = v_id));
  v_tok := public.claim_provider_event(v_id);
  insert into results values ('real', 'the replayed event can be claimed again', 'true', (v_tok is not null)::text);
  insert into results values ('real', 'a replay of an event that is in flight is refused', 'ERR:55P03', pg_temp.as_user(v_admin, format($q$select public.replay_provider_event(%L, 'proof: should be refused now')::text$q$, v_id)));
  perform public.complete_provider_event(v_id, v_tok);
  insert into results values ('real', 'the admin list never returns a raw body column', 'false',
    (pg_get_function_result('public.list_provider_events(text,text,integer)'::regprocedure) like '%raw_body%')::text);
  insert into results values ('real', 'a clinician cannot list the inbox', 'ERR:42501', pg_temp.as_user(v_clin, $q$select count(*)::text from public.list_provider_events()$q$));
  insert into results values ('real', 'an admin can list it', 'true', (pg_temp.as_user(v_admin, $q$select count(*)::text from public.list_provider_events()$q$)::int > 0)::text);
  perform pg_temp.as_user(v_admin, format($q$select public.get_provider_event(%L)::text$q$, v_id));
  insert into results values ('real', 'reading a raw body is audited', '1', (select count(*)::text from public.audit_log where action = 'provider_event.read_raw' and entity_id = v_id));
  insert into results values ('real', 'no client can read the inbox table directly, not even an admin (the raw body is read only through the audited function)', 'ERR:42501|ERR:42501',
    pg_temp.as_user(v_clin, $q$select count(*)::text from public.provider_events$q$) || '|' || pg_temp.as_user(v_admin, $q$select count(*)::text from public.provider_events$q$));
  -- purge: only rejected rows older than the window; never a verified one; not below seven days
  begin perform public.purge_rejected_provider_events(3); v_s := 'accepted'; exception when others then v_s := sqlerrm; end;
  insert into results values ('real', 'purge refuses a window under seven days', 'provider_event_purge_window_too_short', v_s);
  set local session_replication_role = replica;
  update public.provider_events set received_at = now() - interval '40 days' where id in (v_rej, v_id);
  set local session_replication_role = origin;
  v_n := public.purge_rejected_provider_events(30);
  insert into results values ('real', 'purge removes the old rejected row only', '1|1|0', v_n::text || '|' || (select count(*)::text from public.provider_events where id = v_id) || '|' || (select count(*)::text from public.provider_events where id = v_rej));
  begin delete from public.provider_events where id = v_id; v_s := 'accepted'; exception when others then v_s := sqlstate; end;
  insert into results values ('real', 'a verified old row still cannot be deleted by anything', '42501', v_s);

  -- 4. Reconciliation ----------------------------------------------------------------------------
  select count(*) into v_gl_before from public.finance_journal_entries;
  set local session_replication_role = replica;
  insert into public.payment_transactions (provider, provider_event_id, event_type, amount_minor, currency, raw_payload)
  values ('paystack', 's14x-led-a', 'charge.success', 500000, 'NGN', '{}'), ('paystack', 's14x-led-b', 'charge.success', 700000, 'NGN', '{}');
  insert into public.payments (organisation_id, order_id, provider_reference, amount_kobo, fee_kobo, total_kobo, status, source, verified_at, is_test)
  values (v_org, gen_random_uuid(), 's14x-led-c', 900000, 0, 900000, 'success', 'webhook', now() - interval '100 hours', false);
  set local session_replication_role = origin;

  v_rep1 := public.record_settlement_report('s14x-set-1', 'success', 1300000, 20000, now() - interval '1 day',
    '[{"reference":"s14x-led-a","amount_kobo":500000,"fees_kobo":7500,"status":"success"},
      {"reference":"s14x-led-b","amount_kobo":650000,"fees_kobo":9000,"status":"success"},
      {"reference":"s14x-led-x","amount_kobo":100000,"fees_kobo":1500,"status":"success"}]'::jsonb, true);
  insert into results values ('real', 'recording the same settlement again is idempotent', 'true|3',
    (public.record_settlement_report('s14x-set-1', 'success', 1300000, 20000, now() - interval '1 day', '[{"reference":"s14x-led-a","amount_kobo":500000,"fees_kobo":7500,"status":"success"}]'::jsonb, true) = v_rep1)::text
    || '|' || (select count(*)::text from public.settlement_lines where report_id = v_rep1));
  j := public.reconcile_settlement_report(v_rep1);
  insert into results values ('real', 'one line matches and three breaks open', '1|3', (j ->> 'matched') || '|' || (j ->> 'open_breaks'));
  insert into results values ('real', 'the mismatch records both sides and the difference', '650000|700000|-50000',
    (select provider_amount_kobo || '|' || ledger_amount_kobo || '|' || difference_kobo from public.reconciliation_breaks where provider_reference = 's14x-led-b' and break_type = 'amount_mismatch'));
  insert into results values ('real', 'a charge Paystack settled that we do not have is a break', '1',
    (select count(*)::text from public.reconciliation_breaks where provider_reference = 's14x-led-x' and break_type = 'missing_in_ledger' and status = 'open'));
  insert into results values ('real', 'a settlement whose total is not its lines is a break', '1',
    (select count(*)::text from public.reconciliation_breaks where provider_reference = 's14x-set-1' and break_type = 'settlement_total_mismatch'));
  perform public.reconcile_settlement_report(v_rep1);
  insert into results values ('real', 'a second run does not stack breaks', '3', (select count(*)::text from public.reconciliation_breaks where status = 'open' and provider_reference like 's14x-%'));
  insert into results values ('real', 'an old paid charge no settlement lists is a break', '1', public.reconcile_unsettled_charges(now())::text);
  perform public.reconcile_unsettled_charges(now());
  insert into results values ('real', 'still exactly one open missing_at_provider break', '1', (select count(*)::text from public.reconciliation_breaks where break_type = 'missing_at_provider' and provider_reference = 's14x-led-c' and status = 'open'));
  v_rep2 := public.record_settlement_report('s14x-set-2', 'success', 900000, 10000, now(), '[{"reference":"s14x-led-c","amount_kobo":900000,"fees_kobo":10000,"status":"success"}]'::jsonb, true);
  perform public.reconcile_settlement_report(v_rep2);
  insert into results values ('real', 'a later report that lists it clears the unsettled break', 'cleared',
    (select status from public.reconciliation_breaks where break_type = 'missing_at_provider' and provider_reference = 's14x-led-c'));
  select count(*) into v_gl_after from public.finance_journal_entries;
  insert into results values ('real', 'reconciliation posted nothing to the general ledger', '0', (v_gl_after - v_gl_before)::text);

  insert into results values ('real', 'a clinician cannot read the break queue', 'ERR:42501', pg_temp.as_user(v_clin, $q$select count(*)::text from public.reconciliation_break_queue()$q$));
  insert into results values ('real', 'the queue shows ageing for an admin', 'true',
    (pg_temp.as_user(v_admin, $q$select count(*)::text from public.reconciliation_break_queue('open') where ageing_bucket like 'under_%' and age_hours >= 0$q$)::int >= 3)::text);
  select id into v_brk from public.reconciliation_breaks where provider_reference = 's14x-led-x' and status = 'open';
  update public.reconciliation_breaks set first_seen_at = now() - interval '200 hours' where id = v_brk;
  insert into results values ('real', 'a break older than the last bucket is over_168h', 'over_168h',
    pg_temp.as_user(v_admin, format($q$select ageing_bucket from public.reconciliation_break_queue('open') where id = %L$q$, v_brk)));
  insert into results values ('real', 'closing a break needs a note', 'ERR:22023', pg_temp.as_user(v_admin, format($q$select public.close_reconciliation_break(%L, 'explained', 'short')::text$q$, v_brk)));
  insert into results values ('real', 'a clinician cannot close a break', 'ERR:42501', pg_temp.as_user(v_clin, format($q$select public.close_reconciliation_break(%L, 'explained', 'proof: not allowed to close')::text$q$, v_brk)));
  insert into results values ('real', 'an admin closes it with a note', 'true', pg_temp.as_user(v_admin, format($q$select public.close_reconciliation_break(%L, 'explained', 'proof: paid by a bank transfer outside Paystack')::text$q$, v_brk)));
  insert into results values ('real', 'closing again does nothing', 'false', pg_temp.as_user(v_admin, format($q$select public.close_reconciliation_break(%L, 'resolved', 'proof: closing a second time')::text$q$, v_brk)));
  insert into results values ('real', 'closing is audited', '1', (select count(*)::text from public.audit_log where action = 'reconciliation_break.explained' and entity_id = v_brk));
  insert into results values ('real', 'a clinician sees no settlement rows', '0', pg_temp.as_user(v_clin, $q$select count(*)::text from public.settlement_reports$q$));

  -- 5. Circuit breaker ---------------------------------------------------------------------------
  insert into results values ('real', 'an unknown operation is allowed', 'true', (public.provider_call_allowed('paystack', 'initialize') ->> 'allowed'));
  for i in 1..4 loop perform public.provider_record_result('paystack', 'initialize', false, 'network'); end loop;
  v_s := (public.provider_call_allowed('paystack', 'initialize') ->> 'allowed');
  insert into results values ('real', 'four failures keep it closed', 'closed|true', (select state from public.provider_health where provider = 'paystack' and operation = 'initialize') || '|' || v_s);
  insert into results values ('real', 'the fifth failure opens it', 'open', public.provider_record_result('paystack', 'initialize', false, 'timeout'));
  insert into results values ('real', 'an open breaker refuses calls', 'false', (public.provider_call_allowed('paystack', 'initialize') ->> 'allowed'));
  update public.provider_health set opened_at = now() - interval '61 seconds' where provider = 'paystack' and operation = 'initialize';
  v_s := (public.provider_call_allowed('paystack', 'initialize') ->> 'allowed');
  insert into results values ('real', 'after the open window one probe is allowed (half open)', 'true|half_open', v_s || '|' || (select state from public.provider_health where provider = 'paystack' and operation = 'initialize'));
  insert into results values ('real', 'a second caller in the same window is refused', 'false', (public.provider_call_allowed('paystack', 'initialize') ->> 'allowed'));
  insert into results values ('real', 'a failed probe re-opens it', 'open', public.provider_record_result('paystack', 'initialize', false, 'network'));
  update public.provider_health set opened_at = now() - interval '61 seconds' where provider = 'paystack' and operation = 'initialize';
  perform public.provider_call_allowed('paystack', 'initialize');
  v_s := public.provider_record_result('paystack', 'initialize', true);
  insert into results values ('real', 'a good probe closes it and resets the count', 'closed|0', v_s || '|' || (select consecutive_failures::text from public.provider_health where provider = 'paystack' and operation = 'initialize'));
  perform public.provider_record_result('resend', 'send', false, 'network');
  insert into results values ('real', 'provider_health_v: admin sees degraded and healthy', 'degraded|healthy',
    pg_temp.as_user(v_admin, $q$select status from public.provider_health_v where provider = 'resend'$q$) || '|' || pg_temp.as_user(v_admin, $q$select status from public.provider_health_v where provider = 'paystack'$q$));
  insert into results values ('real', 'provider_health_v: a clinician sees nothing', '0', pg_temp.as_user(v_clin, $q$select count(*)::text from public.provider_health_v$q$));

  -- 6. Privileges ----------------------------------------------------------------------------------
  insert into results values ('real', 'no client role can execute a service-only function', '0',
    (select count(*)::text from (values ('public.record_provider_event(text,text,text,text,boolean)'), ('public.claim_provider_event(uuid)'), ('public.claim_provider_events(integer)'),
       ('public.complete_provider_event(uuid,uuid,text,text)'), ('public.fail_provider_event(uuid,uuid,text,boolean)'), ('public.provider_call_allowed(text,text)'),
       ('public.provider_record_result(text,text,boolean,text)'), ('public.record_settlement_report(text,text,bigint,bigint,timestamptz,jsonb,boolean)'),
       ('public.reconcile_settlement_report(uuid)'), ('public.reconcile_unsettled_charges(timestamptz)')) f(fn)
      where has_function_privilege('anon', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE')));
  insert into results values ('real', 'anon cannot execute the admin functions either', '0',
    (select count(*)::text from (values ('public.replay_provider_event(uuid,text)'), ('public.list_provider_events(text,text,integer)'), ('public.get_provider_event(uuid)'),
       ('public.reconciliation_break_queue(text,integer)'), ('public.close_reconciliation_break(uuid,text,text)')) f(fn) where has_function_privilege('anon', fn, 'EXECUTE')));

  -- 9a. SABOTAGE: the unique key dropped, a duplicate delivery must now produce a second row ----------
  alter table public.provider_events drop constraint provider_events_provider_idempotency_key_key;
  insert into public.provider_events (provider, event_type, idempotency_key, raw_body, content_sha256, signature_verified, status)
  select 'paystack', 'charge.success', 'charge.success:s14x-sab', '{"a":1}', repeat('a', 64), true, 'received' from generate_series(1, 2);
  insert into results values ('sabotaged', 'duplicate deliveries are ONE row (unique key dropped)', '1',
    (select count(*)::text from public.provider_events where idempotency_key = 'charge.success:s14x-sab'));

  -- 9b. SABOTAGE: breaker threshold raised, the fifth failure must no longer open it --------------
  update public.provider_layer_config set rules = jsonb_set(rules, '{circuit,failureThreshold}', '50') where is_active;
  for i in 1..5 loop perform public.provider_record_result('zoom', 'create_room', false, 'network'); end loop;
  insert into results values ('sabotaged', 'the fifth failure opens it (threshold raised)', 'open', (select state from public.provider_health where provider = 'zoom' and operation = 'create_room'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S14x proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then
    raise exception 'VACUOUS TEST: expected both sabotages (unique key dropped, threshold raised) to fail their checks, only % did', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
