-- S31 proof: weekly payouts, approval, Paystack transfer states, statements and bank verification
-- (migration *_s31_weekly_payouts.sql). One rolled-back transaction. Proves:
--   1. Weekly draft: one draft per contracted clinician with unpaid lines, below-minimum carried over, test accounts never drafted
--      (INV-13, safety case 22), period maths in Lagos time.
--   2. Approval: refused while payouts_enabled is off (INV-14), refused for the payee, refused with no verified bank, refused when the
--      ledger moved since the draft; on success every unpaid line is linked once and the sums equal the payout.
--   3. Bank verification: a name that does not match is never verified; only the service role writes bank rows.
--   4. Transfers: send recording, webhook success/failed/reversed idempotent and order tolerant (success then reversed), an event for an
--      older attempt does not move the payout, an unknown reference is ignored, retry makes a new attempt and never a second payout.
--   5. Statements and access: a clinician sees only their own payouts, lines add up; tables cannot be written or deleted directly.
--   6. SABOTAGE: name matching forced true and the payout write guard removed; both checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create temp table saved(k text primary key, v text) on commit drop;
grant all on saved to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
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
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.q(p_sql text) returns text language plpgsql as
$f$ declare r text; begin execute p_sql into r; return r; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's31-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S31 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_emp text, p_comps text[], p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid; s uuid; c text;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S31 ' || p_label, 'MDCN', 'S31-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, p_emp::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end,
      p_emp = 'contracted', case when p_emp = 'contracted' then p_admin else null end, true)
  returning id into s;
  foreach c in array p_comps loop
    insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, s, c, p_admin, true);
  end loop;
  return v;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role anon;
  begin execute p_sql into r; r := 'ok'; exception when others then r := sqlerrm; end;
  reset role;
  return r;
end $f$;
create function pg_temp.try_sql_as_state(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;

create function pg_temp.go_real(p_uid uuid, p_name text) returns void language plpgsql as
$f$ begin
  update public.profiles set is_test = false where id = p_uid;
  update public.clinical_staff set is_test = false, full_name = p_name where profile_id = p_uid;
end $f$;
-- a ledger line (adjustment kind, so no fee schedule is needed) earned `p_ago` ago
create function pg_temp.line(p_org uuid, p_doc uuid, p_admin uuid, p_kobo bigint, p_ago text, p_test boolean default false) returns uuid language sql as
$$ select private.ledger_insert(p_org, p_doc, 'adjustment', 'manual', gen_random_uuid(), p_kobo, null, '{"proof": true}'::jsonb,
     now() - p_ago::interval, p_test, 'proof line for S31 payouts', p_admin) $$;
-- the payout guard, for the proof only (the real guard row cannot be switched by anyone but set_go_live_guard)
create function pg_temp.guard_on() returns void language plpgsql as
$f$ begin
  create or replace function private.go_live_guard_on(p_key text) returns boolean language sql stable security definer set search_path = ''
  as 'select true';
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_a uuid; v_b uuid; v_t uuid; v_c uuid; v_emp uuid; v_p uuid; v_n integer; v_pay uuid; v_ref text; v_acct uuid; r jsonb;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');                       perform pg_temp.setf('admin', v_admin);
  v_a := pg_temp.mkdoc(v_org, 'docA', 'medical_officer', 'contracted', '{}', v_admin);  perform pg_temp.go_real(v_a, 'Ada Chinwe Okafor'); perform pg_temp.setf('a', v_a);
  v_b := pg_temp.mkdoc(v_org, 'docB', 'medical_officer', 'contracted', '{}', v_admin);  perform pg_temp.go_real(v_b, 'Bola Tunde Adeyemi'); perform pg_temp.setf('b', v_b);
  v_c := pg_temp.mkdoc(v_org, 'docC', 'medical_officer', 'contracted', '{}', v_admin);  perform pg_temp.go_real(v_c, 'Chika Obi Nwosu'); perform pg_temp.setf('c', v_c);
  v_t := pg_temp.mkdoc(v_org, 'docT', 'medical_officer', 'contracted', '{}', v_admin);  perform pg_temp.setf('t', v_t);   -- stays a test account
  perform pg_temp.setf('p_gate', pg_temp.mkuser(v_org, 'patientgate', 'patient'));
  v_emp := pg_temp.mkdoc(v_org, 'emp', 'medical_officer', 'employed', '{}', v_admin);   perform pg_temp.go_real(v_emp, 'Emeka Paul Eze'); perform pg_temp.setf('emp', v_emp);

  -- Lagos week maths
  perform pg_temp.ck('a Wednesday maps to the Sunday before it', '2026-10-04', private.payout_last_period_end('2026-10-07 10:00+01')::text);
  perform pg_temp.ck('a Sunday maps to the Sunday before (the week is not over)', '2026-10-04', private.payout_last_period_end('2026-10-11 10:00+01')::text);
  perform pg_temp.ck('a Monday maps to the Sunday just gone', '2026-10-11', private.payout_last_period_end('2026-10-12 06:00+01')::text);
  perform pg_temp.ck('the cutoff is midnight Lagos after the Sunday', '2026-10-04 23:00:00+00', private.payout_cutoff('2026-10-04')::text);

  -- ledger: A 180000 (3 lines), B 200000, C 50000 (below the 100000 minimum), T 500000 (test account), plus a line for A newer than the cutoff
  perform pg_temp.line(v_org, v_a, v_admin, 60000, '20 days'); perform pg_temp.line(v_org, v_a, v_admin, 70000, '15 days'); perform pg_temp.line(v_org, v_a, v_admin, 50000, '12 days');
  perform pg_temp.line(v_org, v_b, v_admin, 200000, '14 days');
  perform pg_temp.line(v_org, v_c, v_admin, 50000, '13 days');
  perform pg_temp.line(v_org, v_t, v_admin, 500000, '14 days', true);
  perform pg_temp.line(v_org, v_a, v_admin, 5000, '1 minute');   -- after any weekly cutoff: must stay out of the draft

  -- 1. drafts
  perform pg_temp.ck('only an admin builds drafts', 'payout_not_authorised', pg_temp.try_as(v_a, 'select public.build_payout_drafts_now()'));
  perform pg_temp.act(v_admin); v_n := public.build_payout_drafts_now(); perform pg_temp.back();
  perform pg_temp.ck('two drafts: A and B (C carried over, the test account skipped)', '2', v_n::text);
  perform pg_temp.ck('A draft is the three old lines only', '180000/3', (select amount_kobo || '/' || line_count from public.payouts where clinician_id = v_a and state = 'draft'));
  perform pg_temp.ck('C is below the minimum: no draft, lines carried over', '0', (select count(*) from public.payouts where clinician_id = v_c)::text);
  perform pg_temp.ck('INV-13: the test clinician is never drafted', '0', (select count(*) from public.payouts where clinician_id = v_t)::text);
  perform pg_temp.ck('INV-13: an employed doctor is never drafted', '0', (select count(*) from public.payouts where clinician_id = v_emp)::text);
  perform pg_temp.ck('nothing is linked at draft time', '0', (select count(*) from public.earnings_ledger where payout_id is not null)::text);
  perform pg_temp.act(v_admin); v_n := public.build_payout_drafts_now(); perform pg_temp.back();
  perform pg_temp.ck('building again does not duplicate', '0', v_n::text);
  perform pg_temp.ck('the draft records the config version used (INV-16)', '1', (select count(*) from public.payouts p join public.payouts_config c on c.id = p.payouts_config_id and c.version = 1 where p.clinician_id = v_a)::text);

  -- 2. approval refusals
  select id into v_pay from public.payouts where clinician_id = v_a and state = 'draft';
  perform pg_temp.setf('pay_a', v_pay);
  perform pg_temp.ck('INV-14: approval refused while payouts_enabled is off', 'payout_guard_off', pg_temp.try_as(v_admin, format('select public.approve_payout(%L)', v_pay)));
  perform pg_temp.ck('a clinician cannot approve', 'payout_not_authorised', pg_temp.try_as(v_a, format('select public.approve_payout(%L)', v_pay)));
  perform pg_temp.guard_on();
  perform pg_temp.ck('no verified bank: refused', 'payout_no_verified_bank', pg_temp.try_as(v_admin, format('select public.approve_payout(%L)', v_pay)));

  -- 3. bank verification
  perform pg_temp.ck('a client cannot write a bank row', 'permission denied for function record_bank_resolution',
    pg_temp.try_as(v_a, format($q$select public.record_bank_resolution(%L, '058', 'GTBank', '1234', 'Ada Okafor')$q$, v_a)));
  r := public.record_bank_resolution(v_a, '058', 'GTBank', '1234', 'OKAFOR CHIDI');
  perform pg_temp.ck('another person''s name does not verify', 'mismatch', r ->> 'name_match');
  perform pg_temp.ck('...and cannot be given a recipient', '23514', pg_temp.try_sql(format($q$select public.attach_bank_recipient(%L, 'RCP_x1')$q$, (r ->> 'id'))) );
  r := public.record_bank_resolution(v_a, '058', 'GTBank', '1234', 'OKAFOR ADA CHINWE');
  perform pg_temp.ck('a reordered bank name with the same parts verifies', 'verified', r ->> 'name_match');
  perform pg_temp.ck('not verified until a recipient exists', '0', (select count(*) from public.clinician_bank_accounts where clinician_id = v_a and bank_verified_at is not null)::text);
  perform public.attach_bank_recipient((r ->> 'id')::uuid, 'RCP_proofA');
  perform pg_temp.ck('verified after the recipient is attached', '1', (select count(*) from public.clinician_bank_accounts where clinician_id = v_a and bank_verified_at is not null and superseded_at is null)::text);
  perform pg_temp.ck('only the current bank row is live (the earlier attempt is superseded)', '1', (select count(*) from public.clinician_bank_accounts where clinician_id = v_a and superseded_at is null)::text);
  perform pg_temp.ck('the full account number is never stored', 'false', (select exists (select 1 from information_schema.columns where table_name = 'clinician_bank_accounts' and column_name ~ 'account_number')::text));
  perform pg_temp.ck('a one-word name never matches', 'false', private.payout_names_match('Ada', 'Ada Okafor')::text);
  perform pg_temp.ck('an employed doctor has no bank row path', '22023', pg_temp.try_sql(format($q$select public.record_bank_resolution(%L, '058', 'GTBank', '9999', 'Emeka Paul Eze')$q$, v_emp)));

  -- the lookup gate: contracted clinicians only, ten a day
  perform pg_temp.ck('a patient cannot look up a bank account', 'payout_not_a_contracted_clinician', pg_temp.try_as(pg_temp.f('p_gate'), 'select public.payout_bank_check_allowed()'));
  perform pg_temp.ck('an employed doctor cannot look up a bank account', 'payout_not_a_contracted_clinician', pg_temp.try_as(v_emp, 'select public.payout_bank_check_allowed()'));
  for v_n in 1..10 loop perform pg_temp.try_as(v_c, 'select public.payout_bank_check_allowed()'); end loop;
  perform pg_temp.ck('the eleventh lookup in a day is refused', 'payout_bank_too_many_lookups', pg_temp.try_as(v_c, 'select public.payout_bank_check_allowed()'));
  perform pg_temp.ck('a different clinician is not affected by that limit', 'ok', pg_temp.try_as(v_a, 'select public.payout_bank_check_allowed()'));

  -- the ledger moves after the draft: approval refuses, a forced rebuild fixes it
  perform pg_temp.line(v_org, v_a, v_admin, 1000, '10 days');
  perform pg_temp.ck('INV-14/ledger moved since the draft: refused', 'payout_ledger_changed', pg_temp.try_as(v_admin, format('select public.approve_payout(%L)', v_pay)));
  perform pg_temp.act(v_admin); v_n := public.build_payout_drafts_now(true); perform pg_temp.back();
  perform pg_temp.ck('a forced rebuild makes a fresh draft for A (and for B)', '2', v_n::text);
  perform pg_temp.ck('the old draft is cancelled, not deleted', 'cancelled', (select state from public.payouts where id = v_pay));
  select id into v_pay from public.payouts where clinician_id = v_a and state = 'draft'; perform pg_temp.setf('pay_a', v_pay);
  perform pg_temp.ck('the rebuilt draft includes the new line', '181000/4', (select amount_kobo || '/' || line_count from public.payouts where id = v_pay));

  -- self approval (B made an admin only for this check)
  update public.profiles set role = 'admin' where id = v_b;
  perform pg_temp.ck('a payee cannot approve their own payout', 'payout_self_approval', pg_temp.try_as(v_b, format('select public.approve_payout(%L)', (select id from public.payouts where clinician_id = v_b and state = 'draft'))));
  update public.profiles set role = 'clinician' where id = v_b;

  -- approve A
  perform pg_temp.act(v_admin); r := public.approve_payout(v_pay); perform pg_temp.back();
  v_ref := r ->> 'reference'; perform pg_temp.ck('reference is a valid Paystack transfer reference', 'true', (v_ref ~ '^[a-z0-9_-]{16,50}$')::text);
  perform pg_temp.ck('approved, with approver and recipient', 'approved/RCP_proofA', (select state || '/' || recipient_code from public.payouts where id = v_pay));
  perform pg_temp.ck('every old line is linked to the payout', '4/181000', (select count(*) || '/' || sum(amount_kobo) from public.earnings_ledger where payout_id = v_pay));
  perform pg_temp.ck('the line newer than the cutoff stays unpaid', '1', (select count(*) from public.earnings_ledger where clinician_id = v_a and payout_id is null)::text);
  perform pg_temp.ck('a second approval is refused', 'payout_not_a_draft', pg_temp.try_as(v_admin, format('select public.approve_payout(%L)', v_pay)));
  perform pg_temp.ck('a linked line cannot be unlinked or edited', '23514', pg_temp.try_sql(format($q$update public.earnings_ledger set payout_id = null where payout_id = %L$q$, v_pay)));

  -- 4. sending and webhooks
  perform pg_temp.act(v_admin); r := public.payout_prepare_send(v_pay); perform pg_temp.back();
  perform pg_temp.ck('prepare-send hands back the reference, amount and recipient', v_ref || '/181000/RCP_proofA', (r ->> 'reference') || '/' || (r ->> 'amount_kobo') || '/' || (r ->> 'recipient_code'));
  perform public.payout_record_send(v_ref, 'pending', 'TRF_a1');
  perform pg_temp.ck('Paystack accepted: sent', 'sent', (select state from public.payouts where id = v_pay));
  perform public.payout_record_send(v_ref, 'pending', 'TRF_a1');
  perform pg_temp.ck('recording the send twice changes nothing', 'sent', (select state from public.payouts where id = v_pay));
  perform pg_temp.ck('a client cannot record a send', 'permission denied for function payout_record_send', pg_temp.try_as(v_admin, format($q$select public.payout_record_send(%L, 'success', 'x')$q$, v_ref)));
  perform pg_temp.ck('webhook success: succeeded', 'applied', public.apply_payout_transfer_event('transfer.success', v_ref, 'TRF_a1') ->> 'result');
  perform pg_temp.ck('...state', 'succeeded', (select state from public.payouts where id = v_pay));
  perform pg_temp.ck('a replay is a duplicate', 'duplicate', public.apply_payout_transfer_event('transfer.success', v_ref, 'TRF_a1') ->> 'result');
  perform pg_temp.ck('a later reversal is applied (not lost as a replay)', 'applied', public.apply_payout_transfer_event('transfer.reversed', v_ref, 'TRF_a1', 'bank returned it') ->> 'result');
  perform pg_temp.ck('...state', 'reversed', (select state from public.payouts where id = v_pay));
  perform pg_temp.ck('a success after a reversal is not believed', 'out_of_order', public.apply_payout_transfer_event('transfer.success', v_ref, 'TRF_a1') ->> 'result');
  perform pg_temp.ck('...state is unchanged', 'reversed', (select state from public.payouts where id = v_pay));
  perform pg_temp.ck('an unknown reference is ignored', 'not_ours', public.apply_payout_transfer_event('transfer.success', 'trf_not_ours_0000000', 'x') ->> 'result');
  perform pg_temp.ck('an unrelated event is ignored', 'ignored_event', public.apply_payout_transfer_event('charge.success', v_ref, 'x') ->> 'result');

  -- retry
  perform pg_temp.ck('a client cannot retry unless admin', 'payout_not_authorised', pg_temp.try_as(v_a, format('select public.retry_payout(%L)', v_pay)));
  perform pg_temp.act(v_admin); r := public.retry_payout(v_pay); perform pg_temp.back();
  perform pg_temp.ck('retry makes a new reference', 'true', ((r ->> 'reference') <> v_ref)::text);
  perform pg_temp.ck('...and moves the payout back to approved', 'approved', (select state from public.payouts where id = v_pay));
  perform pg_temp.ck('...with no second payout and the same linked lines', '1/4', (select (select count(*) from public.payouts where clinician_id = v_a and state <> 'cancelled') || '/' || (select count(*) from public.earnings_ledger where payout_id = v_pay)));
  perform pg_temp.ck('a late event for the first attempt does not move the payout', 'older_attempt', public.apply_payout_transfer_event('transfer.failed', v_ref, 'TRF_a1') ->> 'result');
  perform pg_temp.ck('...state', 'approved', (select state from public.payouts where id = v_pay));
  perform public.payout_record_send(r ->> 'reference', 'pending', 'TRF_a2');
  perform pg_temp.ck('the retry succeeds', 'applied', public.apply_payout_transfer_event('transfer.success', r ->> 'reference', 'TRF_a2') ->> 'result');
  perform pg_temp.ck('...state', 'succeeded', (select state from public.payouts where id = v_pay));
  perform pg_temp.ck('a succeeded payout cannot be retried', 'payout_not_retryable', pg_temp.try_as(v_admin, format('select public.retry_payout(%L)', v_pay)));
  perform pg_temp.ck('the event log keeps every change', 'true', ((select count(*) from public.payout_events where payout_id = v_pay) >= 8)::text);

  -- failure path on B (needs a bank first)
  r := public.record_bank_resolution(v_b, '044', 'Access', '5678', 'ADEYEMI BOLA TUNDE'); perform public.attach_bank_recipient((r ->> 'id')::uuid, 'RCP_proofB');
  select id into v_p from public.payouts where clinician_id = v_b and state = 'draft';
  perform pg_temp.act(v_admin); r := public.approve_payout(v_p); perform pg_temp.back();
  perform public.apply_payout_transfer_event('transfer.failed', r ->> 'reference', 'TRF_b1', 'no funds');
  perform pg_temp.ck('a failed transfer lands as failed, with the reason', 'failed/no funds', (select state || '/' || failure_reason from public.payouts where id = v_p));
  perform pg_temp.ck('a failed payout is never retried by itself (still failed)', 'failed', (select state from public.payouts where id = v_p));

  -- 5. statements, tax data, access
  perform pg_temp.act(v_a); r := public.my_payout_overview(); perform pg_temp.back();
  perform pg_temp.ck('statement: one payout, four lines, lines add up to the amount', '1/4/181000',
    jsonb_array_length(r -> 'payouts') || '/' || jsonb_array_length(r -> 'payouts' -> 0 -> 'lines') ||
    '/' || (select sum((x ->> 'amount_kobo')::bigint) from jsonb_array_elements(r -> 'payouts' -> 0 -> 'lines') x));
  perform pg_temp.ck('statement: the bank shows the last four and the verified name', '1234/true', (r -> 'bank' ->> 'account_last4') || '/' || (r -> 'bank' ->> 'verified'));
  perform pg_temp.ck('statement: the next payout is the line newer than the cutoff', '5000', (r ->> 'next_payout_kobo'));
  perform pg_temp.ck('statement lines carry no patient data (only kind, date, amount, task type)', 'true',
    (select bool_and(x - 'id' - 'kind' - 'earned_at' - 'amount_kobo' - 'task_type' = '{}'::jsonb) from jsonb_array_elements(r -> 'payouts' -> 0 -> 'lines') x)::text);
  perform pg_temp.ck('an employed doctor has no payout statement', 'payout_not_a_contracted_clinician', pg_temp.try_as(v_emp, 'select public.my_payout_overview()'));
  perform pg_temp.ck('A sees none of anyone else''s payouts', '0', pg_temp.q_as(v_a, format('select count(*) from public.payouts where clinician_id <> %L', v_a)));
  perform pg_temp.ck('B sees none of anyone else''s payouts', '0', pg_temp.q_as(v_b, format('select count(*) from public.payouts where clinician_id <> %L', v_b)));
  perform pg_temp.ck('A cannot read anyone else''s bank row', '0', pg_temp.q_as(v_a, format('select count(*) from public.clinician_bank_accounts where clinician_id <> %L', v_a)));
  perform pg_temp.ck('admin sees every payout', 'true', (pg_temp.q_as(v_admin, 'select count(*) from public.payouts')::int >= 3)::text);
  perform pg_temp.ck('a client cannot update a payout directly', 'permission denied for table payouts', pg_temp.try_as(v_admin, format($q$update public.payouts set amount_kobo = 1 where id = %L$q$, v_pay)));
  perform pg_temp.ck('a client cannot insert a payout directly', 'permission denied for table payouts', pg_temp.try_as(v_admin, format($q$insert into public.payouts (organisation_id, clinician_id, period_start, period_end, amount_kobo, line_count, payouts_config_id) select %L, %L, current_date, current_date, 5, 1, id from public.payouts_config$q$, v_org, v_a)));
  perform pg_temp.ck('the owner cannot write a payout outside the functions', '42501', pg_temp.try_sql(format($q$update public.payouts set amount_kobo = 1 where id = %L$q$, v_pay)));
  perform pg_temp.ck('a payout is never deleted', '42501', pg_temp.try_sql(format($q$delete from public.payouts where id = %L$q$, v_pay)));
  perform pg_temp.ck('the event log is append only', '42501', pg_temp.try_sql('update public.payout_events set detail = ''x'''));
  perform pg_temp.ck('INV-13: a payout row for a test account cannot exist', '23514',
    pg_temp.try_sql(format($q$select set_config('tarragon.payout_write', 'on', true); insert into public.payouts (organisation_id, clinician_id, period_start, period_end, amount_kobo, line_count, payouts_config_id, is_test) select %L, %L, current_date, current_date, 5, 1, id, true from public.payouts_config$q$, v_org, v_t)));
  perform pg_temp.ck('an approved amount can never change', '23514', pg_temp.try_sql(format($q$select set_config('tarragon.payout_write', 'on', true); update public.payouts set amount_kobo = 9 where id = %L$q$, v_pay)));
  perform pg_temp.ck('a payout cannot jump from succeeded to approved', '23514', pg_temp.try_sql(format($q$select set_config('tarragon.payout_write', 'on', true); update public.payouts set state = 'approved' where id = %L$q$, v_pay)));

  -- tax data, stored only
  perform pg_temp.act(v_a); perform public.save_my_tax_profile('12345678-0001', 'individual', 'Ada Okafor Medical', false, 'registered 2024'); perform pg_temp.back();
  perform pg_temp.ck('tax data is stored', 'individual/12345678-0001', (select contractor_status || '/' || tin from public.clinician_tax_profiles where clinician_id = v_a));
  perform pg_temp.ck('the tax table holds no rate or amount', 'false', (select exists (select 1 from information_schema.columns where table_name = 'clinician_tax_profiles' and column_name ~ '(rate|amount|kobo|withheld)')::text));
  perform pg_temp.ck('a bad tax status is refused', '23514', pg_temp.try_sql_as_state(v_a, $q$select public.save_my_tax_profile('12345678-0001', 'freelancer', null, false)$q$));
  perform pg_temp.ck('an employed doctor cannot save tax data here', 'tax_not_a_contracted_clinician', pg_temp.try_as(v_emp, $q$select public.save_my_tax_profile(null, 'unknown', null, false)$q$));
  perform pg_temp.ck('B cannot read A''s tax data', '0', pg_temp.q_as(v_b, format($q$select count(*) from public.clinician_tax_profiles where clinician_id = %L$q$, v_a)));
  perform pg_temp.ck('anon cannot read payouts', 'permission denied for table payouts', pg_temp.try_anon('select count(*) from public.payouts'));
end $$;

-- 6. SABOTAGE: name matching forced true, and the write guard removed; both checks must flip ----------------------------------------
create or replace function private.payout_names_match(p_verified text, p_resolved text) returns boolean language sql immutable set search_path = '' as 'select true';
drop trigger payouts_guard on public.payouts;
do $$
declare v_a uuid := pg_temp.f('a'); v_pay uuid := pg_temp.f('pay_a'); r jsonb;
begin
  r := public.record_bank_resolution(v_a, '058', 'GTBank', '4321', 'TOTALLY DIFFERENT PERSON');
  insert into results values ('sabotaged', 'a different person''s account name does not verify', 'mismatch', r ->> 'name_match');
  insert into results values ('sabotaged', 'the owner cannot edit a payout outside the functions', 'refused',
    case when pg_temp.try_sql(format($q$update public.payouts set amount_kobo = 1 where id = %L$q$, v_pay)) = 'ok' then 'allowed' else 'refused' end);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S31 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
