-- ===========================================================================
-- Verification: family_history (20260827195741) and social_history
-- (20260827195802) — a patient can add/edit their own rows (unlike
-- patient_conditions), social_history enforces one row per patient, and
-- edits land in the platform-wide record_corrections trail.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
-- Wrapped in BEGIN/ROLLBACK.
-- ===========================================================================

begin;

create temporary table fash_fixture(k text primary key, v uuid) on commit drop;
create temporary table fash_result(
  check_name text, role text, observed text, expected text, verdict text
) on commit drop;

do $$
declare
  v_org uuid;
  v_patient uuid;
begin
  select organisation_id into v_org
  from public.profiles
  where role = 'patient' and organisation_id is not null
  group by organisation_id order by count(*) desc limit 1;
  if v_org is null then
    raise exception 'no organisation has patient profiles — cannot run this test';
  end if;
  select id into v_patient from public.profiles where role = 'patient' and organisation_id = v_org limit 1;
  insert into fash_fixture(k, v) values ('org', v_org), ('patient', v_patient);
end $$;

-- ==========================================================================
-- 1. Patient can self-insert a family_history row.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from fash_fixture where k = 'org');
  v_patient uuid := (select v from fash_fixture where k = 'patient');
  v_row_count bigint;
  v_family_history_id uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.family_history
    (organisation_id, patient_id, condition_name, relationship, age_of_onset_years, is_deceased)
  values (v_org, v_patient, 'Type 2 diabetes', 'mother', 52, false)
  returning id into v_family_history_id;
  get diagnostics v_row_count = row_count;
  reset role;

  insert into fash_fixture(k, v) values ('family_history_id', v_family_history_id);

  insert into fash_result values
    ('patient self-inserts family_history', 'patient', v_row_count::text, '1',
     case when v_row_count = 1 then 'PASS' else 'FAIL' end);
  if v_row_count <> 1 then
    raise exception 'BROKEN: patient could not insert their own family_history row';
  end if;
end $$;

-- ==========================================================================
-- 2. Patient can correct that row (e.g. age of onset), and the correction
--    lands in record_corrections.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from fash_fixture where k = 'patient');
  v_id uuid := (select v from fash_fixture where k = 'family_history_id');
  v_count bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.family_history set age_of_onset_years = 55 where id = v_id;
  reset role;

  select count(*) into v_count from public.record_corrections
    where table_name = 'family_history' and entity_id = v_id
      and 'age_of_onset_years' = any(changed_columns);

  insert into fash_result values
    ('family_history correction captured', 'patient', v_count::text, '>=1',
     case when v_count >= 1 then 'PASS' else 'FAIL' end);
  if v_count < 1 then
    raise exception 'BROKEN: family_history age_of_onset_years correction was not captured';
  end if;
end $$;

-- ==========================================================================
-- 3. Patient can self-insert their social_history (one row).
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from fash_fixture where k = 'org');
  v_patient uuid := (select v from fash_fixture where k = 'patient');
  v_row_count bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.social_history (organisation_id, patient_id, occupation, living_situation)
  values (v_org, v_patient, 'Market trader', 'Lives with extended family');
  get diagnostics v_row_count = row_count;
  reset role;

  insert into fash_result values
    ('patient self-inserts social_history', 'patient', v_row_count::text, '1',
     case when v_row_count = 1 then 'PASS' else 'FAIL' end);
  if v_row_count <> 1 then
    raise exception 'BROKEN: patient could not insert their own social_history row';
  end if;
end $$;

-- ==========================================================================
-- 4. A second social_history row for the same patient is rejected (one row
--    per patient).
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from fash_fixture where k = 'org');
  v_patient uuid := (select v from fash_fixture where k = 'patient');
  v_caught boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.social_history (organisation_id, patient_id, occupation)
    values (v_org, v_patient, 'Second row attempt');
  exception when others then
    v_caught := true;
  end;
  reset role;

  insert into fash_result values
    ('social_history rejects a second row per patient', 'patient',
     case when v_caught then 'blocked' else 'not blocked' end, 'blocked',
     case when v_caught then 'PASS' else 'FAIL' end);
  if not v_caught then
    raise exception 'BROKEN: social_history allowed a second row for the same patient';
  end if;
end $$;

-- ==========================================================================
-- 5. Updating the existing social_history row (the real continuously-
--    editable path) still works and is captured as a correction.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from fash_fixture where k = 'patient');
  v_row_count bigint;
  v_correction_count bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.social_history set occupation = 'Retired market trader' where patient_id = v_patient;
  get diagnostics v_row_count = row_count;
  reset role;

  select count(*) into v_correction_count from public.record_corrections
    where table_name = 'social_history' and patient_id = v_patient
      and 'occupation' = any(changed_columns);

  insert into fash_result values
    ('social_history update + correction capture', 'patient', v_row_count::text || '/' || v_correction_count::text,
     '1/>=1', case when v_row_count = 1 and v_correction_count >= 1 then 'PASS' else 'FAIL' end);
  if v_row_count <> 1 or v_correction_count < 1 then
    raise exception 'BROKEN: social_history update or its correction capture failed';
  end if;
end $$;

select check_name, role, observed, expected, verdict
from fash_result
order by verdict desc, check_name, role;

rollback;
