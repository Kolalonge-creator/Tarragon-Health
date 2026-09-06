-- ===========================================================================
-- Verification: medication_access_barriers (20260829155516 +
-- 20260829155532) — medication safety pathway 64.20/64.21. A patient can
-- report a structured access barrier for their own medication, it raises a
-- clinician_review clinician_alerts row naming the drug and reason, and a
-- report against someone else's medication is rejected.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
-- Wrapped in BEGIN/ROLLBACK.
-- ===========================================================================

begin;

create temporary table mab_fixture(k text primary key, v uuid) on commit drop;
create temporary table mab_result(
  check_name text, role text, observed text, expected text, verdict text
) on commit drop;

do $$
declare
  v_org uuid;
  v_patient_a uuid;
  v_patient_b uuid := gen_random_uuid();
  v_med_a uuid;
  v_med_b uuid;
begin
  select organisation_id into v_org
  from public.profiles
  where role = 'patient' and organisation_id is not null
  group by organisation_id order by count(*) desc limit 1;
  if v_org is null then
    raise exception 'no organisation has patient profiles — cannot run this test';
  end if;
  select id into v_patient_a from public.profiles where role = 'patient' and organisation_id = v_org limit 1;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_patient_b, 'mab-test-patient-b@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_patient_b, v_org, 'patient', 'MAB Test Patient B')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, is_active, source)
  values (v_org, v_patient_a, 'MAB Test Amlodipine', '5mg', 'once daily', true, 'clinician')
  returning id into v_med_a;

  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, is_active, source)
  values (v_org, v_patient_b, 'MAB Test Metformin', '500mg', 'twice daily', true, 'clinician')
  returning id into v_med_b;

  insert into mab_fixture(k, v) values
    ('org', v_org), ('patient_a', v_patient_a), ('patient_b', v_patient_b),
    ('med_a', v_med_a), ('med_b', v_med_b);
end $$;

-- ==========================================================================
-- 1. Patient reports "expensive" for their own medication -> a clinician_
--    review / medication_access_barrier alert naming the drug and reason.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from mab_fixture where k = 'org');
  v_patient uuid := (select v from mab_fixture where k = 'patient_a');
  v_med uuid := (select v from mab_fixture where k = 'med_a');
  v_alert_count bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.medication_access_barriers (organisation_id, patient_id, medication_id, reason, note)
  values (v_org, v_patient, v_med, 'expensive', 'Cannot afford this month');
  reset role;

  select count(*) into v_alert_count
  from public.clinician_alerts
  where patient_id = v_patient and type_code = 'medication_access_barrier' and category = 'medication'
    and level = 'clinician_review'
    and detail like '%MAB Test Amlodipine%' and detail like '%expensive%';

  insert into mab_result values
    ('patient reporting "expensive" raises a matching clinician_review alert', 'patient',
     v_alert_count::text, '1', case when v_alert_count = 1 then 'PASS' else 'FAIL' end);
  if v_alert_count <> 1 then
    raise exception 'BROKEN: an expensive-medication access barrier report did not raise the expected clinician_alerts row';
  end if;
end $$;

-- ==========================================================================
-- 2. Negative control: a patient cannot report a barrier against someone
--    else's medication.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from mab_fixture where k = 'org');
  v_patient_a uuid := (select v from mab_fixture where k = 'patient_a');
  v_med_b uuid := (select v from mab_fixture where k = 'med_b');
  v_caught boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient_a::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.medication_access_barriers (organisation_id, patient_id, medication_id, reason)
    values (v_org, v_patient_a, v_med_b, 'unavailable');
  exception when others then
    v_caught := true;
  end;
  reset role;

  insert into mab_result values
    ('a patient cannot report a barrier against another patient''s medication', 'patient',
     case when v_caught then 'rejected' else 'accepted' end, 'rejected',
     case when v_caught then 'PASS' else 'FAIL' end);
  if not v_caught then
    raise exception 'BROKEN: a patient reported an access barrier against a medication that is not theirs';
  end if;
end $$;

-- ==========================================================================
-- 3. All 7 reason values are valid and every report keeps its own row
--    (append-only — a second, different reason does not overwrite the first).
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from mab_fixture where k = 'org');
  v_patient uuid := (select v from mab_fixture where k = 'patient_a');
  v_med uuid := (select v from mab_fixture where k = 'med_a');
  v_count bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.medication_access_barriers (organisation_id, patient_id, medication_id, reason)
  values
    (v_org, v_patient, v_med, 'unavailable'),
    (v_org, v_patient, v_med, 'pharmacy_too_far'),
    (v_org, v_patient, v_med, 'delivery_unavailable'),
    (v_org, v_patient, v_med, 'forgot'),
    (v_org, v_patient, v_med, 'side_effects'),
    (v_org, v_patient, v_med, 'didnt_understand_instructions');
  reset role;

  -- 1 from check 1 ('expensive') + 6 more here = 7 distinct rows for this medication.
  select count(*) into v_count from public.medication_access_barriers where medication_id = v_med;

  insert into mab_result values
    ('every reason value is accepted and each report keeps its own row', 'patient',
     v_count::text, '7', case when v_count = 7 then 'PASS' else 'FAIL' end);
  if v_count <> 7 then
    raise exception 'BROKEN: not all 7 access-barrier reasons were accepted as separate rows';
  end if;
end $$;

select check_name, role, observed, expected, verdict
from mab_result
order by verdict desc, check_name, role;

rollback;
