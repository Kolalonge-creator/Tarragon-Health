-- ===========================================================================
-- Verification: medication_reviews.outcome + stamp_medication_review_
-- completion's outcome-required guard (20260829144151) — medication safety
-- pathway 64.14. Completing a review without an outcome must fail;
-- completing one WITH an outcome must still stamp reviewed_by/completed_at
-- exactly as before (regression check on the pre-existing behaviour).
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
-- Wrapped in BEGIN/ROLLBACK.
-- ===========================================================================

begin;

create temporary table mro_fixture(k text primary key, v uuid) on commit drop;
create temporary table mro_result(
  check_name text, role text, observed text, expected text, verdict text
) on commit drop;

do $$
declare
  v_org uuid;
  v_patient uuid;
  v_staff uuid := gen_random_uuid();
  v_plan_1 uuid;
  v_plan_2 uuid;
  v_review_no_outcome uuid;
  v_review_with_outcome uuid;
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
  values (v_staff, 'mro-test-staff@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_staff, v_org, 'clinician', 'MRO Test Staff')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, doctor_tier)
  values (v_org, v_staff, 'MRO Test Staff', true, 'tier_2');

  -- Two separate care plans, each 'draft' (not 'active'), so
  -- care_plans_ensure_review never auto-schedules a review of its own —
  -- medication_reviews_one_pending_per_plan allows only one PENDING review
  -- per care_plan_id, and each test case here needs to own its own row.
  insert into public.care_plans (organisation_id, patient_id, condition, status)
  values (v_org, v_patient, 'hypertension', 'draft')
  returning id into v_plan_1;
  insert into public.care_plans (organisation_id, patient_id, condition, status)
  values (v_org, v_patient, 'hypertension', 'draft')
  returning id into v_plan_2;

  insert into public.medication_reviews (organisation_id, patient_id, care_plan_id, status, due_date)
  values (v_org, v_patient, v_plan_1, 'pending', current_date)
  returning id into v_review_no_outcome;

  insert into public.medication_reviews (organisation_id, patient_id, care_plan_id, status, due_date)
  values (v_org, v_patient, v_plan_2, 'pending', current_date)
  returning id into v_review_with_outcome;

  insert into mro_fixture(k, v) values
    ('org', v_org), ('patient', v_patient), ('staff', v_staff),
    ('plan_1', v_plan_1), ('plan_2', v_plan_2),
    ('review_no_outcome', v_review_no_outcome), ('review_with_outcome', v_review_with_outcome);
end $$;

-- ==========================================================================
-- 1. Completing WITHOUT an outcome is rejected.
-- ==========================================================================
do $$
declare
  v_staff uuid := (select v from mro_fixture where k = 'staff');
  v_review uuid := (select v from mro_fixture where k = 'review_no_outcome');
  v_caught boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_staff::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.medication_reviews set status = 'completed', notes = 'Looks stable' where id = v_review;
  exception when others then
    v_caught := true;
  end;
  reset role;

  insert into mro_result values
    ('completing a review with no outcome is rejected', 'clinician',
     case when v_caught then 'rejected' else 'accepted' end, 'rejected',
     case when v_caught then 'PASS' else 'FAIL' end);
  if not v_caught then
    raise exception 'BROKEN: a medication review was completed with no outcome';
  end if;
end $$;

-- ==========================================================================
-- 2. Completing WITH an outcome succeeds and still stamps reviewed_by /
--    completed_at server-side (regression on the pre-existing behaviour).
-- ==========================================================================
do $$
declare
  v_staff uuid := (select v from mro_fixture where k = 'staff');
  v_review uuid := (select v from mro_fixture where k = 'review_with_outcome');
  v_status text;
  v_outcome text;
  v_reviewed_by uuid;
  v_completed_at timestamptz;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_staff::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.medication_reviews
    set status = 'completed', outcome = 'continue', notes = 'Well controlled, no changes'
    where id = v_review;
  reset role;

  select status::text, outcome::text, reviewed_by, completed_at
    into v_status, v_outcome, v_reviewed_by, v_completed_at
  from public.medication_reviews where id = v_review;

  insert into mro_result values
    ('completing with an outcome succeeds and stamps reviewed_by/completed_at', 'clinician',
     format('%s/%s/reviewed_by=%s/completed_at=%s', v_status, v_outcome,
            case when v_reviewed_by is not null then 'set' else 'null' end,
            case when v_completed_at is not null then 'set' else 'null' end),
     'completed/continue/reviewed_by=set/completed_at=set',
     case when v_status = 'completed' and v_outcome = 'continue'
            and v_reviewed_by is not null and v_completed_at is not null
          then 'PASS' else 'FAIL' end);
  if v_status <> 'completed' or v_outcome <> 'continue' or v_reviewed_by is null or v_completed_at is null then
    raise exception 'BROKEN: completing a review with a valid outcome did not persist correctly or lost server-side attribution';
  end if;
end $$;

select check_name, role, observed, expected, verdict
from mro_result
order by verdict desc, check_name, role;

rollback;
