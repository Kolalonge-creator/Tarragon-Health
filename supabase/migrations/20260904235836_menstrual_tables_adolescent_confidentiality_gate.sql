-- Tarragon Health — extend the adolescent confidentiality gate to
-- menstrual_cycles and menstrual_daily_logs.
--
-- THE DEFECT. Three tables hold a patient's sexual/reproductive-health
-- record. Only one of them enforces adolescent confidentiality. Read live
-- from pg_policies before writing this:
--
--   reproductive_health_profiles_select (correct, set by
--   20260902213714_fix_reproductive_health_profiles_rls_regression.sql):
--     patient_id = auth.uid()
--     or private.is_org_staff(organisation_id)
--     or private.has_emergency_access(patient_id, 'reproductive_health'::care_access_category)
--     or (private.can_read_clinical(patient_id, 'reproductive_health'::care_access_category)
--         and private.guardian_may_view_confidential_domain(
--               patient_id, auth.uid(), 'sexual_reproductive_health'))
--
--   menstrual_cycles_select / menstrual_daily_logs_select (set by
--   20260902215227_menstrual_cycles_gate_on_can_read_clinical.sql):
--     patient_id = auth.uid()
--     or private.is_org_staff(organisation_id)
--     or private.can_read_clinical(patient_id, 'reproductive_health'::care_access_category)
--     or private.has_emergency_access(patient_id, 'reproductive_health'::care_access_category)
--
-- So a guardian managing a 14-year-old's dependent account is correctly
-- refused her reproductive health profile and — through the very same
-- 'manage' + dependent-account path — reads her entire cycle history and
-- every daily log: flow, symptoms, moods, free-text notes, basal body
-- temperature, ovulation test results. That is not a lesser disclosure than
-- the profile row; for an adolescent it is the more revealing one.
--
-- The two tables are also, right now, LOOSER ON READ THAN ON WRITE. Their
-- INSERT/UPDATE/DELETE policies already demand permission_level='manage'
-- AND an explicit profile_access_categories row for 'reproductive_health';
-- SELECT accepts the dependent-account bypass inside can_read_clinical with
-- no compensating age check. A record you may read but not write is normal;
-- a record whose read gate is weaker than its write gate is a mistake.
--
-- WHY THE FIX IS THE GUARDIAN GATE AND NOT A BYPASS EXCLUSION. An earlier
-- design excluded 'reproductive_health' from can_read_clinical's
-- dependent-account bypass outright. That exclusion was deliberately removed
-- by 20260902231348_fix_can_read_clinical_dependent_bypass_drift.sql and
-- must not be reinstated here — CLAUDE.md still describes it as current and
-- is stale on this point. The live design is: the bypass stays general, and
-- each confidential-domain table layers
-- private.guardian_may_view_confidential_domain() on top. That function
-- returns true for everyone outside the 10-17 age bands, and inside them
-- only where the patient has granted an unrevoked
-- adolescent_confidentiality_waivers row for the domain. This migration
-- simply gives the two menstrual tables the same layer their sibling already
-- has, with the identical domain string ('sexual_reproductive_health') and
-- the identical argument shape.
--
-- WHAT IS DELIBERATELY LEFT ALONE, matching the sibling exactly:
--   * patient_id = auth.uid() — a patient always reads her own record,
--     adolescent or not. Gating self-access would be the opposite of
--     confidentiality.
--   * private.is_org_staff() — clinicians are the people an adolescent is
--     confiding IN. Unchanged.
--   * private.has_emergency_access(...) — left ungated for the same reason
--     the sibling leaves it ungated: that function already returns false
--     unconditionally for 'reproductive_health' (see its own body), so
--     wrapping it would add a check to a branch that never fires.
--   * INSERT/UPDATE/DELETE — untouched. They already require an explicit
--     category grant. Bringing guardian_may_edit_confidential_domain to them
--     is a separate, larger decision (it would stop a guardian correcting a
--     dependent's log at all) and is not this fix.

drop policy if exists menstrual_cycles_select on public.menstrual_cycles;
create policy menstrual_cycles_select on public.menstrual_cycles
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.has_emergency_access(patient_id, 'reproductive_health'::public.care_access_category)
    or (
      private.can_read_clinical(patient_id, 'reproductive_health'::public.care_access_category)
      and private.guardian_may_view_confidential_domain(
        menstrual_cycles.patient_id, (select auth.uid()), 'sexual_reproductive_health'
      )
    )
  );

drop policy if exists menstrual_daily_logs_select on public.menstrual_daily_logs;
create policy menstrual_daily_logs_select on public.menstrual_daily_logs
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.has_emergency_access(patient_id, 'reproductive_health'::public.care_access_category)
    or (
      private.can_read_clinical(patient_id, 'reproductive_health'::public.care_access_category)
      and private.guardian_may_view_confidential_domain(
        menstrual_daily_logs.patient_id, (select auth.uid()), 'sexual_reproductive_health'
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Self-assertions. All three reproductive-health tables must now agree.
-- ---------------------------------------------------------------------------
do $$
declare
  v_table text;
  v_policy text;
  v_def text;
begin
  foreach v_table in array array[
    'reproductive_health_profiles',
    'menstrual_cycles',
    'menstrual_daily_logs'
  ] loop
    v_policy := v_table || '_select';

    select qual into v_def
    from pg_policies
    where schemaname = 'public' and tablename = v_table and policyname = v_policy;

    if v_def is null then
      raise exception '% is missing after this migration', v_policy;
    end if;
    if v_def not like '%can_read_clinical(%' then
      raise exception '% must route caregiver reads through can_read_clinical, got: %', v_policy, v_def;
    end if;
    if v_def not like '%guardian_may_view_confidential_domain(%' then
      raise exception '% has no adolescent confidentiality gate — this is the defect being fixed, got: %', v_policy, v_def;
    end if;
    if v_def not like '%sexual_reproductive_health%' then
      raise exception '% gates on the wrong confidentiality domain, got: %', v_policy, v_def;
    end if;
    -- A patient must never be locked out of her own record by this change.
    if v_def not like '%patient_id = ( SELECT auth.uid()%' then
      raise exception '% no longer admits the patient herself, got: %', v_policy, v_def;
    end if;
    -- And staff must still reach it — this is a guardian gate, not a
    -- clinician one.
    if v_def not like '%is_org_staff(%' then
      raise exception '% no longer admits org staff, got: %', v_policy, v_def;
    end if;
  end loop;
end $$;

-- The write side must remain at least as strict as the read side: both
-- menstrual tables' writes already demand an explicit category grant, and
-- this migration must not have relaxed them.
do $$
declare
  v_table text;
  v_missing int;
begin
  foreach v_table in array array['menstrual_cycles', 'menstrual_daily_logs'] loop
    select count(*) into v_missing
    from pg_policies
    where schemaname = 'public' and tablename = v_table and cmd in ('INSERT', 'UPDATE', 'DELETE')
      and coalesce(qual, '') || coalesce(with_check, '') not like '%profile_access_categories%';

    if v_missing > 0 then
      raise exception '% has % write polic(ies) with no explicit reproductive_health category requirement', v_table, v_missing;
    end if;
  end loop;
end $$;
