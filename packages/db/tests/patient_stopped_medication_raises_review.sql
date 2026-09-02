-- ===========================================================================
-- Verification: medications_raise_review_on_patient_stop (20260829142337) —
-- medication safety pathway 64.4. A patient self-stopping their own
-- clinician/specialist-prescribed medication must raise a clinician_review
-- clinician_alerts row (medication_safety), never silently. Two negative
-- controls prove the trigger actually discriminates rather than firing on
-- everything: a patient's own self-added medication, and an org-staff-driven
-- stop, must NOT raise this alert.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
-- Wrapped in BEGIN/ROLLBACK.
-- ===========================================================================

begin;

create temporary table psmr_fixture(k text primary key, v uuid) on commit drop;
create temporary table psmr_result(
  check_name text, role text, observed text, expected text, verdict text
) on commit drop;

do $$
declare
  v_org uuid;
  v_patient_a uuid;
  v_patient_b uuid := gen_random_uuid();
  v_patient_c uuid := gen_random_uuid();
  v_staff_c   uuid := gen_random_uuid();
  v_med_a uuid;
  v_med_b uuid;
  v_med_c uuid;
begin
  select organisation_id into v_org
  from public.profiles
  where role = 'patient' and organisation_id is not null
  group by organisation_id order by count(*) desc limit 1;
  if v_org is null then
    raise exception 'no organisation has patient profiles — cannot run this test';
  end if;

  select id into v_patient_a from public.profiles where role = 'patient' and organisation_id = v_org limit 1;

  -- Distinct patients for the two negative-control cases so the 24h
  -- type_code:patient_id dedup window on clinician_alerts can never make a
  -- suppressed/duplicate row from case 1 look like a false positive here.
  -- profiles.id FKs to auth.users, so each new profile needs a matching row there.
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_patient_b, 'psmr-test-patient-b@example.invalid', 'x', now(), '{}', '{}'),
    (v_patient_c, 'psmr-test-patient-c@example.invalid', 'x', now(), '{}', '{}'),
    (v_staff_c, 'psmr-test-staff-c@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_patient_b, v_org, 'patient', 'PSMR Test Patient B'),
    (v_patient_c, v_org, 'patient', 'PSMR Test Patient C'),
    (v_staff_c, v_org, 'clinician', 'PSMR Test Staff')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  -- Tier 2 (not just an org-staff profile) so private.has_prescribing_authority
  -- lets this staff member actually flip is_active — otherwise
  -- enforce_medication_confirm_only would reject the update outright and
  -- case 3 below would test nothing.
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, doctor_tier)
  values (v_org, v_staff_c, 'PSMR Test Staff', true, 'tier_2');

  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, is_active, source)
  values (v_org, v_patient_a, 'PSMR Test Lisinopril', '10mg', 'once daily', true, 'clinician')
  returning id into v_med_a;

  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, is_active, source)
  values (v_org, v_patient_b, 'PSMR Test Vitamin C', '1000mg', 'once daily', true, 'patient')
  returning id into v_med_b;

  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, is_active, source)
  values (v_org, v_patient_c, 'PSMR Test Metformin', '500mg', 'twice daily', true, 'clinician')
  returning id into v_med_c;

  insert into psmr_fixture(k, v) values
    ('org', v_org),
    ('patient_a', v_patient_a), ('med_a', v_med_a),
    ('patient_b', v_patient_b), ('med_b', v_med_b),
    ('patient_c', v_patient_c), ('med_c', v_med_c), ('staff_c', v_staff_c);
end $$;

-- ==========================================================================
-- 1. Patient stops their OWN clinician-prescribed medication -> a
--    clinician_review / medication_safety alert is raised.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from psmr_fixture where k = 'patient_a');
  v_med uuid := (select v from psmr_fixture where k = 'med_a');
  v_alert_count bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.medications
    set is_active = false, stopped_reason = 'Felt fine, so I stopped'
    where id = v_med;
  reset role;

  select count(*) into v_alert_count
  from public.clinician_alerts
  where patient_id = v_patient and type_code = 'medication_safety' and category = 'clinical'
    and level = 'clinician_review' and detail like '%PSMR Test Lisinopril%';

  insert into psmr_result values
    ('patient stopping a clinician-prescribed medication raises a review alert', 'patient',
     v_alert_count::text, '1', case when v_alert_count = 1 then 'PASS' else 'FAIL' end);
  if v_alert_count <> 1 then
    raise exception 'BROKEN: patient stopping their own clinician-prescribed medication did not raise a medication_safety clinician_alerts row';
  end if;
end $$;

-- ==========================================================================
-- 2. Negative control: patient stops their OWN self-added medication -> no
--    review alert (nothing to review; the patient owns this record fully).
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from psmr_fixture where k = 'patient_b');
  v_med uuid := (select v from psmr_fixture where k = 'med_b');
  v_alert_count bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.medications set is_active = false, stopped_reason = 'Finished the bottle' where id = v_med;
  reset role;

  select count(*) into v_alert_count
  from public.clinician_alerts
  where patient_id = v_patient and type_code = 'medication_safety';

  insert into psmr_result values
    ('patient stopping their own self-added medication raises no alert', 'patient',
     v_alert_count::text, '0', case when v_alert_count = 0 then 'PASS' else 'FAIL' end);
  if v_alert_count <> 0 then
    raise exception 'BROKEN: stopping a self-added medication incorrectly raised a medication_safety clinician_alerts row';
  end if;
end $$;

-- ==========================================================================
-- 3. Negative control: ORG STAFF stops a clinician-prescribed medication on
--    the patient's behalf -> no alert (already a reviewed clinical decision).
-- ==========================================================================
do $$
declare
  v_staff uuid := (select v from psmr_fixture where k = 'staff_c');
  v_patient uuid := (select v from psmr_fixture where k = 'patient_c');
  v_med uuid := (select v from psmr_fixture where k = 'med_c');
  v_alert_count bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_staff::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.medications set is_active = false, stopped_reason = 'Switched to losartan' where id = v_med;
  reset role;

  select count(*) into v_alert_count
  from public.clinician_alerts
  where patient_id = v_patient and type_code = 'medication_safety';

  insert into psmr_result values
    ('org staff stopping a prescribed medication raises no alert', 'clinician',
     v_alert_count::text, '0', case when v_alert_count = 0 then 'PASS' else 'FAIL' end);
  if v_alert_count <> 0 then
    raise exception 'BROKEN: a staff-driven stop incorrectly raised a medication_safety clinician_alerts row';
  end if;
end $$;

select check_name, role, observed, expected, verdict
from psmr_result
order by verdict desc, check_name, role;

rollback;
