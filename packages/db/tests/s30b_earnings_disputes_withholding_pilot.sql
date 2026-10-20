-- S30b proof: earnings disputes, withholding statement, line pay status, pilot-minimum activity check and late-line netting
-- (migration *_s30b_earnings_disputes_withholding_pilot_inactivity.sql). One rolled-back transaction. Proves:
--   1. A dispute holds ONLY its own line out of the payout draft and out of approval; the rest of the week still pays; the draft is rebuilt
--      when a dispute opens, is withdrawn or is resolved; a double tap opens one dispute; ownership, reason code and age are enforced.
--   2. Resolution is an adjustment line pointing at the disputed line (or a rejection); the ledger stays append only; a resolved dispute
--      and the adjustment can never be edited or deleted; a retry never posts two adjustments.
--   3. Withholding is stored, never calculated: gross is untouched, net is gross less the typed amount, it can only be set on a draft,
--      a payout carrying one is refused at send, no rate or percentage column exists.
--   4. Per-line pay status follows the S31 payout state (pending, approved, paid, failed, disputed) including the existing retry.
--   5. Pilot minimum: a run with no sign of work, or with only timed-out claims, is HELD (not paid, not dropped); a quiet queue, or real
--      work, is paid; a held top-up is released or denied by a person; a late line is netted off once (idempotent).
--   6. Access: tables are read-only to clients, a clinician sees only their own disputes, only an admin sees holds, anon sees nothing.
--   7. SABOTAGE: dispute guard, ledger guard, withholding guard, the hold lookup and the activity check are each removed in turn; the
--      matching checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

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
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role anon;
  begin execute p_sql into r; r := 'ok'; exception when others then r := sqlerrm; end;
  reset role;
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's30b-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S30b ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_emp text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S30b ' || p_label, 'MDCN', 'S30B-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      'senior_medical_officer'::public.doctor_tier, p_emp::public.staff_employment_type, 2,
      p_emp = 'contracted', case when p_emp = 'contracted' then p_admin else null end, true);
  return v;
end $f$;
create function pg_temp.go_real(p_uid uuid, p_name text) returns void language plpgsql as
$f$ begin
  update public.profiles set is_test = false where id = p_uid;
  update public.clinical_staff set is_test = false, full_name = p_name where profile_id = p_uid;
end $f$;
-- a ledger line (adjustment kind, so no fee schedule is needed) earned `p_ago` ago
create function pg_temp.line(p_org uuid, p_doc uuid, p_admin uuid, p_kobo bigint, p_ago text) returns uuid language sql as
$$ select private.ledger_insert(p_org, p_doc, 'adjustment', 'manual', gen_random_uuid(), p_kobo, null, '{"proof": true}'::jsonb,
     now() - p_ago::interval, false, 'proof line for S30b disputes', p_admin) $$;
-- the payout guard, for the proof only
create function pg_temp.guard_on() returns void language plpgsql as
$f$ begin
  create or replace function private.go_live_guard_on(p_key text) returns boolean language sql stable security definer set search_path = ''
  as 'select true';
end $f$;
create function pg_temp.bank(p_doc uuid, p_name text, p_code text) returns void language plpgsql as
$f$ declare r jsonb;
begin
  r := public.record_bank_resolution(p_doc, '058', 'GTBank', '1234', p_name);
  perform public.attach_bank_recipient((r ->> 'id')::uuid, p_code);
end $f$;
create function pg_temp.backdate(p_task uuid, p_set text) returns void language plpgsql as
$f$ begin
  perform set_config('tarragon.task_transition', 'on', true);
  execute format('update public.clinical_tasks set %s where id = %L', p_set, p_task);
  perform set_config('tarragon.task_transition', 'off', true);
end $f$;
create function pg_temp.block(p_org uuid, p_doc uuid, p_from text, p_to text) returns void language sql as
$$ insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, state, is_test)
   values (p_org, p_doc, now() - p_from::interval, now() - p_to::interval, 'queue', 'confirmed', true) $$;
create function pg_temp.lines_of(p_uid uuid, p_kind text) returns integer language sql as
$$ select count(*)::integer from public.earnings_ledger where clinician_id = p_uid and kind = p_kind $$;

-- Fixtures ---------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_a uuid; v_b uuid; v_z uuid; v_e uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  update public.clinical_staff set active = false where is_test is not true;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');                              perform pg_temp.setf('admin', v_admin);
  v_a := pg_temp.mkdoc(v_org, 'docA', 'contracted', v_admin);                      perform pg_temp.go_real(v_a, 'Ada Chinwe Okafor'); perform pg_temp.setf('a', v_a);
  v_b := pg_temp.mkdoc(v_org, 'docB', 'contracted', v_admin);                      perform pg_temp.go_real(v_b, 'Bola Tunde Adeyemi'); perform pg_temp.setf('b', v_b);
  v_z := pg_temp.mkdoc(v_org, 'docZ', 'contracted', v_admin);                      perform pg_temp.go_real(v_z, 'Zainab Musa Bello'); perform pg_temp.setf('z', v_z);
  v_e := pg_temp.mkdoc(v_org, 'emp', 'employed', v_admin);                         perform pg_temp.setf('emp', v_e);
  perform pg_temp.setf('p', pg_temp.mkuser(v_org, 'patient', 'patient'));
  perform pg_temp.setf('c', pg_temp.mkdoc(v_org, 'docC', 'contracted', v_admin));
  perform pg_temp.setf('d', pg_temp.mkdoc(v_org, 'docD', 'contracted', v_admin));
  perform pg_temp.setf('fz', pg_temp.mkdoc(v_org, 'docF', 'contracted', v_admin));
  perform pg_temp.setf('g', pg_temp.mkdoc(v_org, 'docG', 'contracted', v_admin));
  perform pg_temp.setf('h', pg_temp.mkdoc(v_org, 'docH', 'contracted', v_admin));
  perform pg_temp.setf('h2', pg_temp.mkdoc(v_org, 'docH2', 'contracted', v_admin));
  perform pg_temp.bank(v_a, 'OKAFOR ADA CHINWE', 'RCP_a');
  perform pg_temp.bank(v_b, 'ADEYEMI BOLA TUNDE', 'RCP_b');
  perform pg_temp.guard_on();
  perform pg_temp.ck('setup: the config row is the seeded version 1', '72', (select (rules -> 'dispute' ->> 'response_sla_hours') from public.earnings_disputes_config where is_active));
end $$;

-- 1. Disputes: opening, ownership, hold ---------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); v_admin uuid := pg_temp.f('admin'); v_a uuid := pg_temp.f('a'); v_b uuid := pg_temp.f('b'); v_e uuid := pg_temp.f('emp');
  l1 uuid; l2 uuid; l3 uuid; lb uuid; lb_old uuid; lb2 uuid; d1 uuid; d1b uuid; r1 uuid := gen_random_uuid(); r2 uuid := gen_random_uuid(); v_n integer; v_pay uuid; r jsonb;
begin
  l1 := pg_temp.line(v_org, v_a, v_admin, 60000, '20 days'); l2 := pg_temp.line(v_org, v_a, v_admin, 70000, '15 days'); l3 := pg_temp.line(v_org, v_a, v_admin, 50000, '12 days');
  lb := pg_temp.line(v_org, v_b, v_admin, 200000, '14 days'); lb_old := pg_temp.line(v_org, v_b, v_admin, 1000, '90 days'); lb2 := pg_temp.line(v_org, v_b, v_admin, 20000, '5 days');
  perform pg_temp.setf('l1', l1); perform pg_temp.setf('l2', l2); perform pg_temp.setf('l3', l3); perform pg_temp.setf('lb', lb); perform pg_temp.setf('lb2', lb2);
  perform pg_temp.act(v_admin); v_n := public.build_payout_drafts_now(); perform pg_temp.back();
  perform pg_temp.ck('setup: drafts for A (180000/3) and B (221000/3)', '180000/3,221000/3',
    (select string_agg(amount_kobo || '/' || line_count, ',' order by amount_kobo) from public.payouts where state = 'draft' and clinician_id in (v_a, v_b)));

  perform pg_temp.ck('an employed doctor cannot open a dispute', 'earnings_not_contracted', pg_temp.try_as(v_e, format('select public.open_earnings_dispute(%L, ''other'')', l1)));
  perform pg_temp.ck('B cannot dispute A''s line', 'dispute_unknown_line', pg_temp.try_as(v_b, format('select public.open_earnings_dispute(%L, ''other'')', l1)));
  perform pg_temp.ck('a made-up reason code is refused', 'dispute_bad_reason', pg_temp.try_as(v_a, format('select public.open_earnings_dispute(%L, ''i_feel_like_it'')', l1)));
  perform pg_temp.ck('a line older than the window cannot be disputed', 'dispute_window_closed', pg_temp.try_as(v_b, format('select public.open_earnings_dispute(%L, ''other'')', lb_old)));
  perform pg_temp.ck('anon cannot open a dispute', 'permission denied for function open_earnings_dispute', pg_temp.try_anon(format('select public.open_earnings_dispute(%L, ''other'')', l1)));

  perform pg_temp.act(v_a); d1 := public.open_earnings_dispute(l2, 'wrong_amount', 'I think this should be higher', r1); perform pg_temp.back();
  perform pg_temp.setf('d1', d1);
  perform pg_temp.act(v_a); d1b := public.open_earnings_dispute(l2, 'wrong_amount', 'I think this should be higher', r1); perform pg_temp.back();
  perform pg_temp.ck('a double tap (same request id) is the same dispute', d1::text, d1b::text);
  perform pg_temp.ck('...and there is one dispute', '1', (select count(*) from public.earnings_disputes where ledger_id = l2)::text);
  perform pg_temp.ck('a second dispute on a line already in question is refused', 'dispute_already_open',
    pg_temp.try_as(v_a, format('select public.open_earnings_dispute(%L, ''other'', null, %L)', l2, r2)));
  perform pg_temp.ck('the response clock is the configured 72 hours', '72:00:00', (select (response_due_at - opened_at)::text from public.earnings_disputes where id = d1));

  -- only that line is held: the draft was rebuilt without it
  perform pg_temp.ck('the old draft was cancelled and a new one made', '1',
    (select count(*) from public.payouts where clinician_id = v_a and state = 'cancelled' and failure_reason like 'rebuilt:%')::text);
  perform pg_temp.ck('the new draft is the other two lines only (60000 + 50000)', '110000/2',
    (select amount_kobo || '/' || line_count from public.payouts where clinician_id = v_a and state = 'draft'));
  perform pg_temp.ck('B''s draft is untouched by A''s dispute', '221000/3', (select amount_kobo || '/' || line_count from public.payouts where clinician_id = v_b and state = 'draft'));

  -- approval pays the rest and links only the free lines
  select id into v_pay from public.payouts where clinician_id = v_a and state = 'draft'; perform pg_temp.setf('pay_a', v_pay);
  perform pg_temp.act(v_admin); r := public.approve_payout(v_pay); perform pg_temp.back();
  perform pg_temp.ck('approved at 110000: the disputed line was not paid', '110000', (select amount_kobo::text from public.payouts where id = v_pay));
  perform pg_temp.ck('...the disputed line is not linked to any payout', 'null', coalesce((select payout_id::text from public.earnings_ledger where id = l2), 'null'));
  perform pg_temp.ck('...the other two lines are linked', '2', (select count(*) from public.earnings_ledger where payout_id = v_pay)::text);
  perform pg_temp.ck('a line already in an approved payout cannot be questioned (it cannot be held back)', 'dispute_line_in_flight',
    pg_temp.try_as(v_a, format('select public.open_earnings_dispute(%L, ''other'')', l1)));

  -- pay status follows the payout
  perform pg_temp.ck('status: a line in an approved payout is approved', 'approved', pg_temp.q_as(v_a, format('select pay_status from public.my_earnings_lines() where id = %L', l1)));
  perform pg_temp.ck('status: the disputed line is disputed', 'disputed', pg_temp.q_as(v_a, format('select pay_status from public.my_earnings_lines() where id = %L', l2)));
  perform pg_temp.ck('an employed doctor has no earnings lines to read', 'earnings_not_contracted', pg_temp.try_as(v_e, 'select * from public.my_earnings_lines()'));

  -- statement: gross, withholding 0, net
  r := (pg_temp.q_as(v_a, format('select public.my_payout_statement(%L)::text', v_pay)))::jsonb;
  perform pg_temp.ck('statement: gross 110000, withholding 0, net 110000, 2 lines', '110000/0/110000/2',
    (r ->> 'gross_kobo') || '/' || (r ->> 'withholding_kobo') || '/' || (r ->> 'net_kobo') || '/' || jsonb_array_length(r -> 'lines'));
  perform pg_temp.ck('statement lines carry no patient data', 'true',
    (select bool_and(x - 'id' - 'kind' - 'earned_at' - 'amount_kobo' - 'task_type' - 'pay_status' = '{}'::jsonb) from jsonb_array_elements(r -> 'lines') x)::text);
  perform pg_temp.ck('statement: B cannot read A''s payout statement', 'payout_unknown', pg_temp.try_as(v_b, format('select public.my_payout_statement(%L)', v_pay)));
  perform pg_temp.ck('statement: a draft has no statement yet', 'payout_unknown',
    pg_temp.try_as(v_b, format('select public.my_payout_statement(%L)', (select id from public.payouts where clinician_id = v_b and state = 'draft'))));
end $$;

-- 2. Resolution, immutability -------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); v_admin uuid := pg_temp.f('admin'); v_a uuid := pg_temp.f('a'); v_b uuid := pg_temp.f('b');
  d1 uuid := pg_temp.f('d1'); l2 uuid := pg_temp.f('l2'); lb uuid := pg_temp.f('lb'); r jsonb; v_adj uuid; dB uuid; dB2 uuid; dB3 uuid; lb2 uuid := pg_temp.f('lb2'); v_n integer;
begin
  perform pg_temp.ck('a clinician cannot resolve', 'fee_not_authorised', pg_temp.try_as(v_a, format($q$select public.resolve_earnings_dispute(%L, 'rejected', null, 'not allowed at all')$q$, d1)));
  perform pg_temp.ck('a resolution needs a reason', 'earnings_reason_needed', pg_temp.try_as(v_admin, format($q$select public.resolve_earnings_dispute(%L, 'rejected', null, 'short')$q$, d1)));
  perform pg_temp.ck('a correction needs an amount', 'earnings_bad_amount', pg_temp.try_as(v_admin, format($q$select public.resolve_earnings_dispute(%L, 'adjusted', 0, 'a perfectly good reason')$q$, d1)));
  perform pg_temp.ck('a rejection takes no amount', 'dispute_rejection_has_no_amount', pg_temp.try_as(v_admin, format($q$select public.resolve_earnings_dispute(%L, 'rejected', 500, 'a perfectly good reason')$q$, d1)));
  perform pg_temp.ck('the dispute is still open after those refusals', 'open', (select state from public.earnings_disputes where id = d1));

  perform pg_temp.act(v_admin); r := public.resolve_earnings_dispute(d1, 'adjusted', 40000, 'Agreed: the fee was entered short; adding the difference'); perform pg_temp.back();
  v_adj := (r ->> 'adjustment_ledger_id')::uuid;
  perform pg_temp.ck('resolved: an adjustment line was posted', 'adjustment/40000', (select kind || '/' || amount_kobo from public.earnings_ledger where id = v_adj));
  perform pg_temp.ck('...it points at the disputed line and the dispute', 'true',
    (select (calculation ->> 'corrects' = l2::text and calculation ->> 'dispute_id' = d1::text) from public.earnings_ledger where id = v_adj)::text);
  perform pg_temp.ck('...signed by the admin', v_admin::text, (select created_by::text from public.earnings_ledger where id = v_adj));
  perform pg_temp.ck('...the dispute records the resolution', 'adjusted/' || v_adj::text, (select state || '/' || adjustment_ledger_id from public.earnings_disputes where id = d1));
  perform pg_temp.ck('the disputed line itself is unchanged (append only)', '70000', (select amount_kobo::text from public.earnings_ledger where id = l2));
  perform pg_temp.ck('the correction is dated like the line it corrects (same payout period, never a week behind)', 'true',
    (select (a.earned_at = l.earned_at) from public.earnings_ledger a, public.earnings_ledger l where a.id = v_adj and l.id = l2)::text);
  perform pg_temp.ck('resolving again is refused', 'dispute_not_open', pg_temp.try_as(v_admin, format($q$select public.resolve_earnings_dispute(%L, 'rejected', null, 'a perfectly good reason')$q$, d1)));
  perform pg_temp.ck('only one adjustment exists for the dispute (a retry cannot double post)', '1', (select count(*) from public.earnings_ledger where kind = 'adjustment' and reference_id = d1)::text);

  perform pg_temp.ck('the adjustment can never be edited', '23514', pg_temp.try_sql(format($q$update public.earnings_ledger set amount_kobo = 1 where id = %L$q$, v_adj)));
  perform pg_temp.ck('...nor deleted', '23514', pg_temp.try_sql(format($q$delete from public.earnings_ledger where id = %L$q$, v_adj)));
  perform pg_temp.ck('a resolved dispute cannot be edited, even by a function-level writer', '23514',
    pg_temp.try_sql(format($q$select set_config('tarragon.dispute_write', 'on', true); update public.earnings_disputes set state = 'open', resolved_at = null where id = %L$q$, d1)));
  perform pg_temp.ck('a dispute cannot be written outside the functions', '42501', pg_temp.try_sql(format($q$update public.earnings_disputes set note = 'x' where id = %L$q$, d1)));
  perform pg_temp.ck('a dispute is never deleted', '42501', pg_temp.try_sql(format($q$delete from public.earnings_disputes where id = %L$q$, d1)));
  perform pg_temp.ck('a system adjustment without a stated reason is refused (no anonymous money)', '23514',
    pg_temp.try_sql(format($q$select private.ledger_insert(%L, %L, 'adjustment', 'manual', gen_random_uuid(), -5, null, '{}'::jsonb, now(), false, 'a note long enough', null)$q$, v_org, v_a)));

  -- the released line pays in the next period together with the correction
  v_n := private.build_payout_drafts(v_org, (now() at time zone 'Africa/Lagos')::date, false, v_a);
  perform pg_temp.ck('after resolution the line and its correction form a new draft (70000 + 40000)', '1/110000/2',
    v_n || '/' || (select amount_kobo || '/' || line_count from public.payouts where clinician_id = v_a and state = 'draft'));

  -- B: withdraw path, correction path, reject path, in and out of the draft
  perform pg_temp.act(v_b); dB := public.open_earnings_dispute(lb, 'missing_work', null); perform pg_temp.back();
  perform pg_temp.ck('B''s draft falls under the minimum without the disputed line: no draft, line carried over', '0',
    (select count(*) from public.payouts where clinician_id = v_b and state = 'draft')::text);
  perform pg_temp.ck('...and the disputed line is still unpaid and untouched', 'null/200000', coalesce((select payout_id::text from public.earnings_ledger where id = lb), 'null') || '/' || (select amount_kobo from public.earnings_ledger where id = lb));
  perform pg_temp.act(v_b); perform public.withdraw_earnings_dispute(dB); perform pg_temp.back();
  perform pg_temp.ck('withdrawn: the draft is back at 221000/3', '221000/3', (select amount_kobo || '/' || line_count from public.payouts where clinician_id = v_b and state = 'draft'));
  perform pg_temp.ck('...a withdrawn dispute is final', 'dispute_not_open', pg_temp.try_as(v_b, format('select public.withdraw_earnings_dispute(%L)', dB)));
  -- the correction joins the released line in the SAME rebuilt draft
  perform pg_temp.act(v_b); dB2 := public.open_earnings_dispute(lb, 'duplicate', null); perform pg_temp.back();
  perform pg_temp.act(v_admin); perform public.resolve_earnings_dispute(dB2, 'adjusted', -50000, 'Part of this was counted twice; taking it back'); perform pg_temp.back();
  perform pg_temp.ck('a negative correction is in the same rebuilt draft as the released line (200000 + 1000 + 20000 - 50000)', '171000/4',
    (select amount_kobo || '/' || line_count from public.payouts where clinician_id = v_b and state = 'draft'));
  -- rejected: no adjustment, line released
  perform pg_temp.act(v_b); dB3 := public.open_earnings_dispute(lb2, 'other', null); perform pg_temp.back();
  perform pg_temp.ck('only the questioned 20000 line leaves the draft', '151000/3', (select amount_kobo || '/' || line_count from public.payouts where clinician_id = v_b and state = 'draft'));
  perform pg_temp.act(v_admin); perform public.resolve_earnings_dispute(dB3, 'rejected', null, 'Checked: this is one task, not a duplicate'); perform pg_temp.back();
  perform pg_temp.ck('rejected: no adjustment line, the line stands and is released', '0/rejected',
    (select count(*) from public.earnings_ledger where kind = 'adjustment' and reference_id = dB3) || '/' || (select state from public.earnings_disputes where id = dB3));
  perform pg_temp.ck('...the draft is back at 171000/4', '171000/4', (select amount_kobo || '/' || line_count from public.payouts where clinician_id = v_b and state = 'draft'));
  perform pg_temp.ck('the admin list shows the open and answered disputes', 'true',
    (pg_temp.q_as(v_admin, $q$select (count(*) >= 4)::text from public.list_earnings_disputes(null)$q$)));
  perform pg_temp.ck('only an admin lists disputes', 'fee_not_authorised', pg_temp.try_as(v_a, 'select * from public.list_earnings_disputes()'));
end $$;

-- 3. Withholding: stored, not calculated ---------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); v_admin uuid := pg_temp.f('admin'); v_a uuid := pg_temp.f('a'); v_b uuid := pg_temp.f('b');
  v_pb uuid; v_pa uuid := pg_temp.f('pay_a'); r jsonb;
begin
  select id into v_pb from public.payouts where clinician_id = v_b and state = 'draft'; perform pg_temp.setf('pay_b', v_pb);
  perform pg_temp.ck('withholding defaults to zero', '0', (select withholding_kobo::text from public.payouts where id = v_pb));
  perform pg_temp.ck('no rate or percentage column exists on payouts', 'false',
    (select exists (select 1 from information_schema.columns where table_name = 'payouts' and table_schema = 'public' and column_name ~ '(pct|percent|rate)')::text));
  perform pg_temp.ck('only an admin sets withholding', 'payout_not_authorised', pg_temp.try_as(v_b, format('select public.set_payout_withholding(%L, 100, ''a note long enough'')', v_pb)));
  perform pg_temp.ck('a withholding needs a note', 'earnings_reason_needed', pg_temp.try_as(v_admin, format('select public.set_payout_withholding(%L, 5000, null)', v_pb)));
  perform pg_temp.ck('a withholding equal to the payout is refused', 'payout_bad_withholding', pg_temp.try_as(v_admin, format('select public.set_payout_withholding(%L, 171000, ''a note long enough'')', v_pb)));
  perform pg_temp.ck('a negative withholding is refused', 'payout_bad_withholding', pg_temp.try_as(v_admin, format('select public.set_payout_withholding(%L, -1, ''a note long enough'')', v_pb)));
  perform pg_temp.ck('the typed withholding is saved', 'ok', pg_temp.try_as(v_admin, format('select public.set_payout_withholding(%L, 5000, ''Entered by finance for the proof'')', v_pb)));
  perform pg_temp.ck('STORED, NOT COMPUTED: gross is untouched, withholding is exactly what was typed', '171000/5000',
    (select amount_kobo || '/' || withholding_kobo from public.payouts where id = v_pb));
  perform pg_temp.ck('a payout with a withholding cannot be APPROVED (it could never be sent, and could not be edited afterwards)', 'payout_withholding_undecided',
    pg_temp.try_as(v_admin, format('select public.approve_payout(%L)', v_pb)));
  -- a dispute rebuilds the draft: the typed withholding is carried over, not dropped
  perform pg_temp.setf('lb3', pg_temp.line(pg_temp.f('org'), v_b, v_admin, 5000, '3 days'));
  perform pg_temp.act(v_b); perform public.withdraw_earnings_dispute(public.open_earnings_dispute(pg_temp.f('lb3'), 'other', null)); perform pg_temp.back();
  perform pg_temp.ck('a line already answered cannot be questioned again', 'dispute_already_answered', pg_temp.try_as(v_b, format('select public.open_earnings_dispute(%L, ''other'')', pg_temp.f('lb2'))));
  perform pg_temp.ck('a deduction cannot be questioned to keep it out of a payout', 'dispute_negative_line',
    pg_temp.try_as(v_b, format('select public.open_earnings_dispute(%L, ''other'')', (select id from public.earnings_ledger where clinician_id = v_b and amount_kobo < 0 limit 1))));
  perform pg_temp.ck('the withholding survives a rebuilt draft', '176000/5000/Entered by finance for the proof',
    (select amount_kobo || '/' || withholding_kobo || '/' || withholding_note from public.payouts where clinician_id = v_b and state = 'draft'));
  select id into v_pb from public.payouts where clinician_id = v_b and state = 'draft'; perform pg_temp.setf('pay_b', v_pb);
  perform pg_temp.act(v_admin); perform public.set_payout_withholding(v_pb, 0, null); perform pg_temp.back();
  perform pg_temp.ck('...and it can be cleared to zero', '0', (select withholding_kobo::text from public.payouts where id = v_pb));
  perform pg_temp.act(v_admin); r := public.approve_payout(v_pb); perform pg_temp.back();
  perform pg_temp.ck('an approved payout''s withholding cannot be set by the function', 'payout_not_a_draft', pg_temp.try_as(v_admin, format('select public.set_payout_withholding(%L, 1, ''a note long enough'')', v_pb)));
  perform pg_temp.ck('...nor by a function-level writer', '23514',
    pg_temp.try_sql(format($q$select set_config('tarragon.payout_write', 'on', true); update public.payouts set withholding_kobo = 1 where id = %L$q$, v_pb)));
  -- to prove the statement arithmetic and the send refusal, put a withholding on the approved payout with the guard briefly off
  alter table public.payouts disable trigger payouts_withholding_guard;
  perform set_config('tarragon.payout_write', 'on', true);
  update public.payouts set withholding_kobo = 5000, withholding_note = 'Entered by finance for the proof' where id = v_pb;
  perform set_config('tarragon.payout_write', 'off', true);
  alter table public.payouts enable trigger payouts_withholding_guard;
  perform pg_temp.ck('a payout carrying a withholding is refused at send', 'payout_withholding_undecided', pg_temp.try_as(v_admin, format('select public.payout_prepare_send(%L)', v_pb)));
  r := (pg_temp.q_as(v_b, format('select public.my_payout_statement(%L)::text', v_pb)))::jsonb;
  perform pg_temp.ck('statement: gross 171000, withholding 5000, net 166000', '176000/5000/171000', (r ->> 'gross_kobo') || '/' || (r ->> 'withholding_kobo') || '/' || (r ->> 'net_kobo'));
  r := (pg_temp.q_as(v_b, 'select public.my_payout_overview()::text'))::jsonb;
  perform pg_temp.ck('overview: net and withholding per payout', '171000/5000', (r -> 'payouts' -> 0 ->> 'net_kobo') || '/' || (r -> 'payouts' -> 0 ->> 'withholding_kobo'));
  perform pg_temp.ck('A''s payout has no withholding so it can be sent', 'ok', pg_temp.try_as(v_admin, format('select public.payout_prepare_send(%L)', v_pa)));
end $$;

-- 4. Pay status joined to the S31 payout, with the existing retry ---------------------------------------------------------------
do $$
declare
  v_admin uuid := pg_temp.f('admin'); v_a uuid := pg_temp.f('a'); v_pa uuid := pg_temp.f('pay_a'); l1 uuid := pg_temp.f('l1'); l3 uuid := pg_temp.f('l3');
  v_ref text; v_ref2 text; r jsonb;
begin
  select reference into v_ref from public.payout_transfers where payout_id = v_pa order by attempt desc limit 1;
  perform public.payout_record_send(v_ref, 'pending', 'TRF_a1');
  perform pg_temp.ck('status: sent still reads as approved', 'approved', pg_temp.q_as(v_a, format('select pay_status from public.my_earnings_lines() where id = %L', l1)));
  perform public.apply_payout_transfer_event('transfer.failed', v_ref, 'TRF_a1', 'no funds');
  perform pg_temp.ck('status: a failed transfer reads as failed on each of its lines', 'failed/failed',
    pg_temp.q_as(v_a, format('select pay_status from public.my_earnings_lines() where id = %L', l1)) || '/' || pg_temp.q_as(v_a, format('select pay_status from public.my_earnings_lines() where id = %L', l3)));
  perform pg_temp.act(v_admin); r := public.retry_payout(v_pa); perform pg_temp.back();
  v_ref2 := r ->> 'reference';
  perform pg_temp.ck('retry (existing S31 path) makes a new attempt and the lines read approved again', 'approved',
    pg_temp.q_as(v_a, format('select pay_status from public.my_earnings_lines() where id = %L', l1)));
  perform public.payout_record_send(v_ref2, 'pending', 'TRF_a2');
  perform public.apply_payout_transfer_event('transfer.success', v_ref2, 'TRF_a2');
  perform pg_temp.ck('status: a succeeded payout reads as paid', 'paid/paid',
    pg_temp.q_as(v_a, format('select pay_status from public.my_earnings_lines() where id = %L', l1)) || '/' || pg_temp.q_as(v_a, format('select pay_status from public.my_earnings_lines() where id = %L', l3)));
  perform pg_temp.ck('once paid, a line can still be questioned (the correction comes in a later payout)', 'ok',
    pg_temp.try_as(v_a, format('select public.open_earnings_dispute(%L, ''wrong_amount'')', l1)));
  perform pg_temp.ck('status: the released line with its correction is pending', 'pending',
    pg_temp.q_as(v_a, format('select pay_status from public.my_earnings_lines() where id = %L', pg_temp.f('l2'))));
end $$;

-- 5. Pilot minimum: activity check, release/deny, late-line netting ------------------------------------------------------------
do $$
declare
  v_org uuid := pg_temp.f('org'); v_admin uuid := pg_temp.f('admin'); v_p uuid := pg_temp.f('p');
  v_c uuid := pg_temp.f('c'); v_d uuid := pg_temp.f('d'); v_f uuid := pg_temp.f('fz'); v_g uuid := pg_temp.f('g');
  t1 uuid; t2 uuid; v_sched uuid; v_top uuid; v_n integer;
begin
  -- a fee schedule with a pilot minimum of 250000 kobo per declared hour
  perform pg_temp.act(v_admin);
  v_sched := public.create_fee_schedule_draft('{"task_types":{"admin_clinical":{"base_fee_kobo":50000,"wait_multiplier_steps":[]}},"on_call_shift_fee_kobo":0,"lead_fee_per_patient_month_kobo":0,"consultation_share_pct":{"video":0,"audio":0,"phone":0},"pilot_minimum_per_declared_hour_kobo":250000}'::jsonb, 'S30b proof');
  perform public.approve_fee_schedule(v_sched); perform pg_temp.back();
  perform pg_temp.setf('sched', v_sched);
  -- two tasks nobody took: T1 for 40 hours, T2 for 135 hours
  t1 := private.create_clinical_task(v_p, 'symptom_review', null); perform pg_temp.backdate(t1, 'created_at = now() - interval ''40 hours''');
  t2 := private.create_clinical_task(v_p, 'amber_bp_review', null); perform pg_temp.backdate(t2, 'created_at = now() - interval ''135 hours''');
  perform pg_temp.setf('t1', t1);
  -- C: 8 hours, 30h to 22h ago, no claims, work waited -> HELD
  perform pg_temp.block(v_org, v_c, '30 hours', '22 hours');
  -- D: 54h to 46h ago, one completed claim inside -> paid
  perform pg_temp.block(v_org, v_d, '54 hours', '46 hours');
  insert into public.task_claims (organisation_id, task_id, clinician_id, claimed_at, expires_at, ended_at, end_reason, is_test)
  values (v_org, t1, v_d, now() - interval '50 hours', now() - interval '49 hours', now() - interval '49 hours 30 minutes', 'completed', true);
  -- F: 78h to 70h ago, one claim that timed out and none finished -> HELD
  perform pg_temp.block(v_org, v_f, '78 hours', '70 hours');
  insert into public.task_claims (organisation_id, task_id, clinician_id, claimed_at, expires_at, ended_at, end_reason, is_test)
  values (v_org, t1, v_f, now() - interval '74 hours', now() - interval '73 hours', now() - interval '73 hours', 'expired', true);
  -- G: 170h to 162h ago, before any task existed: an empty queue is not their fault -> paid
  perform pg_temp.block(v_org, v_g, '170 hours', '162 hours');

  v_n := private.post_minimum_topups();
  perform pg_temp.ck('the run posts two top-ups (D with real work, G with a quiet queue) and holds two', '2/2',
    v_n || '/' || (select count(*) from public.earnings_topup_holds where state = 'held'));
  perform pg_temp.ck('C (no claims while work waited) is held, not paid', 'held/0',
    (select reason from public.earnings_topup_holds where clinician_id = v_c) || '/' || pg_temp.lines_of(v_c, 'minimum_topup'));
  perform pg_temp.ck('...the hold records what was seen', 'true',
    (select ((evidence ->> 'claims')::int = 0 and (evidence ->> 'tasks_waiting')::int >= 1 and (evidence ->> 'top_up_kobo')::bigint = 2000000) from public.earnings_topup_holds where clinician_id = v_c)::text);
  perform pg_temp.ck('F (timed-out claims, none finished) is held, not paid', 'expired_claims_and_no_completed/0',
    (select reason from public.earnings_topup_holds where clinician_id = v_f) || '/' || pg_temp.lines_of(v_f, 'minimum_topup'));
  perform pg_temp.ck('D (a finished claim) is paid the full guarantee', '2000000', (select amount_kobo::text from public.earnings_ledger where clinician_id = v_d and kind = 'minimum_topup'));
  perform pg_temp.ck('G (empty queue) is paid the full guarantee', '2000000', (select amount_kobo::text from public.earnings_ledger where clinician_id = v_g and kind = 'minimum_topup'));
  perform pg_temp.ck('running it again changes nothing (holds are not duplicated, nothing posts twice)', '0/2/2',
    private.post_minimum_topups() || '/' || (select count(*) from public.earnings_topup_holds) || '/' || (select count(*) from public.earnings_ledger where kind = 'minimum_topup'));

  -- a person decides
  perform pg_temp.ck('a clinician cannot decide a hold', 'fee_not_authorised', pg_temp.try_as(v_c, format($q$select public.decide_topup_hold(%L, 'released', 'trying to pay myself')$q$, (select id from public.earnings_topup_holds where clinician_id = v_c))));
  perform pg_temp.ck('a decision needs a reason', 'earnings_reason_needed', pg_temp.try_as(v_admin, format($q$select public.decide_topup_hold(%L, 'released', 'x')$q$, (select id from public.earnings_topup_holds where clinician_id = v_c))));
  perform pg_temp.act(v_admin);
  perform public.decide_topup_hold((select id from public.earnings_topup_holds where clinician_id = v_c), 'released', 'Checked with the lead: the app was down that day');
  perform public.decide_topup_hold((select id from public.earnings_topup_holds where clinician_id = v_f), 'denied', 'Claims timed out and nothing was finished');
  perform pg_temp.back();
  perform pg_temp.ck('a released hold is paid in the same step (it cannot be lost to the look-back window)', '2000000', (select amount_kobo::text from public.earnings_ledger where clinician_id = v_c and kind = 'minimum_topup'));
  perform pg_temp.ck('a decided hold cannot be decided again', 'hold_already_decided', pg_temp.try_as(v_admin, format($q$select public.decide_topup_hold(%L, 'denied', 'changing my mind now')$q$, (select id from public.earnings_topup_holds where clinician_id = v_c))));
  perform pg_temp.ck('...nor edited', '23514', pg_temp.try_sql(format($q$select set_config('tarragon.dispute_write', 'on', true); update public.earnings_topup_holds set state = 'held', decided_at = null, decided_by = null where clinician_id = %L$q$, v_c)));
  perform private.post_minimum_topups();
  perform pg_temp.ck('...and the daily job does not pay it a second time', '1', pg_temp.lines_of(v_c, 'minimum_topup')::text);
  perform pg_temp.ck('a denied hold is never paid', '0', pg_temp.lines_of(v_f, 'minimum_topup')::text);

  -- late-line netting (OQ-185): D earned 600000 inside the run after the top-up was posted
  select id into v_top from public.earnings_ledger where clinician_id = v_d and kind = 'minimum_topup';
  perform private.ledger_insert(v_org, v_d, 'task', 'clinical_task', gen_random_uuid(), 600000, v_sched, '{}'::jsonb, now() - interval '48 hours', true);
  v_n := private.post_minimum_topups();
  perform pg_temp.ck('a late line inside the run is netted off the top-up by a system adjustment', '1/-600000',
    v_n || '/' || (select amount_kobo from public.earnings_ledger where clinician_id = v_d and kind = 'adjustment'));
  perform pg_temp.ck('...it points at the top-up, names its reason and has no human author', 'true',
    (select (calculation ->> 'corrects' = v_top::text and calculation ->> 'system_reason' = 'late_line_netting' and created_by is null) from public.earnings_ledger where clinician_id = v_d and kind = 'adjustment')::text);
  perform pg_temp.ck('...running again posts nothing more (idempotent)', '0/1', private.post_minimum_topups() || '/' || pg_temp.lines_of(v_d, 'adjustment'));
  perform private.ledger_insert(v_org, v_d, 'task', 'clinical_task', gen_random_uuid(), 100000, v_sched, '{}'::jsonb, now() - interval '47 hours', true);
  perform private.post_minimum_topups();
  perform pg_temp.ck('a second late line nets only its own part: top-up plus adjustments is the shortfall (guarantee less all earned)', '1300000',
    (select sum(amount_kobo)::text from public.earnings_ledger where clinician_id = v_d and kind in ('minimum_topup', 'adjustment')));
  perform pg_temp.ck('...earned in the run plus the net top-up equals the guarantee', '2000000',
    (select sum(amount_kobo)::text from public.earnings_ledger where clinician_id = v_d and kind in ('minimum_topup', 'adjustment', 'task')));
end $$;

-- 6. Access ---------------------------------------------------------------------------------------------------------------------
do $$
declare v_admin uuid := pg_temp.f('admin'); v_a uuid := pg_temp.f('a'); v_b uuid := pg_temp.f('b'); v_c uuid := pg_temp.f('c');
begin
  perform pg_temp.ck('A sees only their own disputes', '0', pg_temp.q_as(v_a, format('select count(*) from public.earnings_disputes where clinician_id <> %L', v_a)));
  perform pg_temp.ck('...and does see their own', '2', pg_temp.q_as(v_a, format('select count(*) from public.earnings_disputes where clinician_id = %L', v_a)));
  perform pg_temp.ck('B sees none of A''s disputes', '0', pg_temp.q_as(v_b, format('select count(*) from public.earnings_disputes where clinician_id = %L', v_a)));
  perform pg_temp.ck('the admin sees every dispute', 'true', (pg_temp.q_as(v_admin, 'select (count(*) >= 3)::text from public.earnings_disputes')));
  perform pg_temp.ck('a clinician cannot insert a dispute', 'permission denied for table earnings_disputes',
    pg_temp.try_as(v_a, format($q$insert into public.earnings_disputes (organisation_id, ledger_id, clinician_id, reason_code, request_id, response_due_at) select organisation_id, id, clinician_id, 'other', gen_random_uuid(), now() from public.earnings_ledger where clinician_id = %L limit 1$q$, v_a)));
  perform pg_temp.ck('a clinician cannot update a dispute', 'permission denied for table earnings_disputes', pg_temp.try_as(v_a, $q$update public.earnings_disputes set state = 'rejected'$q$));
  perform pg_temp.ck('a clinician cannot read the top-up holds', '0', pg_temp.q_as(v_c, 'select count(*) from public.earnings_topup_holds'));
  perform pg_temp.ck('the admin can read the top-up holds', 'true', (pg_temp.q_as(v_admin, 'select (count(*) >= 3)::text from public.earnings_topup_holds')));
  perform pg_temp.ck('a clinician cannot read the dispute config', '0', pg_temp.q_as(v_a, 'select count(*) from public.earnings_disputes_config'));
  perform pg_temp.ck('a clinician cannot list holds', 'fee_not_authorised', pg_temp.try_as(v_a, 'select * from public.list_topup_holds()'));
  perform pg_temp.ck('a clinician cannot set a withholding', 'payout_not_authorised', pg_temp.try_as(v_a, format('select public.set_payout_withholding(%L, 1, ''a note long enough'')', pg_temp.f('pay_b'))));
  perform pg_temp.ck('anon cannot read disputes', 'permission denied for table earnings_disputes', pg_temp.try_anon('select count(*) from public.earnings_disputes'));
  perform pg_temp.ck('anon cannot read holds', 'permission denied for table earnings_topup_holds', pg_temp.try_anon('select count(*) from public.earnings_topup_holds'));
  perform pg_temp.ck('anon cannot read a statement', 'permission denied for function my_payout_statement', pg_temp.try_anon(format('select public.my_payout_statement(%L)', pg_temp.f('pay_a'))));
  perform pg_temp.ck('the internal helpers are not callable by clients', 'permission denied for function refresh_payout_draft', pg_temp.try_as(v_admin, format('select private.refresh_payout_draft(%L)', v_a)));
end $$;

-- 6b. Withholding is carried only within the SAME period; a correction to an already-paid line is dated now; double-tap handling ----------
do $$
declare
  v_org uuid := pg_temp.f('org'); v_admin uuid := pg_temp.f('admin'); v_a uuid := pg_temp.f('a'); l1 uuid := pg_temp.f('l1');
  v_y uuid; v_pid uuid; x date := private.payout_last_period_end(); d_paid uuid; v_adj uuid;
begin
  v_y := pg_temp.mkdoc(v_org, 'docY', 'contracted', v_admin); perform pg_temp.go_real(v_y, 'Yetunde Ife Bakare'); perform pg_temp.setf('y', v_y);
  perform pg_temp.line(v_org, v_y, v_admin, 100000, '10 days'); perform pg_temp.line(v_org, v_y, v_admin, 100000, '9 days');
  perform pg_temp.line(v_org, v_y, v_admin, 100000, '8 days'); perform pg_temp.line(v_org, v_y, v_admin, 100000, '7 days');
  perform private.build_payout_drafts(v_org, x, false, v_y);
  select id into v_pid from public.payouts where clinician_id = v_y and state = 'draft';
  perform pg_temp.act(v_admin); perform public.set_payout_withholding(v_pid, 5000, 'Entered by finance for the proof'); perform pg_temp.back();
  perform pg_temp.ck('setup: Y has a draft with a typed withholding', '400000/5000', (select amount_kobo || '/' || withholding_kobo from public.payouts where id = v_pid));
  perform private.build_payout_drafts(v_org, x + 7, false, v_y);
  perform pg_temp.ck('a replacement draft for a DIFFERENT period does not inherit the withholding', '400000/0',
    (select amount_kobo || '/' || withholding_kobo from public.payouts where clinician_id = v_y and state = 'draft'));
  select id into v_pid from public.payouts where clinician_id = v_y and state = 'draft';
  perform pg_temp.act(v_admin); perform public.set_payout_withholding(v_pid, 5000, 'Entered by finance for the proof'); perform pg_temp.back();
  perform private.build_payout_drafts(v_org, x + 7, true, v_y);
  perform pg_temp.ck('a forced rebuild of the SAME period keeps the withholding', '400000/5000',
    (select amount_kobo || '/' || withholding_kobo from public.payouts where clinician_id = v_y and state = 'draft'));

  -- 7: a correction to a line already in a SUCCEEDED payout is dated now; one to an unpaid line keeps the line's date (checked in section 2)
  select id into d_paid from public.earnings_disputes where ledger_id = l1 and state = 'open';
  perform pg_temp.act(v_admin); v_adj := (public.resolve_earnings_dispute(d_paid, 'adjusted', 1000, 'Agreed: a small shortfall on a paid line')) ->> 'adjustment_ledger_id'; perform pg_temp.back();
  perform pg_temp.ck('a correction to an already-paid line is dated now, not back into a closed period', 'now/true',
    (select case when a.earned_at = now() then 'now' else 'backdated' end || '/' || (a.earned_at <> l.earned_at)::text
       from public.earnings_ledger a, public.earnings_ledger l where a.id = v_adj and l.id = l1));

  -- 4: the double-tap handling is in the function (a true race needs two connections, so this checks the code is there;
  -- the sequential double tap is proved in section 1)
  perform pg_temp.ck('the open function re-checks the request id after the lock and survives a raced duplicate', 'handled',
    case when pg_get_functiondef('public.open_earnings_dispute(uuid,text,text,uuid)'::regprocedure) like '%when unique_violation%'
          and pg_get_functiondef('public.open_earnings_dispute(uuid,text,text,uuid)'::regprocedure) like '%a second tap that waited on the lock%' then 'handled' else 'missing' end);
end $$;

-- 7. SABOTAGE -------------------------------------------------------------------------------------------------------------------
-- Z has three free lines and opens a dispute on the third; the real behaviour is a draft of the other two.
do $$
declare v_org uuid := pg_temp.f('org'); v_admin uuid := pg_temp.f('admin'); v_z uuid := pg_temp.f('z'); z3 uuid; dz uuid;
begin
  perform pg_temp.line(v_org, v_z, v_admin, 100000, '10 days'); perform pg_temp.line(v_org, v_z, v_admin, 100000, '9 days'); z3 := pg_temp.line(v_org, v_z, v_admin, 50000, '8 days');
  perform pg_temp.setf('z3', z3);
  perform private.build_payout_drafts(v_org, private.payout_last_period_end(), false, v_z);
  perform pg_temp.act(v_z); dz := public.open_earnings_dispute(z3, 'wrong_type', null); perform pg_temp.back();
  perform pg_temp.setf('dz', dz);
  perform pg_temp.ck('SAB-BASE: Z''s draft excludes the disputed line', '200000/2', (select amount_kobo || '/' || line_count from public.payouts where clinician_id = v_z and state = 'draft'));
end $$;

-- 7a. the dispute guard removed: a resolved dispute can be reopened, and a withdrawn-by-owner open dispute stops holding its line
alter table public.earnings_disputes disable trigger earnings_disputes_guard;
update public.earnings_disputes set state = 'withdrawn', resolved_at = now() where id = pg_temp.f('dz');
do $$
declare v_org uuid := pg_temp.f('org'); v_z uuid := pg_temp.f('z');
begin
  perform private.build_payout_drafts(v_org, private.payout_last_period_end(), true, v_z);
  insert into results values ('sabotaged', 'a dispute held open still keeps its line out of the draft', '200000/2',
    (select amount_kobo || '/' || line_count from public.payouts where clinician_id = v_z and state = 'draft'));
  insert into results values ('sabotaged', 'a resolved dispute cannot be edited', 'refused',
    case when pg_temp.try_sql(format($q$update public.earnings_disputes set note = 'x' where id = %L$q$, pg_temp.f('d1'))) = 'ok' then 'allowed' else 'refused' end);
end $$;

-- 7b. the ledger guard removed: an adjustment can be edited
drop trigger earnings_ledger_guard on public.earnings_ledger;
do $$
begin
  insert into results values ('sabotaged', 'the adjustment can never be edited', 'refused',
    case when pg_temp.try_sql(format($q$update public.earnings_ledger set amount_kobo = 1 where kind = 'adjustment' and reference_id = %L$q$, pg_temp.f('d1'))) = 'ok' then 'allowed' else 'refused' end);
end $$;

-- 7c. the withholding guard removed: an approved payout's withholding can change
drop trigger payouts_withholding_guard on public.payouts;
do $$
begin
  insert into results values ('sabotaged', 'an approved payout''s withholding cannot be changed', 'refused',
    case when pg_temp.try_sql(format($q$select set_config('tarragon.payout_write', 'on', true); update public.payouts set withholding_kobo = 2 where id = %L$q$, pg_temp.f('pay_b'))) = 'ok' then 'allowed' else 'refused' end);
end $$;

-- 7d. the activity check switched off: a run with no work and work waiting is paid instead of held
update public.earnings_disputes_config set rules = jsonb_set(rules, '{pilot_minimum,activity_check}', 'false') where is_active;
do $$
declare v_org uuid := pg_temp.f('org'); v_h uuid := pg_temp.f('h2');
begin
  perform pg_temp.block(v_org, v_h, '130 hours', '122 hours');
  perform private.post_minimum_topups();
  insert into results values ('sabotaged', 'a run with no work while tasks waited is held, not paid', 'held',
    case when exists (select 1 from public.earnings_ledger where clinician_id = v_h and kind = 'minimum_topup') then 'paid' else 'held' end);
end $$;

-- 7e. the period filter removed from the withholding carry: a draft for another period inherits it
do $$
declare
  v_org uuid := pg_temp.f('org'); v_y uuid := pg_temp.f('y'); x date := private.payout_last_period_end(); d text; n text;
begin
  d := pg_get_functiondef('private.build_payout_drafts(uuid,date,boolean,uuid)'::regprocedure);
  n := replace(d, 'state = ''draft'' and period_end = p_period_end;', 'state = ''draft'';');
  if n = d then raise exception 'sabotage 7e did not change the function'; end if;
  execute n;
  perform private.build_payout_drafts(v_org, x + 14, false, v_y);
  insert into results values ('sabotaged', 'a replacement draft for a DIFFERENT period does not inherit the withholding', '400000/0',
    (select amount_kobo || '/' || withholding_kobo from public.payouts where clinician_id = v_y and state = 'draft'));
end $$;

-- 7f. the back-dating rule removed: a correction to a paid line is dated into the closed period
do $$
declare
  v_admin uuid := pg_temp.f('admin'); v_a uuid := pg_temp.f('a'); l3 uuid := pg_temp.f('l3'); d text; n text; dd uuid; v_adj uuid;
begin
  d := pg_get_functiondef('public.resolve_earnings_dispute(uuid,text,bigint,text)'::regprocedure);
  n := replace(d, 'case when l.payout_id is null then l.earned_at else now() end', 'l.earned_at');
  if n = d then raise exception 'sabotage 7f did not change the function'; end if;
  execute n;
  perform pg_temp.act(v_a); dd := public.open_earnings_dispute(l3, 'wrong_amount', null); perform pg_temp.back();
  perform pg_temp.act(v_admin); v_adj := (public.resolve_earnings_dispute(dd, 'adjusted', 500, 'Agreed: another small shortfall'))->> 'adjustment_ledger_id'; perform pg_temp.back();
  insert into results values ('sabotaged', 'a correction to an already-paid line is dated now, not back into a closed period', 'now/true',
    (select case when a.earned_at = now() then 'now' else 'backdated' end || '/' || (a.earned_at <> l.earned_at)::text
       from public.earnings_ledger a, public.earnings_ledger l where a.id = v_adj and l.id = l3));
end $$;

-- 7g. the raced-duplicate handler removed
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.open_earnings_dispute(uuid,text,text,uuid)'::regprocedure);
  n := replace(d, 'exception when unique_violation then', 'exception when no_data_found then');
  if n = d then raise exception 'sabotage 7g did not change the function'; end if;
  execute n;
  insert into results values ('sabotaged', 'the open function re-checks the request id after the lock and survives a raced duplicate', 'handled',
    case when pg_get_functiondef('public.open_earnings_dispute(uuid,text,text,uuid)'::regprocedure) like '%when unique_violation%' then 'handled' else 'missing' end);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S30b proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 8 then raise exception 'VACUOUS TEST: the sabotage flipped % of 8 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
