-- Tarragon Health — close the remaining private.can_read_clinical(uuid, <bare literal>)
-- ambiguity risk across every RLS policy still carrying the untyped form.
--
-- private.can_read_clinical now has THREE live overloads: the legacy 1-arg form, the
-- 2-arg (uuid, public.care_access_category) form, and the 2-arg
-- (uuid, public.caregiver_permission) form added by
-- 20260902234600_caregiver_permission_enforcement.sql. Confirmed live via:
--   select pg_get_function_identity_arguments(oid) from pg_proc
--   where proname = 'can_read_clinical' and pronamespace = 'private'::regnamespace;
--
-- An admin/support "view as" PR (branch claude/zen-montalcini-16829e, not yet merged into
-- main-dev) hit this for real: a fresh CREATE POLICY re-resolves the function call against
-- every overload live TODAY, even though the bare text it copied from vitals_readings_select
-- / screening_schedules_select's own last migration (20260902232555) had applied cleanly —
-- because that migration ran before the caregiver_permission overload existed, and Postgres
-- never re-resolves an already-bound policy expression once it's in the catalog. That PR
-- fixed the two policies it happened to touch (its own migration
-- 20260922175144_support_view_as.sql, section 9) but left every other policy carrying the
-- same bare-literal text exactly as exposed. This migration is the sweep: every other
-- private.can_read_clinical(patient_id, '<literal>') call left bare by
-- 20260830103251_category_scoped_clinical_access_and_emergency_access.sql,
-- 20260902213714_fix_reproductive_health_profiles_rls_regression.sql, or
-- 20260902232555_fix_six_policies_still_on_legacy_can_read_clinical_overload.sql (all three
-- predate the caregiver_permission overload, exactly like the two support_view_as fixed) gets
-- the explicit ::public.care_access_category cast it always needed but never had to write
-- until a sibling overload existed. private.has_emergency_access is untouched — confirmed
-- via the same pg_proc query it has exactly one live overload, so its own bare literal
-- argument is not ambiguous and doesn't need a cast.
--
-- vitals_readings_select and screening_schedules_select are deliberately NOT touched here —
-- already fixed on the live project by the (unmerged) support_view_as migration; redefining
-- them from this branch's own migration history would silently strip the can_support_view
-- read-surface clause that migration already added live. Every clause below, for every other
-- table, is copied byte-identical from the live definition (confirmed against
-- koiplnmbgnqnbywhpjlf via pg_policies, cross-checked against each policy's own last-defining
-- migration file to confirm no other drift) — the only change is the added cast.
--
-- Dry-run: applied via `npx supabase db query --linked -f` wrapped in BEGIN/ROLLBACK against
-- the live project before this file was written for real; see PR description for the
-- transcript. private.is_org_staff() is untouched by this migration (per CLAUDE.md, that
-- function is the one that would need packages/db/tests/ re-run wholesale — this migration
-- only touches can_read_clinical call sites inside other policies).

drop policy if exists care_message_attachments_select on public.care_message_attachments;
create policy care_message_attachments_select on public.care_message_attachments
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'messaging'::public.care_access_category)
    or private.has_emergency_access(patient_id, 'messaging')
  );

drop policy if exists care_plan_goals_select on public.care_plan_goals;
create policy care_plan_goals_select on public.care_plan_goals
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'appointments_care_plan'::public.care_access_category)
    or private.has_emergency_access(patient_id, 'appointments_care_plan')
  );

drop policy if exists care_plan_interventions_select on public.care_plan_interventions;
create policy care_plan_interventions_select on public.care_plan_interventions
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'appointments_care_plan'::public.care_access_category)
    or private.has_emergency_access(patient_id, 'appointments_care_plan')
  );

drop policy if exists clinical_summaries_select on public.clinical_summaries;
create policy clinical_summaries_select on public.clinical_summaries
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'medical_history'::public.care_access_category)
    or private.has_emergency_access(patient_id, 'medical_history')
  );

drop policy if exists clinician_alerts_select on public.clinician_alerts;
create policy clinician_alerts_select on public.clinician_alerts
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'medical_history'::public.care_access_category)
    or private.has_emergency_access(patient_id, 'medical_history')
  );

drop policy if exists escalations_select on public.escalations;
create policy escalations_select on public.escalations
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'medical_history'::public.care_access_category)
    or private.has_emergency_access(patient_id, 'medical_history')
  );

drop policy if exists medication_logs_select on public.medication_logs;
create policy medication_logs_select on public.medication_logs
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'medications'::public.care_access_category)
    or private.has_emergency_access(patient_id, 'medications')
  );

drop policy if exists patient_blood_profile_select on public.patient_blood_profile;
create policy patient_blood_profile_select on public.patient_blood_profile
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'medical_history'::public.care_access_category)
    or private.has_emergency_access(patient_id, 'medical_history')
  );

drop policy if exists patient_cardiovascular_profile_select on public.patient_cardiovascular_profile;
create policy patient_cardiovascular_profile_select on public.patient_cardiovascular_profile
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'medical_history'::public.care_access_category)
    or private.has_emergency_access(patient_id, 'medical_history')
  );

drop policy if exists patient_quarterly_reports_select on public.patient_quarterly_reports;
create policy patient_quarterly_reports_select on public.patient_quarterly_reports
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'medical_history'::public.care_access_category)
    or private.has_emergency_access(patient_id, 'medical_history')
  );

drop policy if exists patient_risk_scores_select on public.patient_risk_scores;
create policy patient_risk_scores_select on public.patient_risk_scores
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'medical_history'::public.care_access_category)
    or private.has_emergency_access(patient_id, 'medical_history')
  );

drop policy if exists patient_serology_status_select on public.patient_serology_status;
create policy patient_serology_status_select on public.patient_serology_status
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'medical_history'::public.care_access_category)
    or private.has_emergency_access(patient_id, 'medical_history')
  );

-- reproductive_health per CLAUDE.md's protected-category note: the guardian confidentiality
-- gate stays exactly as the live/last-migration definition has it — the can_read_clinical
-- grant is AND-ed with guardian_may_view_confidential_domain, not OR-ed alongside it, and
-- has_emergency_access deliberately excludes this category from break-glass (unchanged here).
drop policy if exists reproductive_health_profiles_select on public.reproductive_health_profiles;
create policy reproductive_health_profiles_select on public.reproductive_health_profiles
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.has_emergency_access(patient_id, 'reproductive_health')
    or (
      private.can_read_clinical(patient_id, 'reproductive_health'::public.care_access_category)
      and private.guardian_may_view_confidential_domain(
        reproductive_health_profiles.patient_id, (select auth.uid()), 'sexual_reproductive_health'
      )
    )
  );

drop policy if exists symptom_triage_assessments_select on public.symptom_triage_assessments;
create policy symptom_triage_assessments_select on public.symptom_triage_assessments
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'medical_history'::public.care_access_category)
    or private.has_emergency_access(patient_id, 'medical_history')
  );

drop policy if exists vaccination_records_select on public.vaccination_records;
create policy vaccination_records_select on public.vaccination_records
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(profile_id, 'vaccinations'::public.care_access_category)
    or private.has_emergency_access(profile_id, 'vaccinations')
  );

drop policy if exists vaccination_schedules_select on public.vaccination_schedules;
create policy vaccination_schedules_select on public.vaccination_schedules
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'vaccinations'::public.care_access_category)
    or private.has_emergency_access(patient_id, 'vaccinations')
  );

-- ---------------------------------------------------------------------------
-- Proof, not hope.
-- ---------------------------------------------------------------------------
do $$
declare
  v_tbl text;
  v_category text;
  v_ambiguity_raised boolean := false;
  v_fixed record;
begin
  -- 1. The premise still holds: exactly the 3 overloads this migration exists to
  --    disambiguate between. If this count ever changes, every assumption below needs
  --    re-checking, so fail loudly rather than silently no-op.
  if (select count(*) from pg_proc
      where proname = 'can_read_clinical' and pronamespace = 'private'::regnamespace) <> 3
  then
    raise exception 'FAIL: private.can_read_clinical no longer has exactly 3 overloads -- re-audit this migration''s premise';
  end if;

  -- 2. Prove the ambiguity this migration guards against is real, not a hypothetical --
  --    a bare-literal call raises 42725 (ambiguous function call) today, regardless of
  --    the specific literal value (type resolution, not value matching, is what's
  --    ambiguous -- 'medical_history' isn't even a valid caregiver_permission value, and
  --    it's still rejected). This is the sabotage-equivalent proof: if a future migration
  --    ever removes an overload and this stops raising, that's a real signal this
  --    migration's cast additions became unnecessary, not a broken test.
  begin
    perform private.can_read_clinical(gen_random_uuid(), 'medical_history');
    v_ambiguity_raised := false;
  exception when sqlstate '42725' then
    v_ambiguity_raised := true;
  end;
  if not v_ambiguity_raised then
    raise exception 'FAIL: bare-literal private.can_read_clinical(uuid, ''literal'') no longer raises 42725 -- the ambiguity this migration fixes may no longer exist, re-audit before trusting the casts below are still needed';
  end if;

  -- 3. Every policy this migration touched now carries an explicit cast on its
  --    can_read_clinical call, and none of them regressed to the bare pattern.
  for v_tbl, v_category in
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
    select * into v_fixed
    from pg_policies
    where schemaname = 'public' and policyname = v_tbl;

    if not found then
      raise exception 'FAIL: policy % is missing after this migration', v_tbl;
    end if;

    if v_fixed.qual !~ ('can_read_clinical\([^,]+,\s*''' || v_category || '''::care_access_category\)') then
      raise exception 'FAIL: % does not carry an explicit ::care_access_category cast on its can_read_clinical(...,''%'') call -- got: %',
        v_tbl, v_category, v_fixed.qual;
    end if;

    if v_fixed.qual ~ ('can_read_clinical\([^,]+,\s*''' || v_category || '''\)') then
      raise exception 'FAIL: % still matches the bare untyped-literal can_read_clinical pattern', v_tbl;
    end if;
  end loop;

  raise notice 'PASS: 16 can_read_clinical RLS policies now carry an explicit ::care_access_category cast; ambiguity precondition confirmed real; vitals_readings_select/screening_schedules_select left untouched';
end $$;
