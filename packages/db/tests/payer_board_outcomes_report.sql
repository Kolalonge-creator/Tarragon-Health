-- ===========================================================================
-- Verification: 20260902211636_payer_board_outcomes_report
--
-- The migration's own DO block proves structure (definitions have
-- implementations, hashes are tamper-evident, issued reports cannot be
-- rewritten). What it CANNOT prove, because a migration has no session, is
-- the part that actually matters to a board:
--
--   * the numbers are right — a fixture with a known answer (12 eligible, 10
--     measurable, 7 controlled) must come back as exactly 70.0% on a
--     denominator of 10, with 2 counted as not measurable and NOT as failures;
--   * a measure with too little data publishes NOTHING — null rate, null
--     counts, a stated reason, never a zero;
--   * an insurer cannot read another insurer's report — sabotage control;
--   * a payer cannot attest its own supplier's figures — sabotage control;
--   * regenerating supersedes rather than overwrites, and the superseded copy
--     still verifies, because printed copies of it exist.
--
-- Run via `npx supabase db query --linked -f <this file>` from the main
-- checkout, or psql -f. Wrapped in BEGIN/ROLLBACK: it enables the dormant
-- payer_platform module for the duration and always puts it back.
--
-- Pattern follows packages/db/tests/wearable_granular_consent_and_patient_control.sql:
-- set_config('request.jwt.claims') + role switching simulates a real client
-- session, because running as the connecting superuser bypasses RLS through
-- table ownership and would prove nothing.
-- ===========================================================================

begin;

create temporary table pbor_fix(k text primary key, v uuid) on commit drop;
create temporary table pbor_result(
  check_name text,
  observed   text,
  expected   text,
  verdict    text
) on commit drop;

-- The fixture table is read while the session is impersonating a client role,
-- so it needs the same grant any other table would.
grant select on pbor_fix to authenticated, anon;
grant select, insert on pbor_result to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Fixtures.
--
-- The cohort is built so every number below is arithmetic a reader can check
-- by hand, not something the engine gets to define for itself:
--   12 patients, all continuously covered by insurer A for Q1 2026,
--   all with an active hypertension diagnosis           -> denominator 12
--   10 of them have a BP reading inside the period      -> measurable 10
--    7 of those readings are under 140/90               -> numerator 7
--    2 have no reading at all                           -> unmeasurable 2
-- Expected published rate: 7/10 = 70.0%, completeness 10/12 = 83.3%.
-- Nobody has diabetes, so the glycaemic measure must publish nothing at all.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org       uuid;
  v_insurer_a uuid := gen_random_uuid();
  v_insurer_b uuid := gen_random_uuid();
  v_payer_a   uuid := gen_random_uuid();
  v_payer_b   uuid := gen_random_uuid();
  v_admin     uuid;
  v_pid       uuid;
  i           integer;
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then raise exception 'no organisation available — cannot run this test'; end if;

  -- The module ships dormant; every RPC below asserts it. Enabled here and
  -- rolled back with everything else at the end of the file.
  -- platform_modules_enabled_has_attribution: switching a module on is an
  -- attributed act, even in a test that rolls it back.
  update public.platform_modules
     set is_enabled = true, enabled_at = now(),
         enabled_by = (select id from public.profiles where role = 'admin' and is_active limit 1),
         activation_note = 'Temporarily enabled inside a rolled-back verification transaction.'
   where key = 'payer_platform';

  insert into public.insurers (id, name, code, is_active, onboarding_status, min_cohort_size)
  values (v_insurer_a, 'PBOR Test Insurer A', 'PBORA', true, 'live', 10),
         (v_insurer_b, 'PBOR Test Insurer B', 'PBORB', true, 'live', 10);

  -- A real Tarragon superadmin, for the attestation half.
  select id into v_admin from public.profiles where role = 'admin' and is_active limit 1;
  if v_admin is null then raise exception 'no active admin profile — cannot test attestation'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_payer_a, 'pbor-payer-a@example.invalid', 'x', now(), '{}', '{}'),
         (v_payer_b, 'pbor-payer-b@example.invalid', 'x', now(), '{}', '{}');
  -- A trigger on auth.users already provisions the profile row, so shape the
  -- existing one rather than inserting a second.
  insert into public.profiles (id, organisation_id, role, full_name, is_active)
  values (v_payer_a, v_org, 'payer_admin', 'PBOR Payer A Analyst', true),
         (v_payer_b, v_org, 'payer_admin', 'PBOR Payer B Analyst', true)
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role,
        full_name = excluded.full_name, is_active = excluded.is_active;

  insert into public.payer_administrators (insurer_id, profile_id, payer_role, is_active)
  values (v_insurer_a, v_payer_a, 'analyst', true),
         (v_insurer_b, v_payer_b, 'analyst', true);

  for i in 1..12 loop
    v_pid := gen_random_uuid();
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (v_pid, 'pbor-patient-' || i || '@example.invalid', 'x', now(), '{}', '{}');
    insert into public.profiles (id, organisation_id, role, full_name, is_active)
    values (v_pid, v_org, 'patient', 'PBOR Patient ' || i, true)
    on conflict (id) do update
      set organisation_id = excluded.organisation_id, role = excluded.role,
          full_name = excluded.full_name, is_active = excluded.is_active;

    -- Continuously covered: in force before the period opened, still open.
    insert into public.insurance_policies (
      organisation_id, patient_id, insurer_id, member_id, plan_name,
      effective_from, status, verified_at)
    values (v_org, v_pid, v_insurer_a, 'PBOR' || lpad(i::text, 3, '0'), 'PBOR Standard',
            date '2025-06-01', 'active', now());

    insert into public.patient_conditions (
      organisation_id, patient_id, condition_name, icd10_code, status, date_identified)
    values (v_org, v_pid, 'hypertension', 'I10', 'active', date '2025-07-01');

    -- source='device', not 'manual': private.stamp_manual_vitals_timestamp()
    -- overwrites taken_at with clock_timestamp() for manual entries, so a
    -- manually-logged reading can never be backdated. A paired cuff carries
    -- its own timestamp, which is what a historical period needs.
    -- Patients 1-7 controlled, 8-10 not, 11-12 no reading at all.
    if i <= 7 then
      insert into public.vitals_readings (
        organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
      values (v_org, v_pid, 'blood_pressure', 128, 82, timestamptz '2026-02-14 09:00+01', 'device');
    elsif i <= 10 then
      insert into public.vitals_readings (
        organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
      values (v_org, v_pid, 'blood_pressure', 146, 93, timestamptz '2026-02-14 09:00+01', 'device');
    end if;
  end loop;

  -- A reading OUTSIDE the period for one of the two unmeasured patients: it
  -- must not rescue them into the denominator's measurable half, or the
  -- measure is silently using stale data to flatter completeness.
  insert into public.vitals_readings (
    organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  select v_org, ip.patient_id, 'blood_pressure', 120, 78, timestamptz '2025-12-01 09:00+01', 'device'
  from public.insurance_policies ip
  where ip.insurer_id = v_insurer_a and ip.member_id = 'PBOR011';

  insert into pbor_fix(k, v) values
    ('org', v_org), ('insurer_a', v_insurer_a), ('insurer_b', v_insurer_b),
    ('payer_a', v_payer_a), ('payer_b', v_payer_b), ('admin', v_admin);
end $$;

-- ---------------------------------------------------------------------------
-- 1. Generation as the insurer's own analyst seat, and the arithmetic.
-- ---------------------------------------------------------------------------
do $$
declare
  v_res      jsonb;
  v_report   uuid;
  v_snap     jsonb;
  v_bp       jsonb;
  v_gly      jsonb;
  v_hash     text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from pbor_fix where k = 'payer_a'), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  v_res := public.generate_payer_board_report(
    (select v from pbor_fix where k = 'insurer_a'), date '2026-01-01', date '2026-03-31');

  perform set_config('role', 'postgres', true);

  v_report := (v_res ->> 'report_id')::uuid;
  select snapshot, content_hash into v_snap, v_hash
    from public.payer_board_reports where id = v_report;
  insert into pbor_fix(k, v) values ('report_1', v_report);

  select m into v_bp  from jsonb_array_elements(v_snap -> 'measures') m where m ->> 'code' = 'bp_control';
  select m into v_gly from jsonb_array_elements(v_snap -> 'measures') m where m ->> 'code' = 'glycaemic_control';

  insert into pbor_result values
    ('an analyst seat can generate a report',
     (v_res ->> 'ok'), 'true', case when v_res ->> 'ok' = 'true' then 'PASS' else 'FAIL' end),
    ('report number is issued in the documented format',
     v_res ->> 'report_number', 'TAR-PBORA-2026-0001',
     case when v_res ->> 'report_number' = 'TAR-PBORA-2026-0001' then 'PASS' else 'FAIL' end),
    ('cohort: 12 continuously covered',
     v_snap -> 'cohort' ->> 'continuously_covered', '12',
     case when v_snap -> 'cohort' ->> 'continuously_covered' = '12' then 'PASS' else 'FAIL' end),
    ('bp_control denominator = every eligible member, measured or not',
     v_bp ->> 'denominator', '12', case when v_bp ->> 'denominator' = '12' then 'PASS' else 'FAIL' end),
    ('bp_control measurable = only those with an in-period reading',
     v_bp ->> 'measurable', '10', case when v_bp ->> 'measurable' = '10' then 'PASS' else 'FAIL' end),
    ('bp_control numerator = those actually at target',
     v_bp ->> 'numerator', '7', case when v_bp ->> 'numerator' = '7' then 'PASS' else 'FAIL' end),
    ('unmeasured members are counted as not measurable, never as failures',
     v_bp ->> 'unmeasurable', '2', case when v_bp ->> 'unmeasurable' = '2' then 'PASS' else 'FAIL' end),
    ('a reading from BEFORE the period does not count as in-period data',
     v_bp ->> 'measurable', '10', case when v_bp ->> 'measurable' = '10' then 'PASS' else 'FAIL' end),
    ('rate is numerator over MEASURABLE, not over denominator',
     v_bp ->> 'rate_pct', '70.0', case when v_bp ->> 'rate_pct' = '70.0' then 'PASS' else 'FAIL' end),
    ('data completeness is published beside the rate',
     v_bp ->> 'data_completeness_pct', '83.3',
     case when v_bp ->> 'data_completeness_pct' = '83.3' then 'PASS' else 'FAIL' end),
    ('a measure with no eligible members publishes NO rate',
     coalesce(v_gly ->> 'rate_pct', 'null'), 'null',
     case when v_gly ->> 'rate_pct' is null then 'PASS' else 'FAIL' end),
    ('...and no count either, not a zero',
     coalesce(v_gly ->> 'denominator', 'null'), 'null',
     case when v_gly ->> 'denominator' is null then 'PASS' else 'FAIL' end),
    ('...and says why it is withheld',
     case when length(coalesce(v_gly ->> 'not_reportable_reason', '')) > 10 then 'stated' else 'missing' end,
     'stated',
     case when length(coalesce(v_gly ->> 'not_reportable_reason', '')) > 10 then 'PASS' else 'FAIL' end),
    ('the report quotes the measure definition it used',
     case when length(coalesce(v_bp -> 'definitions' ->> 'denominator', '')) > 50 then 'quoted' else 'missing' end,
     'quoted',
     case when length(coalesce(v_bp -> 'definitions' ->> 'denominator', '')) > 50 then 'PASS' else 'FAIL' end),
    ('the report records which spec version produced the number',
     v_bp ->> 'spec_version', '1', case when v_bp ->> 'spec_version' = '1' then 'PASS' else 'FAIL' end),
    ('limitations are stated, including the no-counterfactual line',
     case when v_snap ->> 'limitations' like '%no counterfactual%' then 'stated' else 'missing' end,
     'stated',
     case when v_snap ->> 'limitations' like '%no counterfactual%' then 'PASS' else 'FAIL' end),
    ('no ROI or cost-saving is asserted',
     case when v_snap ->> 'limitations' like '%No cost saving%' then 'stated' else 'missing' end,
     'stated',
     case when v_snap ->> 'limitations' like '%No cost saving%' then 'PASS' else 'FAIL' end),
    ('the stored hash matches the stored figures',
     case when v_hash = private.board_report_hash('TAR-PBORA-2026-0001', date '2026-01-01', date '2026-03-31', v_snap)
          then 'matches' else 'mismatch' end, 'matches',
     case when v_hash = private.board_report_hash('TAR-PBORA-2026-0001', date '2026-01-01', date '2026-03-31', v_snap)
          then 'PASS' else 'FAIL' end),
    ('a fresh report starts as an unattested draft',
     (select status::text from public.payer_board_reports where id = v_report), 'draft',
     case when (select status from public.payer_board_reports where id = v_report) = 'draft'
          then 'PASS' else 'FAIL' end);
exception when others then
  perform set_config('role', 'postgres', true);
  insert into pbor_result values ('generation as analyst seat', sqlerrm, 'no error', 'FAIL');
end $$;

-- ---------------------------------------------------------------------------
-- 2. Sabotage controls: who may NOT do what.
-- ---------------------------------------------------------------------------
do $$
declare
  v_n integer;
  v_blocked boolean;
begin
  -- 2a. Insurer B's analyst must not see insurer A's report.
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from pbor_fix where k = 'payer_b'), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from public.payer_board_reports
   where id = (select v from pbor_fix where k = 'report_1');
  perform set_config('role', 'postgres', true);
  insert into pbor_result values
    ('another insurer cannot read this insurer''s report', v_n::text, '0',
     case when v_n = 0 then 'PASS' else 'FAIL' end);

  -- 2b. CONTROL for 2a: insurer A's own analyst CAN see it. Without this,
  --     2a would pass just as well if RLS hid the row from everybody.
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from pbor_fix where k = 'payer_a'), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_n from public.payer_board_reports
   where id = (select v from pbor_fix where k = 'report_1');
  perform set_config('role', 'postgres', true);
  insert into pbor_result values
    ('CONTROL: the insurer it was issued to CAN read it', v_n::text, '1',
     case when v_n = 1 then 'PASS' else 'FAIL' end);

  -- 2c. A payer may not attest its own supplier's figures.
  v_blocked := false;
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from pbor_fix where k = 'payer_a'), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.attest_payer_board_report(
      (select v from pbor_fix where k = 'report_1'),
      'We confirm these figures are a fair reflection of the period.', 'Head of Analytics');
  exception when others then v_blocked := true;
  end;
  perform set_config('role', 'postgres', true);
  insert into pbor_result values
    ('a payer cannot attest its own supplier''s figures', v_blocked::text, 'true',
     case when v_blocked then 'PASS' else 'FAIL' end);

  -- 2d. A period that has not finished cannot be reported on.
  v_blocked := false;
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from pbor_fix where k = 'payer_a'), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.generate_payer_board_report(
      (select v from pbor_fix where k = 'insurer_a'), current_date - 10, current_date + 30);
  exception when others then v_blocked := true;
  end;
  perform set_config('role', 'postgres', true);
  insert into pbor_result values
    ('an unfinished period cannot be reported on', v_blocked::text, 'true',
     case when v_blocked then 'PASS' else 'FAIL' end);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Attestation by Tarragon, and what it locks.
-- ---------------------------------------------------------------------------
do $$
declare
  v_res     jsonb;
  v_report  uuid := (select v from pbor_fix where k = 'report_1');
  v_blocked boolean;
  v_status  text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from pbor_fix where k = 'admin'), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  v_res := public.attest_payer_board_report(v_report,
    'I confirm these figures were produced from the platform record for the stated period using the stated measure definitions, and that the limitations section fairly describes what they do not show.',
    'Clinical Director');
  perform set_config('role', 'postgres', true);

  select status::text into v_status from public.payer_board_reports where id = v_report;
  insert into pbor_result values
    ('a Tarragon signatory can attest', v_status, 'attested',
     case when v_status = 'attested' then 'PASS' else 'FAIL' end);

  -- An attestation is a signature: not editable, not transferable.
  v_blocked := false;
  begin
    update public.payer_board_reports
       set attestation_statement = 'Actually we said something else.' where id = v_report;
  exception when insufficient_privilege then v_blocked := true;
  end;
  insert into pbor_result values
    ('an attestation cannot be altered afterwards', v_blocked::text, 'true',
     case when v_blocked then 'PASS' else 'FAIL' end);

  -- Double attestation is refused.
  v_blocked := false;
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from pbor_fix where k = 'admin'), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.attest_payer_board_report(v_report,
      'Attesting a second time to a report that is already signed.', 'Clinical Director');
  exception when others then v_blocked := true;
  end;
  perform set_config('role', 'postgres', true);
  insert into pbor_result values
    ('an already-attested report cannot be re-attested', v_blocked::text, 'true',
     case when v_blocked then 'PASS' else 'FAIL' end);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Independent verification, and supersession.
-- ---------------------------------------------------------------------------
do $$
declare
  v_number text;
  v_hash   text;
  v_out    jsonb;
  v_res    jsonb;
  v_old    text;
begin
  select report_number, content_hash into v_number, v_hash
    from public.payer_board_reports where id = (select v from pbor_fix where k = 'report_1');

  -- The board member holding a printout has no account at all.
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
  v_out := public.verify_payer_board_report(v_number, v_hash);
  perform set_config('role', 'postgres', true);

  insert into pbor_result values
    ('a board member with no account can verify a genuine report',
     v_out ->> 'verified', 'true', case when v_out ->> 'verified' = 'true' then 'PASS' else 'FAIL' end),
    ('verification names the signatory',
     v_out ->> 'attester_role_title', 'Clinical Director',
     case when v_out ->> 'attester_role_title' = 'Clinical Director' then 'PASS' else 'FAIL' end),
    ('verification discloses NO figure from the report',
     case when (v_out::text ilike '%measures%' or v_out::text ilike '%cohort%'
                or v_out ? 'snapshot') then 'leaked' else 'clean' end, 'clean',
     case when (v_out::text ilike '%measures%' or v_out::text ilike '%cohort%'
                or v_out ? 'snapshot') then 'FAIL' else 'PASS' end);

  -- Altering one character of the hash must break verification.
  perform set_config('role', 'anon', true);
  v_out := public.verify_payer_board_report(v_number,
    overlay(v_hash placing case when substr(v_hash, 1, 1) = 'a' then 'b' else 'a' end from 1 for 1));
  perform set_config('role', 'postgres', true);
  insert into pbor_result values
    ('a single altered character breaks verification',
     v_out ->> 'verified', 'false', case when v_out ->> 'verified' = 'false' then 'PASS' else 'FAIL' end);

  -- Regenerating the same period supersedes rather than overwrites.
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from pbor_fix where k = 'payer_a'), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  v_res := public.generate_payer_board_report(
    (select v from pbor_fix where k = 'insurer_a'), date '2026-01-01', date '2026-03-31');
  perform set_config('role', 'postgres', true);

  select status::text into v_old from public.payer_board_reports
   where id = (select v from pbor_fix where k = 'report_1');
  insert into pbor_result values
    ('regenerating a period supersedes the earlier report', v_old, 'superseded',
     case when v_old = 'superseded' then 'PASS' else 'FAIL' end),
    ('the superseded report keeps its own number', v_number, 'TAR-PBORA-2026-0001',
     case when v_number = 'TAR-PBORA-2026-0001' then 'PASS' else 'FAIL' end),
    ('the replacement gets the next number', v_res ->> 'report_number', 'TAR-PBORA-2026-0002',
     case when v_res ->> 'report_number' = 'TAR-PBORA-2026-0002' then 'PASS' else 'FAIL' end);

  -- A superseded copy in somebody's hands must still verify, and must say so.
  perform set_config('role', 'anon', true);
  v_out := public.verify_payer_board_report(v_number, v_hash);
  perform set_config('role', 'postgres', true);
  insert into pbor_result values
    ('a superseded copy still verifies as genuine',
     v_out ->> 'verified', 'true', case when v_out ->> 'verified' = 'true' then 'PASS' else 'FAIL' end),
    ('...and tells the holder it is no longer current',
     (v_out ->> 'superseded'), 'true',
     case when v_out ->> 'superseded' = 'true' then 'PASS' else 'FAIL' end);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Withdrawal, and the refusal to issue a report with nothing in it.
-- ---------------------------------------------------------------------------
do $$
declare
  v_report  uuid;
  v_number  text;
  v_hash    text;
  v_out     jsonb;
  v_blocked boolean;
  v_status  text;
begin
  select id, report_number, content_hash into v_report, v_number, v_hash
    from public.payer_board_reports
   where insurer_id = (select v from pbor_fix where k = 'insurer_a')
     and status = 'attested'
   order by sequence_no desc limit 1;

  -- Nothing is attested at this point (report 1 was superseded, report 2 is a
  -- draft), so withdraw the draft instead — withdrawal applies in any state.
  if v_report is null then
    select id, report_number, content_hash into v_report, v_number, v_hash
      from public.payer_board_reports
     where insurer_id = (select v from pbor_fix where k = 'insurer_a')
     order by sequence_no desc limit 1;
  end if;

  -- A payer cannot withdraw a report about itself.
  v_blocked := false;
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from pbor_fix where k = 'payer_a'), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.withdraw_payer_board_report(v_report, 'We would rather these numbers were not seen.');
  exception when others then v_blocked := true;
  end;
  perform set_config('role', 'postgres', true);
  insert into pbor_result values
    ('a payer cannot withdraw a report issued about it', v_blocked::text, 'true',
     case when v_blocked then 'PASS' else 'FAIL' end);

  -- Tarragon can, with a reason, and the reason reaches whoever verifies a copy.
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select v from pbor_fix where k = 'admin'), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.withdraw_payer_board_report(v_report,
    'Issued against an incomplete claims feed; a corrected report follows.');
  perform set_config('role', 'postgres', true);

  select status::text into v_status from public.payer_board_reports where id = v_report;
  insert into pbor_result values
    ('Tarragon can withdraw an issued report', v_status, 'withdrawn',
     case when v_status = 'withdrawn' then 'PASS' else 'FAIL' end);

  perform set_config('role', 'anon', true);
  v_out := public.verify_payer_board_report(v_number, v_hash);
  perform set_config('role', 'postgres', true);
  insert into pbor_result values
    ('a withdrawn copy still verifies as genuine', v_out ->> 'verified', 'true',
     case when v_out ->> 'verified' = 'true' then 'PASS' else 'FAIL' end),
    ('...and warns the holder not to rely on it',
     case when v_out ->> 'note' ilike '%must not be relied on%' then 'warned' else 'silent' end, 'warned',
     case when v_out ->> 'note' ilike '%must not be relied on%' then 'PASS' else 'FAIL' end),
    ('...and gives the reason it was withdrawn',
     case when v_out ->> 'withdrawal_reason' ilike '%incomplete claims feed%' then 'given' else 'missing' end,
     'given',
     case when v_out ->> 'withdrawal_reason' ilike '%incomplete claims feed%' then 'PASS' else 'FAIL' end);

  -- A withdrawn report is terminal.
  v_blocked := false;
  begin
    update public.payer_board_reports set status = 'draft' where id = v_report;
  exception when insufficient_privilege then v_blocked := true;
  end;
  insert into pbor_result values
    ('a withdrawn report cannot be reinstated', v_blocked::text, 'true',
     case when v_blocked then 'PASS' else 'FAIL' end);
end $$;

-- With every measure retired there is nothing to report, and a beautifully
-- formatted document asserting nothing is the worst possible output. Prove it
-- refuses instead. Retirement happens in a subtransaction that is rolled back,
-- so the rest of the file is unaffected.
do $$
declare v_blocked boolean := false;
begin
  begin
    update public.outcome_measure_specs set retired_at = now() where retired_at is null;

    perform set_config('request.jwt.claims',
      json_build_object('sub', (select v from pbor_fix where k = 'payer_a'), 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    begin
      perform public.generate_payer_board_report(
        (select v from pbor_fix where k = 'insurer_a'), date '2026-04-01', date '2026-06-30');
    exception when others then v_blocked := true;
    end;
    perform set_config('role', 'postgres', true);

    raise exception 'ROLLBACK_RETIREMENT';
  exception when others then
    perform set_config('role', 'postgres', true);
    if sqlerrm <> 'ROLLBACK_RETIREMENT' then raise; end if;
  end;

  insert into pbor_result values
    ('a report with no measures in force is refused, not issued', v_blocked::text, 'true',
     case when v_blocked then 'PASS' else 'FAIL' end);
end $$;

select * from pbor_result order by check_name;

do $$
declare v_failed integer;
begin
  select count(*) into v_failed from pbor_result where verdict <> 'PASS';
  if v_failed > 0 then
    raise exception '% board-report check(s) FAILED — see the table above', v_failed;
  end if;
  raise notice 'PASS: all board outcomes report checks passed';
end $$;

rollback;
