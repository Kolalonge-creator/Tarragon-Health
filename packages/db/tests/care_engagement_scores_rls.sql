-- Verification: care_engagement_scores and patient_engagement_interventions
-- RLS (20260828230602_care_engagement_score_core.sql,
-- 20260828231038_engagement_intervention_types.sql) actually discriminates
-- by patient/org, not just that the policy text looks right.
--
-- Run via `supabase db query --linked -f packages/db/tests/care_engagement_scores_rls.sql`,
-- `psql $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Same set_config('request.jwt.claims', ...) + `set local role authenticated`
-- pattern as packages/db/tests/lpe_content_blocks_review_gate_rls.sql —
-- simulates a real client session; running as the connecting superuser would
-- silently bypass RLS via table ownership. Uses throwaway profiles created
-- inline (not pre-seeded @tarragon.test fixtures) so this test controls its
-- own org/role setup exactly, rather than depending on whatever real data
-- happens to exist. Wrapped in BEGIN/ROLLBACK; nothing here persists.
--
-- Checks a sabotage-style discrimination, not just a bare "sees 0 rows": a
-- second patient's score row is inserted mid-test and the first patient's
-- session is re-queried, proving the policy actually filters by patient_id
-- rather than e.g. accidentally allowing the whole organisation through.

begin;

do $$
declare
  v_org_a uuid := gen_random_uuid();
  v_org_b uuid := gen_random_uuid();
  v_patient_a1 uuid := gen_random_uuid();
  v_patient_a2 uuid := gen_random_uuid();
  v_patient_b1 uuid := gen_random_uuid();
  v_staff_a uuid := gen_random_uuid();
  v_count bigint;
  v_intervention_id uuid;
begin
  insert into public.organisations (id) values (v_org_a), (v_org_b);
  insert into public.profiles (id, organisation_id, role) values
    (v_patient_a1, v_org_a, 'patient'),
    (v_patient_a2, v_org_a, 'patient'),
    (v_patient_b1, v_org_b, 'patient'),
    (v_staff_a, v_org_a, 'clinician');

  insert into public.care_engagement_scores (organisation_id, patient_id, composite_score, engagement_level)
  values (v_org_a, v_patient_a1, 75.00, 'engaged');

  -- 1. Patient A1 sees exactly their own row.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient_a1::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.care_engagement_scores;
  reset role;
  if v_count <> 1 then
    raise exception 'FAIL: patient A1 sees % care_engagement_scores rows, expected 1 (their own)', v_count;
  end if;
  raise notice 'PASS: patient A1 sees exactly their own care_engagement_scores row';

  -- 2. Sabotage: insert a second, different patient's row in the SAME org.
  -- If the policy were accidentally org-wide rather than patient-scoped,
  -- patient A1 would now see 2 rows instead of still 1.
  insert into public.care_engagement_scores (organisation_id, patient_id, composite_score, engagement_level)
  values (v_org_a, v_patient_a2, 40.00, 'at_risk');

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient_a1::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.care_engagement_scores;
  reset role;
  if v_count <> 1 then
    raise exception 'FAIL: patient A1 sees % rows after a same-org other patient''s row was inserted, expected still 1 (policy is not patient-scoped)', v_count;
  end if;
  raise notice 'PASS: patient A1 still sees exactly 1 row after a same-org other patient''s row appeared (policy is patient-scoped, not org-wide)';

  -- 3. Patient B1 (different org) sees nothing at all.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient_b1::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.care_engagement_scores;
  reset role;
  if v_count <> 0 then
    raise exception 'FAIL: cross-org patient B1 sees % care_engagement_scores rows, expected 0', v_count;
  end if;
  raise notice 'PASS: cross-org patient B1 sees 0 rows';

  -- 4. Org A staff sees both org A patients' rows, not the cross-org one.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_staff_a::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.care_engagement_scores;
  reset role;
  if v_count <> 2 then
    raise exception 'FAIL: org A staff sees % rows, expected 2 (both org A patients, not the cross-org one)', v_count;
  end if;
  raise notice 'PASS: org A staff sees both org A rows and nothing from org B';

  -- 5. A patient cannot write their own score row (system/staff-computed only).
  -- The FAIL raise below is deliberately OUTSIDE the exception-catching block:
  -- an earlier draft of this check put it inside, where a `when others` handler
  -- would have silently swallowed that very raise too if the insert had
  -- wrongly succeeded — exactly the vacuous-pass trap this style of test
  -- exists to catch (see packages/db/tests/medication_logs_acting_for.sql's
  -- note on the same failure mode).
  declare
    v_insert_succeeded boolean := false;
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_patient_a1::text, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      insert into public.care_engagement_scores (organisation_id, patient_id, composite_score, engagement_level)
      values (v_org_a, v_patient_a1, 99.00, 'highly_engaged');
      v_insert_succeeded := true;
    exception
      when insufficient_privilege then null;
      when others then null;
    end;
    reset role;
    if v_insert_succeeded then
      raise exception 'FAIL: patient A1 was able to insert their own care_engagement_scores row (should be staff/system-only)';
    end if;
    raise notice 'PASS: patient A1 cannot insert their own care_engagement_scores row';
  end;

  -- 6. patient_engagement_interventions is staff-only — a patient must never
  -- see the internal reasoning log behind why they were targeted.
  insert into public.patient_engagement_interventions
    (organisation_id, patient_id, trigger_reason, intervention_type, engagement_level_at_trigger)
  values (v_org_a, v_patient_a1, 'missed_task', 'reminder', 'at_risk')
  returning id into v_intervention_id;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient_a1::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.patient_engagement_interventions where id = v_intervention_id;
  reset role;
  if v_count <> 0 then
    raise exception 'FAIL: patient A1 can see their own patient_engagement_interventions row (must be staff-only)';
  end if;
  raise notice 'PASS: patient A1 cannot see patient_engagement_interventions at all (staff-only)';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_staff_a::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.patient_engagement_interventions where id = v_intervention_id;
  reset role;
  if v_count <> 1 then
    raise exception 'FAIL: org A staff cannot see the patient_engagement_interventions row they should be able to';
  end if;
  raise notice 'PASS: org A staff can see the patient_engagement_interventions row';
end $$;

rollback;
