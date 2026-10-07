-- ===========================================================================
-- Verification: 20260922183343_fix_remaining_can_read_clinical_bare_literal_policies
--
-- private.can_read_clinical has 3 live overloads: the legacy 1-arg form, the
-- 2-arg (uuid, care_access_category) form, and the 2-arg (uuid,
-- caregiver_permission) form added by 20260902234600. A bare untyped string
-- literal second argument -- private.can_read_clinical(patient_id,
-- 'medical_history') -- is ambiguous the moment all three overloads coexist,
-- regardless of what the literal's value is (this is type resolution on an
-- "unknown"-typed literal, not a check of whether the value is a valid
-- enum member -- 'medical_history' isn't even a valid caregiver_permission
-- value, and it's still rejected).
--
-- RLS policies bind their expression tree once, at CREATE POLICY time, so a
-- policy created back when only 1-2 overloads existed keeps working forever
-- -- Postgres never re-resolves an already-bound policy. The hole is a
-- FUTURE migration that DROP + CREATE POLICYs the same bare text again
-- (typically copy-pasted from the table's own history without knowing the
-- literal became ambiguous in the meantime): that fresh CREATE POLICY
-- re-resolves against every overload live today and fails outright. This is
-- exactly what happened on the (separate, unmerged) admin/support "view as"
-- branch, which had to add an explicit cast to vitals_readings_select and
-- screening_schedules_select for precisely this reason. 20260922183343 did
-- the same for the 16 other policies still carrying the bare form.
--
-- What is checked here, and why:
--   1. The 3-overload precondition still holds -- if an overload is ever
--      removed, every assumption below (and the fix itself) needs re-review.
--   2. Every one of the 16 policies 20260922183343 touched now carries an
--      explicit ::care_access_category cast on its can_read_clinical call.
--   3. Sabotage: a scratch policy created with the OLD bare-literal text,
--      against a real table, actually fails to even CREATE (42725) -- this
--      is not a hypothetical, it reproduces the exact failure mode the fix
--      exists to prevent. The same scratch policy with the cast added
--      succeeds. If case 3's first half ever stops failing, the precondition
--      in check 1 no longer holds and this whole suite should be revisited.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK -- leaves the database exactly as it found it,
-- including the scratch policy used for the sabotage check.
-- ===========================================================================

begin;

create temporary table crcblpc_result(
  check_name text,
  observed   text,
  expected   text,
  verdict    text
) on commit drop;

-- ---------------------------------------------------------------------------
-- 1. Precondition: exactly 3 live overloads.
-- ---------------------------------------------------------------------------
do $$
declare
  v_count int;
begin
  select count(*) into v_count
  from pg_proc
  where proname = 'can_read_clinical' and pronamespace = 'private'::regnamespace;

  insert into crcblpc_result values (
    'overload_count',
    v_count::text,
    '3',
    case when v_count = 3 then 'PASS' else 'FAIL' end
  );
end $$;

-- ---------------------------------------------------------------------------
-- 2. Every policy the fix migration touched carries an explicit cast, and
--    none of them regressed to the bare pattern.
-- ---------------------------------------------------------------------------
do $$
declare
  v_policy text;
  v_category text;
  v_qual text;
begin
  for v_policy, v_category in
    select * from (values
      ('care_message_attachments_select', 'messaging'),
      ('care_plan_goals_select', 'appointments_care_plan'),
      ('care_plan_interventions_select', 'appointments_care_plan'),
      ('clinical_summaries_select', 'medical_history'),
      ('clinician_alerts_select', 'medical_history'),
      ('escalations_select', 'medical_history'),
      ('medication_logs_select', 'medications'),
      ('patient_blood_profile_select', 'medical_history'),
      ('patient_cardiovascular_profile_select', 'medical_history'),
      ('patient_quarterly_reports_select', 'medical_history'),
      ('patient_risk_scores_select', 'medical_history'),
      ('patient_serology_status_select', 'medical_history'),
      ('reproductive_health_profiles_select', 'reproductive_health'),
      ('symptom_triage_assessments_select', 'medical_history'),
      ('vaccination_records_select', 'vaccinations'),
      ('vaccination_schedules_select', 'vaccinations')
    ) as t(policyname, category)
  loop
    select qual into v_qual from pg_policies
    where schemaname = 'public' and policyname = v_policy;

    if v_qual is null then
      insert into crcblpc_result values (
        'cast_present:' || v_policy, 'policy missing', 'policy exists', 'FAIL'
      );
    elsif v_qual ~ ('can_read_clinical\([^,]+,\s*''' || v_category || '''::care_access_category\)')
    then
      insert into crcblpc_result values (
        'cast_present:' || v_policy, 'explicit cast present', 'explicit cast present', 'PASS'
      );
    else
      insert into crcblpc_result values (
        'cast_present:' || v_policy, v_qual, 'explicit ::care_access_category cast, no bare form', 'FAIL'
      );
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Sabotage: reproduce the real failure mode. A scratch policy on a real
--    table, written with the pre-fix bare-literal text, must fail to CREATE
--    at all (42725) -- exactly what would have hit any of the 16 fixed
--    policies had a future migration re-created them without the cast. The
--    same scratch policy with the cast succeeds.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bare_failed boolean := false;
  v_cast_succeeded boolean := false;
begin
  begin
    execute $sql$
      create policy crcblpc_sabotage_bare_select on public.clinical_summaries
        for select to authenticated
        using (private.can_read_clinical(patient_id, 'medical_history'))
    $sql$;
    -- if we get here, it did NOT fail -- clean up and record the miss below
    execute 'drop policy crcblpc_sabotage_bare_select on public.clinical_summaries';
  exception when sqlstate '42725' then
    v_bare_failed := true;
  end;

  insert into crcblpc_result values (
    'sabotage_bare_literal_create_policy_fails',
    case when v_bare_failed then '42725 raised' else 'no error' end,
    '42725 raised',
    case when v_bare_failed then 'PASS' else 'FAIL' end
  );

  begin
    execute $sql$
      create policy crcblpc_sabotage_cast_select on public.clinical_summaries
        for select to authenticated
        using (private.can_read_clinical(patient_id, 'medical_history'::public.care_access_category))
    $sql$;
    v_cast_succeeded := true;
    execute 'drop policy crcblpc_sabotage_cast_select on public.clinical_summaries';
  exception when others then
    v_cast_succeeded := false;
  end;

  insert into crcblpc_result values (
    'cast_form_create_policy_succeeds',
    case when v_cast_succeeded then 'created and dropped cleanly' else 'raised an error' end,
    'created and dropped cleanly',
    case when v_cast_succeeded then 'PASS' else 'FAIL' end
  );
end $$;

-- ---------------------------------------------------------------------------
-- Report, then fail loudly if anything did not pass -- a FAIL row alone
-- would exit 0 and look green to any runner that doesn't parse the table.
-- ---------------------------------------------------------------------------
select * from crcblpc_result order by check_name;

do $$
declare
  v_fail_count int;
begin
  select count(*) into v_fail_count from crcblpc_result where verdict <> 'PASS';
  if v_fail_count > 0 then
    raise exception '% check(s) FAILED -- see crcblpc_result above', v_fail_count;
  end if;
  raise notice 'PASS: all can_read_clinical bare-literal policy cast checks passed';
end $$;

rollback;
