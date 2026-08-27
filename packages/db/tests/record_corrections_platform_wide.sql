-- ===========================================================================
-- Verification: private.capture_record_correction() (20260827195333_record_
-- corrections_platform_wide.sql) records old/new values for exactly the
-- columns that changed on a real UPDATE (here, care_plans.status), captures
-- an optional reason via the app.change_reason GUC, and — the important
-- negative check — is NOT readable by an ordinary org-staff/clinician
-- session, only by admin or the record's own patient. That narrower policy
-- is the entire point of this migration (see its header): audit_log's own
-- is_org_staff() read policy is deliberately NOT reused here.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — leaves the database exactly as it found it.
-- ===========================================================================

begin;

create temporary table rcpw_fixture(k text primary key, v uuid) on commit drop;
create temporary table rcpw_result(
  check_name text,
  role       text,
  observed   text,
  expected   text,
  verdict    text
) on commit drop;

do $$
declare
  v_org       uuid;
  v_patient   uuid;
  v_clinician uuid := gen_random_uuid();
  v_admin     uuid := gen_random_uuid();
  v_plan      uuid;
begin
  select organisation_id into v_org
  from public.profiles
  where role = 'patient' and organisation_id is not null
  group by organisation_id order by count(*) desc limit 1;

  if v_org is null then
    raise exception 'no organisation has patient profiles — cannot run this test';
  end if;

  select id into v_patient
  from public.profiles
  where role = 'patient' and organisation_id = v_org limit 1;

  insert into rcpw_fixture(k, v) values
    ('org', v_org), ('patient', v_patient), ('clinician', v_clinician), ('admin', v_admin);

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_clinician, 'rcpw-test-clinician@example.invalid', 'x', now(), '{}', '{}'),
    (v_admin, 'rcpw-test-admin@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_clinician, v_org, 'clinician', 'RCPW Test Clinician')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;

  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_admin, null, 'admin', 'RCPW Test Admin')
  on conflict (id) do update set role = excluded.role;

  insert into public.care_plans (organisation_id, patient_id, condition, status, assigned_clinician_id)
  values (v_org, v_patient, 'hypertension', 'active', v_clinician)
  returning id into v_plan;

  insert into rcpw_fixture(k, v) values ('plan', v_plan);
end $$;

-- ==========================================================================
-- 1. A real UPDATE (as the assigned clinician) with a reason set via the
--    GUC records exactly one correction row, with the right old/new values,
--    changed_columns, and reason.
-- ==========================================================================
do $$
declare
  v_clinician uuid := (select v from rcpw_fixture where k = 'clinician');
  v_plan      uuid := (select v from rcpw_fixture where k = 'plan');
  v_row       record;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clinician::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform set_config('app.change_reason', 'annual review: BP now controlled', true);
  update public.care_plans set status = 'completed' where id = v_plan;
  reset role;

  select * into v_row from public.record_corrections
    where table_name = 'care_plans' and entity_id = v_plan
    order by corrected_at desc limit 1;

  insert into rcpw_result values
    ('correction row created', 'clinician', case when v_row.id is not null then 'yes' else 'no' end,
     'yes', case when v_row.id is not null then 'PASS' else 'FAIL' end);
  if v_row.id is null then
    raise exception 'BROKEN: no record_corrections row was written for the care_plans update';
  end if;

  insert into rcpw_result values
    ('changed_columns contains status', 'clinician', array_to_string(v_row.changed_columns, ','),
     'contains status', case when 'status' = any(v_row.changed_columns) then 'PASS' else 'FAIL' end);
  if not ('status' = any(v_row.changed_columns)) then
    raise exception 'BROKEN: changed_columns did not include status, got %', v_row.changed_columns;
  end if;

  insert into rcpw_result values
    ('old_values.status', 'clinician', v_row.old_values ->> 'status', 'active',
     case when v_row.old_values ->> 'status' = 'active' then 'PASS' else 'FAIL' end);
  if v_row.old_values ->> 'status' is distinct from 'active' then
    raise exception 'BROKEN: old_values.status was %, expected active', v_row.old_values ->> 'status';
  end if;

  insert into rcpw_result values
    ('new_values.status', 'clinician', v_row.new_values ->> 'status', 'completed',
     case when v_row.new_values ->> 'status' = 'completed' then 'PASS' else 'FAIL' end);
  if v_row.new_values ->> 'status' is distinct from 'completed' then
    raise exception 'BROKEN: new_values.status was %, expected completed', v_row.new_values ->> 'status';
  end if;

  insert into rcpw_result values
    ('reason captured from GUC', 'clinician', coalesce(v_row.reason, 'null'),
     'annual review: BP now controlled',
     case when v_row.reason = 'annual review: BP now controlled' then 'PASS' else 'FAIL' end);
  if v_row.reason is distinct from 'annual review: BP now controlled' then
    raise exception 'BROKEN: reason was %, expected the GUC value', v_row.reason;
  end if;
end $$;

-- ==========================================================================
-- 2. A bare updated_at touch (no other column changed) writes NO correction
--    row — same no-op suppression as audit_row_change.
-- ==========================================================================
do $$
declare
  v_clinician uuid := (select v from rcpw_fixture where k = 'clinician');
  v_plan      uuid := (select v from rcpw_fixture where k = 'plan');
  v_count_before bigint;
  v_count_after  bigint;
begin
  select count(*) into v_count_before from public.record_corrections
    where table_name = 'care_plans' and entity_id = v_plan;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clinician::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.care_plans set updated_at = now() where id = v_plan;
  reset role;

  select count(*) into v_count_after from public.record_corrections
    where table_name = 'care_plans' and entity_id = v_plan;

  insert into rcpw_result values
    ('bare updated_at touch is not a correction', 'clinician', v_count_after::text, v_count_before::text,
     case when v_count_after = v_count_before then 'PASS' else 'FAIL' end);
  if v_count_after <> v_count_before then
    raise exception 'BROKEN: a bare updated_at touch created a correction row';
  end if;
end $$;

-- ==========================================================================
-- 3. The patient can read the correction on their own care plan.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from rcpw_fixture where k = 'patient');
  v_plan    uuid := (select v from rcpw_fixture where k = 'plan');
  v_count   bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.record_corrections
    where table_name = 'care_plans' and entity_id = v_plan;
  reset role;

  insert into rcpw_result values
    ('patient reads own correction', 'patient', v_count::text, '>=1',
     case when v_count >= 1 then 'PASS' else 'FAIL' end);
  if v_count < 1 then
    raise exception 'BROKEN: patient could not read the correction on their own care plan';
  end if;
end $$;

-- ==========================================================================
-- 4. Negative check — the assigned CLINICIAN (ordinary org staff, not
--    admin) who made the edit cannot read the correction row back. This is
--    the deliberate narrowing this migration exists to prove: is_org_staff
--    is NOT in record_corrections_select.
-- ==========================================================================
do $$
declare
  v_clinician uuid := (select v from rcpw_fixture where k = 'clinician');
  v_plan      uuid := (select v from rcpw_fixture where k = 'plan');
  v_count     bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clinician::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.record_corrections
    where table_name = 'care_plans' and entity_id = v_plan;
  reset role;

  insert into rcpw_result values
    ('org-staff clinician CANNOT read correction', 'clinician', v_count::text, '0',
     case when v_count = 0 then 'PASS' else 'FAIL' end);
  if v_count <> 0 then
    raise exception 'LEAK: an ordinary org-staff session can read record_corrections (% rows) — is_org_staff must not be in this policy', v_count;
  end if;
end $$;

-- ==========================================================================
-- 5. Admin can read it.
-- ==========================================================================
do $$
declare
  v_admin uuid := (select v from rcpw_fixture where k = 'admin');
  v_plan  uuid := (select v from rcpw_fixture where k = 'plan');
  v_count bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.record_corrections
    where table_name = 'care_plans' and entity_id = v_plan;
  reset role;

  insert into rcpw_result values
    ('admin reads correction', 'admin', v_count::text, '>=1',
     case when v_count >= 1 then 'PASS' else 'FAIL' end);
  if v_count < 1 then
    raise exception 'BROKEN: admin session could not read record_corrections';
  end if;
end $$;

-- ==========================================================================
-- 6. record_corrections itself is append-only: an admin cannot update or
--    delete a correction row.
-- ==========================================================================
do $$
declare
  v_admin  uuid := (select v from rcpw_fixture where k = 'admin');
  v_plan   uuid := (select v from rcpw_fixture where k = 'plan');
  v_row_id uuid;
  v_caught boolean := false;
begin
  select id into v_row_id from public.record_corrections
    where table_name = 'care_plans' and entity_id = v_plan limit 1;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.record_corrections set reason = 'tampered' where id = v_row_id;
  exception when others then
    v_caught := true;
  end;
  reset role;

  insert into rcpw_result values
    ('record_corrections is append-only', 'admin', case when v_caught then 'blocked' else 'not blocked' end,
     'blocked', case when v_caught then 'PASS' else 'FAIL' end);
  if not v_caught then
    raise exception 'BROKEN: a correction row could be updated in place';
  end if;
end $$;

select check_name, role, observed, expected, verdict
from rcpw_result
order by verdict desc, check_name, role;

rollback;
