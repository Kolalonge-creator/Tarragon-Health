-- S31x proof: payout reversal after success, general ledger posting for payouts, payout batch maker-checker with limits
-- (migration *_s31x_payout_reversal_gl_and_batch_controls.sql). One rolled-back transaction. Proves:
--   1. Reversal after success: success posts Dr 5200 / Cr 1000, a replayed success posts nothing twice, transfer.reversed after the
--      success flips the payout to reversed and posts the exact opposite NEW entry (net zero per account), a replayed reversal posts
--      nothing twice, the original entry is untouched, the clinician statement says "paid then returned", a second attempt posts under
--      its own key.
--   2. Out of order: a reversal that arrives before the success leaves the payout reversed, posts nothing, and the late success is ignored.
--   3. With the posting flag off no entry is posted but the state still changes.
--   4. A closed accounting period never blocks the state change: the posting is recorded as failed, and the retry posts it once the
--      period is open again.
--   5. Batch maker-checker (flag on): refused while the flag is off; a clinician cannot propose; the maker cannot release or reject their
--      own batch; a different approver releases it; a payout is sent only from a released batch of the current transfer attempt; per-payout,
--      per-clinician, per-batch total and per-batch count limits refuse; a batch that pays the checker is refused; a payout that changed
--      since proposal sinks the batch; a released batch never changes.
--   6. SABOTAGE: the limit check replaced by a no-op and the posting flag switched off; the oversized-payout check and the reversal-posting
--      check must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
-- one statement as a user: first column on success, otherwise the error message (the migration raises coded messages)
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; r := coalesce(r, 'ok'); exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.jq(p_uid uuid, p_sql text) returns jsonb language plpgsql as
$f$ declare t text := pg_temp.q_as(p_uid, p_sql);
begin
  if t like 'ERR:%' then raise exception 'fixture call failed: % (%)', t, left(p_sql, 80); end if;
  return t::jsonb;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's31x-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S31x ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S31x ' || p_label, 'MDCN', 'S31x-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      'senior_medical_officer'::public.doctor_tier, 'contracted'::public.staff_employment_type, 2, true, p_admin, true);
  return v;
end $f$;
-- a payout in a given state with one transfer attempt, written the way the payout functions would (guards are off in replica mode)
create function pg_temp.mkpay(p_org uuid, p_doc uuid, p_approver uuid, p_kobo bigint, p_state text, p_day integer default 0, p_ref text default null) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid(); v_cfg uuid; r text := coalesce(p_ref, 'tpo-' || replace(v::text, '-', '') || '-01');
begin
  select id into v_cfg from public.payouts_config where is_active;
  set local session_replication_role = replica;
  insert into public.payouts (id, organisation_id, clinician_id, period_start, period_end, amount_kobo, line_count, state, recipient_code, payouts_config_id, approved_by, approved_at, is_test)
  values (v, p_org, p_doc, date '2026-01-05' + p_day, date '2026-01-11' + p_day, p_kobo, 1, p_state, 'RCP_proof', v_cfg, p_approver, now(), false);
  insert into public.payout_transfers (payout_id, attempt, reference, state) values (v, 1, r, case p_state when 'sent' then 'sent' else 'pending' end);
  set local session_replication_role = origin;
  return v;
end $f$;
create function pg_temp.ref(p_payout uuid, p_attempt integer default 1) returns text language sql as
$$ select reference from public.payout_transfers where payout_id = p_payout and attempt = p_attempt $$;
create function pg_temp.entries(p_payout uuid) returns integer language sql as
$$ select count(*)::integer from public.payout_gl_postings where payout_id = p_payout and status = 'posted' $$;
create function pg_temp.net(p_account text) returns bigint language sql as
$$ select coalesce(sum(l.debit_minor - l.credit_minor), 0)::bigint from public.finance_journal_lines l
     join public.finance_journal_entries e on e.id = l.entry_id where l.account_code = p_account and e.source in ('payout', 'payout_reversal') $$;
create function pg_temp.guard_on() returns void language plpgsql as
$f$ begin
  create or replace function private.go_live_guard_on(p_key text) returns boolean language sql stable security definer set search_path = ''
  as 'select true';
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_admin2 uuid; v_doc uuid; v_doc2 uuid; v_pay uuid; v_pay2 uuid; v_o uuid; v_o2 uuid; v_c uuid; v_d uuid;
  v_batch uuid; v_s text; r jsonb; v_e1 uuid; v_e2 uuid; v_ids uuid[]; i integer; v_gl_n integer; v_cfg uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin1', 'admin');
  v_admin2 := pg_temp.mkuser(v_org, 'admin2', 'admin');
  v_doc := pg_temp.mkdoc(v_org, 'doc1', v_admin);
  v_doc2 := pg_temp.mkdoc(v_org, 'doc2', v_admin);
  -- payees must not be test accounts (INV-13): the payout code refuses a test payee, so the payees here are made real for this rolled-back run
  update public.profiles set is_test = false where id in (v_doc, v_doc2, v_admin2);
  update public.clinical_staff set is_test = false where profile_id in (v_doc, v_doc2);
  perform pg_temp.guard_on();

  -- 0. Config and flags -----------------------------------------------------------------------------
  perform pg_temp.ck('one active payout_controls_config row', '1', (select count(*)::text from public.payout_controls_config where is_active));
  perform pg_temp.ck('the two new flags are off', '2', (select count(*)::text from public.feature_flags where key in ('payout_batch_maker_checker', 'payout_gl_posting') and status = 'off'));
  perform pg_temp.ck('account 5200 exists as an expense', 'expense', (select account_type::text from public.finance_accounts where code = '5200'));

  -- 1. Reversal after success -----------------------------------------------------------------------
  update public.feature_flags set status = 'on' where key = 'payout_gl_posting';
  v_pay := pg_temp.mkpay(v_org, v_doc, v_admin, 1200000, 'sent', 0);
  r := public.apply_payout_transfer_event('transfer.success', pg_temp.ref(v_pay), 'TRF_proof1', null);
  perform pg_temp.ck('success moves the payout to succeeded', 'applied|succeeded', (r ->> 'result') || '|' || (select state from public.payouts where id = v_pay));
  perform pg_temp.ck('success posted one entry', '1', pg_temp.entries(v_pay)::text);
  perform pg_temp.ck('the entry is Dr 5200 / Cr 1000 for the payout amount', '1200000|1200000',
    (select sum(l.debit_minor) filter (where l.account_code = '5200') || '|' || sum(l.credit_minor) filter (where l.account_code = '1000')
       from public.payout_gl_postings g join public.finance_journal_lines l on l.entry_id = g.journal_entry_id where g.payout_id = v_pay and g.kind = 'sent'));
  r := public.apply_payout_transfer_event('transfer.success', pg_temp.ref(v_pay), 'TRF_proof1', null);
  perform pg_temp.ck('a replayed success is a duplicate and posts nothing more', 'duplicate|1', (r ->> 'result') || '|' || pg_temp.entries(v_pay)::text);
  select id into v_e1 from public.finance_journal_entries where source = 'payout' and source_ref = 'payout:' || v_pay || ':1:sent' limit 1;
  r := public.apply_payout_transfer_event('transfer.reversed', pg_temp.ref(v_pay), 'TRF_proof1', 'returned by the bank');
  perform pg_temp.ck('a reversal after the success is applied', 'applied|reversed', (r ->> 'result') || '|' || (select state from public.payouts where id = v_pay));
  perform pg_temp.ck('the reversal posted its own entry', '2', pg_temp.entries(v_pay)::text);
  perform pg_temp.ck('the reversal is the exact opposite (net zero per account for this payout)', '0|0',
    (select coalesce(sum(l.debit_minor - l.credit_minor) filter (where l.account_code = '5200'), 0) || '|' || coalesce(sum(l.debit_minor - l.credit_minor) filter (where l.account_code = '1000'), 0)
       from public.payout_gl_postings g join public.finance_journal_lines l on l.entry_id = g.journal_entry_id where g.payout_id = v_pay));
  perform pg_temp.ck('the original entry is untouched', 'true', (exists (select 1 from public.finance_journal_entries where id = v_e1 and source = 'payout'))::text);
  perform pg_temp.ck('the reversal entry has its own source', '1', (select count(*)::text from public.finance_journal_entries where source = 'payout_reversal' and source_ref = 'payout:' || v_pay || ':1:reversal'));
  r := public.apply_payout_transfer_event('transfer.reversed', pg_temp.ref(v_pay), 'TRF_proof1', 'returned by the bank');
  perform pg_temp.ck('a replayed reversal is a duplicate and posts nothing more', 'duplicate|2', (r ->> 'result') || '|' || pg_temp.entries(v_pay)::text);
  perform pg_temp.ck('the audit log records the reversal after a success', '1', (select count(*)::text from public.audit_log where action = 'payout.reversed_after_success' and entity_id = v_pay));
  perform pg_temp.ck('the payout history says it followed a success', 'true', (exists (select 1 from public.payout_events where payout_id = v_pay and to_state = 'reversed' and detail like '%after a success%'))::text);
  perform pg_temp.ck('the clinician statement says paid then returned', 'true',
    pg_temp.q_as(v_doc, $q$select (public.my_payout_overview() -> 'payouts' -> 0 ->> 'paid_then_returned')$q$));
  -- a second attempt posts under its own key
  set local session_replication_role = replica;
  insert into public.payout_transfers (payout_id, attempt, reference) values (v_pay, 2, 'tpo-' || replace(v_pay::text, '-', '') || '-02');
  update public.payouts set state = 'sent' where id = v_pay;
  set local session_replication_role = origin;
  r := public.apply_payout_transfer_event('transfer.success', pg_temp.ref(v_pay, 2), 'TRF_proof2', null);
  perform pg_temp.ck('attempt 2 success posts its own entry', 'applied|3', (r ->> 'result') || '|' || pg_temp.entries(v_pay)::text);
  perform pg_temp.ck('and a late reversal of the OLD attempt does not move the payout or post', 'older_attempt|3', (public.apply_payout_transfer_event('transfer.reversed', pg_temp.ref(v_pay, 1), null, null) ->> 'result') || '|' || pg_temp.entries(v_pay)::text);

  -- 2. Out of order ---------------------------------------------------------------------------------
  v_o := pg_temp.mkpay(v_org, v_doc, v_admin, 700000, 'sent', 7);
  select count(*) into v_gl_n from public.finance_journal_entries where source in ('payout', 'payout_reversal');
  r := public.apply_payout_transfer_event('transfer.reversed', pg_temp.ref(v_o), null, null);
  perform pg_temp.ck('a reversal before any success flips a sent payout to reversed', 'applied|reversed', (r ->> 'result') || '|' || (select state from public.payouts where id = v_o));
  r := public.apply_payout_transfer_event('transfer.success', pg_temp.ref(v_o), null, null);
  perform pg_temp.ck('the late success is ignored', 'out_of_order|reversed', (r ->> 'result') || '|' || (select state from public.payouts where id = v_o));
  perform pg_temp.ck('and nothing was posted for it', '0', (select count(*) - v_gl_n from public.finance_journal_entries where source in ('payout', 'payout_reversal'))::text);

  -- 3. Flag off: state changes, nothing posts ---------------------------------------------------------
  update public.feature_flags set status = 'off' where key = 'payout_gl_posting';
  v_c := pg_temp.mkpay(v_org, v_doc, v_admin, 300000, 'sent', 14);
  r := public.apply_payout_transfer_event('transfer.success', pg_temp.ref(v_c), null, null);
  perform pg_temp.ck('flag off: the payout still succeeds', 'applied|succeeded|0', (r ->> 'result') || '|' || (select state from public.payouts where id = v_c) || '|' || pg_temp.entries(v_c)::text);
  r := public.apply_payout_transfer_event('transfer.reversed', pg_temp.ref(v_c), null, null);
  perform pg_temp.ck('flag off: a reversal still flips the state', 'applied|reversed|0', (r ->> 'result') || '|' || (select state from public.payouts where id = v_c) || '|' || pg_temp.entries(v_c)::text);

  -- 4. Closed period never blocks the state change --------------------------------------------------
  update public.feature_flags set status = 'on' where key = 'payout_gl_posting';
  insert into public.finance_periods (period_month, status) values (date_trunc('month', (now() at time zone 'Africa/Lagos'))::date, 'closed')
    on conflict (period_month) do update set status = 'closed';
  v_d := pg_temp.mkpay(v_org, v_doc, v_admin, 400000, 'sent', 21);
  r := public.apply_payout_transfer_event('transfer.success', pg_temp.ref(v_d), null, null);
  perform pg_temp.ck('closed period: the payout still succeeds', 'applied|succeeded', (r ->> 'result') || '|' || (select state from public.payouts where id = v_d));
  perform pg_temp.ck('closed period: the posting is recorded as failed with the reason', 'failed|true',
    (select status || '|' || (error like '%closed%')::text from public.payout_gl_postings where payout_id = v_d and kind = 'sent'));
  update public.finance_periods set status = 'open' where period_month = date_trunc('month', (now() at time zone 'Africa/Lagos'))::date;
  v_s := pg_temp.q_as(v_admin, 'select public.retry_failed_payout_gl_postings() >= 1');
  perform pg_temp.ck('retry: an admin retries and it posts', 'true|posted', v_s || '|' || (select status from public.payout_gl_postings where payout_id = v_d and kind = 'sent'));
  perform pg_temp.ck('retry: running it again posts nothing more', '1', (select count(*)::text from public.finance_journal_entries where source_ref = 'payout:' || v_d || ':1:sent'));
  perform pg_temp.ck('retry: a clinician cannot', 'ERR:payout_not_authorised', pg_temp.q_as(v_doc, 'select public.retry_failed_payout_gl_postings()::text'));

  -- 5. Batch maker-checker ---------------------------------------------------------------------------
  v_pay := pg_temp.mkpay(v_org, v_doc, v_admin, 100000000, 'approved', 28);
  perform pg_temp.ck('flag off: proposing a batch is refused', 'ERR:payout_batch_control_off', pg_temp.q_as(v_admin, format($q$select public.propose_payout_batch(array[%L]::uuid[])::text$q$, v_pay)));
  perform pg_temp.ck('flag off: sending works as before (no batch needed)', 'true', (pg_temp.q_as(v_admin, format($q$select (public.payout_prepare_send(%L) ->> 'reference') is not null$q$, v_pay)) = 'true')::text);
  update public.feature_flags set status = 'on' where key = 'payout_batch_maker_checker';
  perform pg_temp.ck('flag on: a payout not in a released batch cannot be sent', 'ERR:payout_batch_required', pg_temp.q_as(v_admin, format($q$select public.payout_prepare_send(%L)::text$q$, v_pay)));
  perform pg_temp.ck('a clinician cannot propose', 'ERR:payout_not_authorised', pg_temp.q_as(v_doc, format($q$select public.propose_payout_batch(array[%L]::uuid[])::text$q$, v_pay)));
  r := pg_temp.jq(v_admin, format($q$select public.propose_payout_batch(array[%L]::uuid[], 'proof batch')::text$q$, v_pay));
  v_batch := (r ->> 'batch_id')::uuid;
  perform pg_temp.ck('the maker proposes a batch', '1|100000000', (r ->> 'payout_count') || '|' || (r ->> 'total_kobo'));
  perform pg_temp.ck('a proposed batch does not allow sending', 'ERR:payout_batch_required', pg_temp.q_as(v_admin, format($q$select public.payout_prepare_send(%L)::text$q$, v_pay)));
  perform pg_temp.ck('the same payout cannot be in two open batches', 'ERR:payout_already_in_a_batch', pg_temp.q_as(v_admin2, format($q$select public.propose_payout_batch(array[%L]::uuid[])::text$q$, v_pay)));
  perform pg_temp.ck('the maker cannot release their own batch', 'ERR:payout_batch_self_release', pg_temp.q_as(v_admin, format($q$select public.release_payout_batch(%L)::text$q$, v_batch)));
  perform pg_temp.ck('the maker cannot reject their own batch', 'ERR:payout_batch_self_release', pg_temp.q_as(v_admin, format($q$select public.reject_payout_batch(%L, 'proof: rejecting my own')::text$q$, v_batch)));
  perform pg_temp.ck('a clinician cannot release', 'ERR:payout_not_authorised', pg_temp.q_as(v_doc, format($q$select public.release_payout_batch(%L)::text$q$, v_batch)));
  perform pg_temp.ck('a different approver releases it', 'released', (pg_temp.q_as(v_admin2, format($q$select public.release_payout_batch(%L)::text$q$, v_batch))::jsonb ->> 'state'));
  perform pg_temp.ck('the released batch records the checker', 'true', (select (checked_by = v_admin2 and made_by = v_admin)::text from public.payout_batches where id = v_batch));
  perform pg_temp.ck('now the payout can be sent', 'true', (pg_temp.q_as(v_admin, format($q$select (public.payout_prepare_send(%L) ->> 'reference') is not null$q$, v_pay)) = 'true')::text);
  begin update public.payout_batches set state = 'rejected', reject_reason = 'proof: should not be possible' where id = v_batch; v_s := 'accepted'; exception when others then v_s := sqlstate; end;
  perform pg_temp.ck('a released batch never changes', '42501', v_s);
  begin delete from public.payout_batch_items where batch_id = v_batch; v_s := 'accepted'; exception when others then v_s := sqlstate; end;
  perform pg_temp.ck('batch items are never deleted', '42501', v_s);
  -- a new attempt needs a new batch
  set local session_replication_role = replica;
  insert into public.payout_transfers (payout_id, attempt, reference) values (v_pay, 2, 'tpo-' || replace(v_pay::text, '-', '') || '-02');
  set local session_replication_role = origin;
  perform pg_temp.ck('a new transfer attempt needs a new batch', 'ERR:payout_batch_required', pg_temp.q_as(v_admin, format($q$select public.payout_prepare_send(%L)::text$q$, v_pay)));

  -- limits
  v_o := pg_temp.mkpay(v_org, v_doc2, v_admin, 160000000, 'approved', 35);
  perform pg_temp.ck('limit: one payout over the per-payout maximum', 'ERR:payout_limit_payout', pg_temp.q_as(v_admin, format($q$select public.propose_payout_batch(array[%L]::uuid[])::text$q$, v_o)));
  v_o := pg_temp.mkpay(v_org, v_doc2, v_admin, 100000000, 'approved', 42);
  v_o2 := pg_temp.mkpay(v_org, v_doc2, v_admin, 100000000, 'approved', 49);
  perform pg_temp.ck('limit: one clinician over the rolling seven day maximum', 'ERR:payout_limit_clinician', pg_temp.q_as(v_admin, format($q$select public.propose_payout_batch(array[%L, %L]::uuid[])::text$q$, v_o, v_o2)));
  v_ids := '{}';
  for i in 1..11 loop v_ids := v_ids || pg_temp.mkpay(v_org, v_doc, v_admin, 100000000, 'approved', 100 + i * 7); end loop;
  perform pg_temp.ck('limit: a batch over the per-batch total', 'ERR:payout_limit_batch_total', pg_temp.q_as(v_admin, format($q$select public.propose_payout_batch(%L::uuid[])::text$q$, v_ids)));
  v_ids := '{}';
  for i in 1..21 loop v_ids := v_ids || pg_temp.mkpay(v_org, v_doc, v_admin, 1000, 'approved', 300 + i * 7); end loop;
  perform pg_temp.ck('limit: a batch over the per-batch count', 'ERR:payout_limit_batch_count', pg_temp.q_as(v_admin, format($q$select public.propose_payout_batch(%L::uuid[])::text$q$, v_ids)));
  perform pg_temp.ck('an empty batch is refused', 'ERR:payout_batch_empty', pg_temp.q_as(v_admin, $q$select public.propose_payout_batch('{}'::uuid[])::text$q$));

  -- the checker cannot release a batch that pays them
  v_c := pg_temp.mkpay(v_org, v_admin2, v_admin, 5000000, 'approved', 600);
  r := pg_temp.jq(v_admin, format($q$select public.propose_payout_batch(array[%L]::uuid[])::text$q$, v_c));
  perform pg_temp.ck('the checker cannot release a batch that pays them', 'ERR:payout_batch_pays_the_checker', pg_temp.q_as(v_admin2, format($q$select public.release_payout_batch(%L)::text$q$, r ->> 'batch_id')));
  perform pg_temp.ck('rejecting needs a reason', 'ERR:payout_batch_needs_reason', pg_temp.q_as(v_admin2, format($q$select public.reject_payout_batch(%L, 'short')::text$q$, r ->> 'batch_id')));
  perform pg_temp.ck('a different approver rejects it', 'ok', pg_temp.q_as(v_admin2, format($q$select 'ok' from (select public.reject_payout_batch(%L, 'proof: this batch pays the checker')) s$q$, r ->> 'batch_id')));
  perform pg_temp.ck('the rejected payout can be proposed again', 'true', (pg_temp.q_as(v_admin, format($q$select (public.propose_payout_batch(array[%L]::uuid[])::text)::jsonb ? 'batch_id'$q$, v_c)) = 'true')::text);

  -- a payout that changed since proposal sinks the batch
  v_d := pg_temp.mkpay(v_org, v_doc2, v_admin, 2000000, 'approved', 700);
  r := pg_temp.jq(v_admin, format($q$select public.propose_payout_batch(array[%L]::uuid[])::text$q$, v_d));
  set local session_replication_role = replica;
  update public.payouts set state = 'sent' where id = v_d;
  set local session_replication_role = origin;
  perform pg_temp.ck('a payout that is no longer approved sinks the batch at release', 'ERR:payout_batch_changed', pg_temp.q_as(v_admin2, format($q$select public.release_payout_batch(%L)::text$q$, r ->> 'batch_id')));
  perform pg_temp.ck('no client role can see another organisation or a clinician sees no batches', '0', pg_temp.q_as(v_doc, $q$select count(*)::text from public.payout_batches$q$));

  -- 6a. SABOTAGE: limit check replaced by a no-op, the oversized payout must now be accepted -----------
  create or replace function private.payout_limits_check(p_ids uuid[], p_batch uuid) returns void language plpgsql security definer set search_path = '' as 'begin null; end';
  v_o := pg_temp.mkpay(v_org, v_doc2, v_admin, 160000000, 'approved', 800);
  insert into results values ('sabotaged', 'limit: one payout over the per-payout maximum (limit check removed)', 'ERR:payout_limit_payout', pg_temp.q_as(v_admin, format($q$select public.propose_payout_batch(array[%L]::uuid[])::text$q$, v_o)));
  -- 6b. SABOTAGE: posting flag off, the reversal must now post nothing ------------------------------
  update public.feature_flags set status = 'off' where key = 'payout_gl_posting';
  v_pay2 := pg_temp.mkpay(v_org, v_doc, v_admin, 900000, 'succeeded', 900);
  set local session_replication_role = replica;
  insert into public.finance_journal_entries (entry_date, period_month, currency, source, source_ref, memo)
    values (current_date, date_trunc('month', current_date)::date, 'NGN', 'payout', 'payout:' || v_pay2 || ':1:sent', 'sabotage fixture') returning id into v_e2;
  set local session_replication_role = origin;
  perform public.apply_payout_transfer_event('transfer.reversed', pg_temp.ref(v_pay2), null, null);
  insert into results values ('sabotaged', 'the reversal posts the opposite entry (posting flag off)', '1',
    (select count(*)::text from public.finance_journal_entries where source = 'payout_reversal' and source_ref = 'payout:' || v_pay2 || ':1:reversal'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S31x proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then
    raise exception 'VACUOUS TEST: expected both sabotages (limit check removed, posting flag off) to fail their checks, only % did', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
