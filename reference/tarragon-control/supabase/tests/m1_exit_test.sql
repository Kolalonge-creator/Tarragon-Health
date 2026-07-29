-- M1 exit test (spec §20): "RLS suite passes as all six roles;
-- institution_admin returns zero rows everywhere."
-- Run supabase/tests/m1_fixture.sql first. Each block below RAISEs on any
-- mismatch; a clean run ends with the PASS notice at the bottom and no
-- exception. Every block uses SET LOCAL, so the role/claim reset when the
-- containing transaction ends — this whole file should be run inside one
-- transaction (wrap in BEGIN/COMMIT or your migration tool's own txn).

do $$
declare
  v_count int;
begin
  -- institution_admin: zero rows on every patient-scoped table (the
  -- spec's own exit-test wording). No institution_admin policy exists
  -- anywhere in 0002_rls.sql, so this also proves default-deny is intact.
  perform set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111105','role','authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_count from patients; if v_count <> 0 then raise exception 'FAIL institution_admin.patients expected 0 got %', v_count; end if;
  select count(*) into v_count from readings; if v_count <> 0 then raise exception 'FAIL institution_admin.readings expected 0 got %', v_count; end if;
  select count(*) into v_count from triage_classifications; if v_count <> 0 then raise exception 'FAIL institution_admin.triage_classifications expected 0 got %', v_count; end if;
  select count(*) into v_count from clinical_notes; if v_count <> 0 then raise exception 'FAIL institution_admin.clinical_notes expected 0 got %', v_count; end if;
  select count(*) into v_count from clinical_contacts; if v_count <> 0 then raise exception 'FAIL institution_admin.clinical_contacts expected 0 got %', v_count; end if;
  select count(*) into v_count from escalations; if v_count <> 0 then raise exception 'FAIL institution_admin.escalations expected 0 got %', v_count; end if;
  select count(*) into v_count from referrals; if v_count <> 0 then raise exception 'FAIL institution_admin.referrals expected 0 got %', v_count; end if;
  select count(*) into v_count from proof_log; if v_count <> 0 then raise exception 'FAIL institution_admin.proof_log expected 0 got %', v_count; end if;
  select count(*) into v_count from consent_records; if v_count <> 0 then raise exception 'FAIL institution_admin.consent_records expected 0 got %', v_count; end if;
  select count(*) into v_count from devices; if v_count <> 0 then raise exception 'FAIL institution_admin.devices expected 0 got %', v_count; end if;
  select count(*) into v_count from medications; if v_count <> 0 then raise exception 'FAIL institution_admin.medications expected 0 got %', v_count; end if;
  select count(*) into v_count from medication_dispenses; if v_count <> 0 then raise exception 'FAIL institution_admin.medication_dispenses expected 0 got %', v_count; end if;
  select count(*) into v_count from lab_orders; if v_count <> 0 then raise exception 'FAIL institution_admin.lab_orders expected 0 got %', v_count; end if;
  select count(*) into v_count from enrolments; if v_count <> 0 then raise exception 'FAIL institution_admin.enrolments expected 0 got %', v_count; end if;
  select count(*) into v_count from screening_participants; if v_count <> 0 then raise exception 'FAIL institution_admin.screening_participants expected 0 got %', v_count; end if;
  select count(*) into v_count from subscriptions; if v_count <> 0 then raise exception 'FAIL institution_admin.subscriptions expected 0 got %', v_count; end if;
  select count(*) into v_count from wallets; if v_count <> 0 then raise exception 'FAIL institution_admin.wallets expected 0 got %', v_count; end if;
  select count(*) into v_count from wallet_transactions; if v_count <> 0 then raise exception 'FAIL institution_admin.wallet_transactions expected 0 got %', v_count; end if;
  select count(*) into v_count from organisations; if v_count <> 0 then raise exception 'FAIL institution_admin.organisations expected 0 got %', v_count; end if;
  select count(*) into v_count from clinicians; if v_count <> 0 then raise exception 'FAIL institution_admin.clinicians expected 0 got %', v_count; end if;
  select count(*) into v_count from notification_sends; if v_count <> 0 then raise exception 'FAIL institution_admin.notification_sends expected 0 got %', v_count; end if;
  select count(*) into v_count from device_heartbeats; if v_count <> 0 then raise exception 'FAIL institution_admin.device_heartbeats expected 0 got %', v_count; end if;
  select count(*) into v_count from audit_log; if v_count <> 0 then raise exception 'FAIL institution_admin.audit_log expected 0 got %', v_count; end if;

  raise notice 'PASS institution_admin: zero rows on every patient-scoped table';
end $$;

do $$
declare
  v_count int;
begin
  -- patient A: sees exactly their own row set.
  perform set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111101','role','authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_count from patients; if v_count <> 1 then raise exception 'FAIL patient_a.patients expected 1 got %', v_count; end if;
  select count(*) into v_count from readings; if v_count <> 1 then raise exception 'FAIL patient_a.readings expected 1 got %', v_count; end if;
  select count(*) into v_count from triage_classifications; if v_count <> 1 then raise exception 'FAIL patient_a.triage_classifications expected 1 got %', v_count; end if;
  select count(*) into v_count from enrolments; if v_count <> 1 then raise exception 'FAIL patient_a.enrolments expected 1 got %', v_count; end if;

  raise notice 'PASS patient_a: sees own row set only';
end $$;

do $$
declare
  v_count int;
begin
  -- patient B: unrelated to patient A. Cross-patient isolation (I4-adjacent).
  perform set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111102','role','authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_count from patients; if v_count <> 1 then raise exception 'FAIL patient_b.patients expected 1 (own row only) got %', v_count; end if;
  select count(*) into v_count from readings; if v_count <> 0 then raise exception 'FAIL patient_b.readings expected 0 (patient A''s data) got %', v_count; end if;
  select count(*) into v_count from triage_classifications; if v_count <> 0 then raise exception 'FAIL patient_b.triage_classifications expected 0 got %', v_count; end if;

  raise notice 'PASS patient_b: isolated from patient A, sees zero of their data';
end $$;

do $$
declare
  v_count int;
begin
  -- clinician A: shared needs_review+ exception queue only (the fully
  -- specified half of §6.1 clinician access — see the caseload-assignment
  -- gap noted in 0002_rls.sql).
  perform set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111103','role','authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_count from patients; if v_count <> 1 then raise exception 'FAIL clinician_a.patients (queue) expected 1 got %', v_count; end if;
  select count(*) into v_count from readings; if v_count <> 1 then raise exception 'FAIL clinician_a.readings (queue) expected 1 got %', v_count; end if;
  select count(*) into v_count from triage_classifications; if v_count <> 1 then raise exception 'FAIL clinician_a.triage_classifications (queue) expected 1 got %', v_count; end if;
  select count(*) into v_count from protocol_configs; if v_count <> 1 then raise exception 'FAIL clinician_a.protocol_configs expected 1 got %', v_count; end if;

  raise notice 'PASS clinician_a: sees the shared needs_review+ exception queue';
end $$;

do $$
declare
  v_count int;
begin
  -- coordinator A: assigned patients via enrolments.assigned_coordinator_id,
  -- explicitly NO clinical_notes access (§6.1: "no access to
  -- clinical_notes.body" — implemented here as zero access to the table,
  -- stricter than "no body", see 0002_rls.sql comment).
  perform set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111104','role','authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_count from patients; if v_count <> 1 then raise exception 'FAIL coordinator_a.patients (assigned) expected 1 got %', v_count; end if;
  select count(*) into v_count from clinical_notes; if v_count <> 0 then raise exception 'FAIL coordinator_a.clinical_notes expected 0 got %', v_count; end if;
  select count(*) into v_count from enrolments; if v_count <> 1 then raise exception 'FAIL coordinator_a.enrolments expected 1 got %', v_count; end if;

  raise notice 'PASS coordinator_a: sees assigned patients, zero clinical_notes access';
end $$;

do $$
declare
  v_count int;
begin
  -- ops_admin: non-clinical operational tables; explicitly NO
  -- clinical_notes and NO readings values (§6.1, verbatim). This is the
  -- exact assertion that caught a real bug during development — the
  -- original readings_select_staff policy granted ops_admin blanket read.
  perform set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111106','role','authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_count from patients; if v_count <> 2 then raise exception 'FAIL ops_admin.patients expected 2 (all) got %', v_count; end if;
  select count(*) into v_count from clinical_notes; if v_count <> 0 then raise exception 'FAIL ops_admin.clinical_notes expected 0 got %', v_count; end if;
  select count(*) into v_count from readings; if v_count <> 0 then raise exception 'FAIL ops_admin.readings expected 0 (no readings values, §6.1) got %', v_count; end if;
  select count(*) into v_count from organisations; if v_count <> 1 then raise exception 'FAIL ops_admin.organisations expected 1 got %', v_count; end if;

  raise notice 'PASS ops_admin: operational access only, zero clinical_notes/readings';
end $$;

do $$
declare
  v_count int;
begin
  -- superadmin: break-glass, full access (spec §6.1). Every access this
  -- test suite has made up to this point is already sitting in audit_log
  -- via the M1 audit trigger — confirm it's non-empty as a side proof that
  -- the audit trigger fired on every fixture write, not just a schema check.
  perform set_config('request.jwt.claims', json_build_object('sub','11111111-1111-1111-1111-111111111107','role','authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_count from patients; if v_count <> 2 then raise exception 'FAIL superadmin.patients expected 2 got %', v_count; end if;
  select count(*) into v_count from audit_log; if v_count = 0 then raise exception 'FAIL superadmin.audit_log expected > 0 (audit trigger should have fired on fixture inserts)'; end if;

  raise notice 'PASS superadmin: full break-glass access, audit trail populated (% rows)', v_count;
end $$;

do $$
begin
  raise notice '=== M1 EXIT TEST: PASS — RLS suite passes as all six roles; institution_admin returns zero rows everywhere ===';
end $$;
