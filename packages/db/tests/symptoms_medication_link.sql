-- ===========================================================================
-- Verification: symptoms.medication_id (20260829154944) — medication safety
-- pathway 64.9/64.10. A side-effect report against a specific medication
-- persists the association, and the existing severity-based red-flag
-- computation (private.handle_symptom_red_flag) is completely unaffected by
-- the presence or absence of medication_id.
--
-- Deliberately does not assert on clinician_alerts existing for a red-flag
-- row: the trigger's actual alert-vs-AI-suggestion branch depends on
-- private.patient_has_feature_access (plan-gated per
-- 20260810022401_gate_vitals_red_flag_escalation_to_paid_plans.sql), which
-- is outside what this migration touches or should assume about the test
-- patient's plan. is_red_flag itself is the stable, plan-independent
-- signal this migration must not have broken.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
-- Wrapped in BEGIN/ROLLBACK.
-- ===========================================================================

begin;

create temporary table sml_fixture(k text primary key, v uuid) on commit drop;
create temporary table sml_result(
  check_name text, role text, observed text, expected text, verdict text
) on commit drop;

do $$
declare
  v_org uuid;
  v_patient uuid;
  v_med uuid;
begin
  select organisation_id into v_org
  from public.profiles
  where role = 'patient' and organisation_id is not null
  group by organisation_id order by count(*) desc limit 1;
  if v_org is null then
    raise exception 'no organisation has patient profiles — cannot run this test';
  end if;
  select id into v_patient from public.profiles where role = 'patient' and organisation_id = v_org limit 1;

  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, is_active, source)
  values (v_org, v_patient, 'SML Test Amlodipine', '5mg', 'once daily', true, 'clinician')
  returning id into v_med;

  insert into sml_fixture(k, v) values ('org', v_org), ('patient', v_patient), ('med', v_med);
end $$;

-- ==========================================================================
-- 1. A high-severity side-effect report against a medication persists the
--    medication_id and is still computed as a red flag.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from sml_fixture where k = 'org');
  v_patient uuid := (select v from sml_fixture where k = 'patient');
  v_med uuid := (select v from sml_fixture where k = 'med');
  v_id uuid;
  v_is_red_flag boolean;
  v_stored_med uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.symptoms
    (organisation_id, patient_id, medication_id, symptom_type, severity, description)
  values (v_org, v_patient, v_med, 'dizziness', 9, 'Very dizzy since starting this')
  returning id into v_id;
  reset role;

  select is_red_flag, medication_id into v_is_red_flag, v_stored_med
  from public.symptoms where id = v_id;

  insert into sml_result values
    ('severity-9 side effect against a medication persists medication_id and is a red flag', 'patient',
     format('red_flag=%s/med=%s', v_is_red_flag, case when v_stored_med = v_med then 'matches' else 'mismatch' end),
     'red_flag=true/med=matches',
     case when v_is_red_flag and v_stored_med = v_med then 'PASS' else 'FAIL' end);
  if not v_is_red_flag or v_stored_med is distinct from v_med then
    raise exception 'BROKEN: a high-severity medication-linked symptom lost its red-flag computation or its medication_id';
  end if;
end $$;

-- ==========================================================================
-- 2. A low-severity side-effect report against the same medication is NOT a
--    red flag (existing threshold behaviour unaffected by medication_id).
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from sml_fixture where k = 'org');
  v_patient uuid := (select v from sml_fixture where k = 'patient');
  v_med uuid := (select v from sml_fixture where k = 'med');
  v_id uuid;
  v_is_red_flag boolean;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.symptoms
    (organisation_id, patient_id, medication_id, symptom_type, severity, description)
  values (v_org, v_patient, v_med, 'nausea', 2, 'Mild, comes and goes')
  returning id into v_id;
  reset role;

  select is_red_flag into v_is_red_flag from public.symptoms where id = v_id;

  insert into sml_result values
    ('severity-2 side effect against a medication is not a red flag', 'patient',
     v_is_red_flag::text, 'false', case when not v_is_red_flag then 'PASS' else 'FAIL' end);
  if v_is_red_flag then
    raise exception 'BROKEN: a low-severity medication-linked symptom was incorrectly computed as a red flag';
  end if;
end $$;

-- ==========================================================================
-- 3. A general symptom report (no medication_id) still works unchanged.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from sml_fixture where k = 'org');
  v_patient uuid := (select v from sml_fixture where k = 'patient');
  v_id uuid;
  v_stored_med uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity)
  values (v_org, v_patient, 'fatigue', 3)
  returning id into v_id;
  reset role;

  select medication_id into v_stored_med from public.symptoms where id = v_id;

  insert into sml_result values
    ('a general symptom report with no medication_id still inserts fine', 'patient',
     case when v_stored_med is null then 'null' else 'set' end, 'null',
     case when v_stored_med is null then 'PASS' else 'FAIL' end);
  if v_stored_med is not null then
    raise exception 'BROKEN: a general symptom report unexpectedly got a medication_id';
  end if;
end $$;

select check_name, role, observed, expected, verdict
from sml_result
order by verdict desc, check_name, role;

rollback;
