-- ===========================================================================
-- Verification: medication_reconciliations (20260829190605) — medication
-- safety pathway 64.3. The active list is snapshotted on open; a clinician
-- cannot reconcile before the patient confirms; a clinical-tier doctor can
-- reconcile after confirmation and gets stamped server-side; a Care
-- Coordinator (non-clinical-tier) cannot reconcile even after confirmation.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
-- Wrapped in BEGIN/ROLLBACK.
-- ===========================================================================

begin;

create temporary table mrec_fixture(k text primary key, v uuid) on commit drop;
create temporary table mrec_result(
  check_name text, role text, observed text, expected text, verdict text
) on commit drop;

do $$
declare
  v_org uuid;
  v_patient uuid;
  v_doctor uuid := gen_random_uuid();
  v_coordinator uuid := gen_random_uuid();
begin
  select organisation_id into v_org
  from public.profiles
  where role = 'patient' and organisation_id is not null
  group by organisation_id order by count(*) desc limit 1;
  if v_org is null then
    raise exception 'no organisation has patient profiles — cannot run this test';
  end if;
  select id into v_patient from public.profiles where role = 'patient' and organisation_id = v_org limit 1;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_doctor, 'mrec-test-doctor@example.invalid', 'x', now(), '{}', '{}'),
    (v_coordinator, 'mrec-test-coordinator@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_doctor, v_org, 'clinician', 'MREC Test Doctor'),
    (v_coordinator, v_org, 'care_coordinator', 'MREC Test Coordinator')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, doctor_tier, license_verified_at, verified_by)
  values (v_org, v_doctor, 'MREC Test Doctor', true, 'tier_2', now(), v_patient);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, verified_by)
  values (v_org, v_coordinator, 'MREC Test Coordinator', true, now(), v_patient);

  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, is_active, source)
  values (v_org, v_patient, 'MREC Test Lisinopril', '10mg', 'once daily', true, 'clinician');

  insert into mrec_fixture(k, v) values
    ('org', v_org), ('patient', v_patient), ('doctor', v_doctor), ('coordinator', v_coordinator);
end $$;

-- ==========================================================================
-- 1. Opening a reconciliation episode snapshots the active medication list.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from mrec_fixture where k = 'org');
  v_patient uuid := (select v from mrec_fixture where k = 'patient');
  v_id uuid;
  v_snapshot_count integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.medication_reconciliations (organisation_id, patient_id)
  values (v_org, v_patient)
  returning id into v_id;
  reset role;

  select jsonb_array_length(medications_snapshot) into v_snapshot_count
  from public.medication_reconciliations where id = v_id;

  insert into mrec_result values
    ('opening a reconciliation snapshots the active medication list', 'patient',
     v_snapshot_count::text, '1', case when v_snapshot_count = 1 then 'PASS' else 'FAIL' end);
  if v_snapshot_count <> 1 then
    raise exception 'BROKEN: medications_snapshot did not capture the active medication list';
  end if;

  insert into mrec_fixture(k, v) values ('episode', v_id);
end $$;

-- ==========================================================================
-- 2. A clinician cannot reconcile before the patient confirms.
-- ==========================================================================
do $$
declare
  v_doctor uuid := (select v from mrec_fixture where k = 'doctor');
  v_id uuid := (select v from mrec_fixture where k = 'episode');
  v_caught boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_doctor::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.medication_reconciliations
      set reconciled_at = now(), reconciliation_note = 'Confirmed accurate'
      where id = v_id;
  exception when others then
    v_caught := true;
  end;
  reset role;

  insert into mrec_result values
    ('reconciling before patient confirmation is rejected', 'clinician',
     case when v_caught then 'rejected' else 'accepted' end, 'rejected',
     case when v_caught then 'PASS' else 'FAIL' end);
  if not v_caught then
    raise exception 'BROKEN: a clinician reconciled a medication list before the patient confirmed it';
  end if;
end $$;

-- ==========================================================================
-- 3. Patient confirms, then a Care Coordinator (non-clinical-tier) still
--    cannot reconcile.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from mrec_fixture where k = 'patient');
  v_coordinator uuid := (select v from mrec_fixture where k = 'coordinator');
  v_id uuid := (select v from mrec_fixture where k = 'episode');
  v_caught boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.medication_reconciliations
    set patient_confirmed_at = now(), patient_note = 'This list looks right'
    where id = v_id;
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_coordinator::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.medication_reconciliations
      set reconciled_at = now(), reconciliation_note = 'Reconciled by coordinator'
      where id = v_id;
  exception when others then
    v_caught := true;
  end;
  reset role;

  insert into mrec_result values
    ('a Care Coordinator cannot reconcile even after patient confirmation', 'care_coordinator',
     case when v_caught then 'rejected' else 'accepted' end, 'rejected',
     case when v_caught then 'PASS' else 'FAIL' end);
  if not v_caught then
    raise exception 'BROKEN: a Care Coordinator reconciled a medication list';
  end if;
end $$;

-- ==========================================================================
-- 4. A clinical-tier doctor reconciles after confirmation and gets stamped.
-- ==========================================================================
do $$
declare
  v_doctor uuid := (select v from mrec_fixture where k = 'doctor');
  v_id uuid := (select v from mrec_fixture where k = 'episode');
  v_reconciled_by uuid;
  v_reconciled_at timestamptz;
  v_patient_confirmed_at timestamptz;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_doctor::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.medication_reconciliations
    set reconciled_at = now(), reconciliation_note = 'List matches; no changes needed'
    where id = v_id;
  reset role;

  select reconciled_by, reconciled_at, patient_confirmed_at
    into v_reconciled_by, v_reconciled_at, v_patient_confirmed_at
  from public.medication_reconciliations where id = v_id;

  insert into mrec_result values
    ('a clinical-tier doctor reconciles after confirmation and is stamped server-side', 'clinician',
     format('reconciled_by=%s/reconciled_at=%s/confirmed_at=%s',
       case when v_reconciled_by is not null then 'set' else 'null' end,
       case when v_reconciled_at is not null then 'set' else 'null' end,
       case when v_patient_confirmed_at is not null then 'set' else 'null' end),
     'reconciled_by=set/reconciled_at=set/confirmed_at=set',
     case when v_reconciled_by is not null and v_reconciled_at is not null and v_patient_confirmed_at is not null
          then 'PASS' else 'FAIL' end);
  if v_reconciled_by is null or v_reconciled_at is null or v_patient_confirmed_at is null then
    raise exception 'BROKEN: a valid clinician reconciliation did not persist all three stamps';
  end if;
end $$;

select check_name, role, observed, expected, verdict
from mrec_result
order by verdict desc, check_name, role;

rollback;
