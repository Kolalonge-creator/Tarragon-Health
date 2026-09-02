-- ===========================================================================
-- Verification: private.raise_polypharmacy_review_signals() (20260829160203)
-- — medication safety pathway 64.15. A patient with 5+ active medications
-- gets a routine medication_safety clinician_alerts row; a patient with
-- fewer does not; re-running the sweep does not duplicate the alert.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
-- Wrapped in BEGIN/ROLLBACK.
-- ===========================================================================

begin;

create temporary table ppr_fixture(k text primary key, v uuid) on commit drop;
create temporary table ppr_result(
  check_name text, role text, observed text, expected text, verdict text
) on commit drop;

do $$
declare
  v_org uuid;
  v_patient_5 uuid := gen_random_uuid();
  v_patient_4 uuid := gen_random_uuid();
  i integer;
begin
  select organisation_id into v_org
  from public.profiles
  where role = 'patient' and organisation_id is not null
  group by organisation_id order by count(*) desc limit 1;
  if v_org is null then
    raise exception 'no organisation has patient profiles — cannot run this test';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_patient_5, 'ppr-test-patient-5@example.invalid', 'x', now(), '{}', '{}'),
    (v_patient_4, 'ppr-test-patient-4@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_patient_5, v_org, 'patient', 'PPR Test Patient Five'),
    (v_patient_4, v_org, 'patient', 'PPR Test Patient Four')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  for i in 1..5 loop
    insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, is_active, source)
    values (v_org, v_patient_5, 'PPR Test Drug ' || i, '10mg', 'once daily', true, 'clinician');
  end loop;

  for i in 1..4 loop
    insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, is_active, source)
    values (v_org, v_patient_4, 'PPR Test Drug ' || i, '10mg', 'once daily', true, 'clinician');
  end loop;

  insert into ppr_fixture(k, v) values
    ('org', v_org), ('patient_5', v_patient_5), ('patient_4', v_patient_4);
end $$;

-- ==========================================================================
-- 1. Running the sweep raises a routine medication_safety alert for the
--    5-medication patient but not the 4-medication one.
-- ==========================================================================
do $$
declare
  v_patient_5 uuid := (select v from ppr_fixture where k = 'patient_5');
  v_patient_4 uuid := (select v from ppr_fixture where k = 'patient_4');
  v_count_5 bigint;
  v_count_4 bigint;
begin
  perform private.raise_polypharmacy_review_signals();

  select count(*) into v_count_5 from public.clinician_alerts
  where patient_id = v_patient_5 and type_code = 'medication_safety' and category = 'clinical'
    and level = 'routine' and title like 'Polypharmacy:%';
  select count(*) into v_count_4 from public.clinician_alerts
  where patient_id = v_patient_4 and type_code = 'medication_safety' and title like 'Polypharmacy:%';

  insert into ppr_result values
    ('5 active medications raises a routine polypharmacy alert', 'system',
     v_count_5::text, '1', case when v_count_5 = 1 then 'PASS' else 'FAIL' end);
  if v_count_5 <> 1 then
    raise exception 'BROKEN: a patient with 5 active medications did not get a polypharmacy review signal';
  end if;

  insert into ppr_result values
    ('4 active medications raises no polypharmacy alert', 'system',
     v_count_4::text, '0', case when v_count_4 = 0 then 'PASS' else 'FAIL' end);
  if v_count_4 <> 0 then
    raise exception 'BROKEN: a patient with only 4 active medications incorrectly got a polypharmacy review signal';
  end if;
end $$;

-- ==========================================================================
-- 2. Running the sweep again does not raise a second alert for the same
--    patient within the dedup window.
-- ==========================================================================
do $$
declare
  v_patient_5 uuid := (select v from ppr_fixture where k = 'patient_5');
  v_count bigint;
begin
  perform private.raise_polypharmacy_review_signals();

  select count(*) into v_count from public.clinician_alerts
  where patient_id = v_patient_5 and type_code = 'medication_safety' and title like 'Polypharmacy:%';

  insert into ppr_result values
    ('re-running the sweep does not duplicate the alert', 'system',
     v_count::text, '1', case when v_count = 1 then 'PASS' else 'FAIL' end);
  if v_count <> 1 then
    raise exception 'BROKEN: re-running the polypharmacy sweep created a duplicate alert for the same patient';
  end if;
end $$;

select check_name, role, observed, expected, verdict
from ppr_result
order by verdict desc, check_name, role;

rollback;
