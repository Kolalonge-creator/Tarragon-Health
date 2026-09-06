-- Healthy Ageing & Elderly Care (Module 50, PR #322) collided its migration
-- timestamps with ones already live under
-- 20260829121740/20260829121803/20260829121834 (see the corresponding
-- 20260829120000/20260829121500/20260829123000-suffixed filenames — this
-- project's recurring "hand-typed round-number version" failure mode, see
-- CLAUDE.md's standing lessons). Both versions of each file are otherwise
-- identical except one real delta: the live-applied versions let a
-- private.can_act_for() caregiver INSERT/UPDATE
-- ageing_assessments/ageing_assessment_domain_results/
-- falls_risk_assessments/social_determinant_screenings/home_care_requests on
-- a patient's behalf, but never granted them SELECT — so a caregiver's own
-- `INSERT ... RETURNING` fails (Postgres checks the new row against the
-- SELECT policy for RETURNING to succeed) and they can never read back what
-- they entered. Since the colliding version numbers already ran in
-- production, that content can't be replayed — this captures just the real
-- delta under a fresh version instead.

drop policy if exists ageing_assessments_select on public.ageing_assessments;
create policy ageing_assessments_select on public.ageing_assessments
  for select using (
    patient_id = (select auth.uid())
    or private.can_act_for(patient_id)
    or private.is_org_staff(organisation_id)
  );

drop policy if exists ageing_assessment_domain_results_select on public.ageing_assessment_domain_results;
create policy ageing_assessment_domain_results_select on public.ageing_assessment_domain_results
  for select using (
    exists (
      select 1 from public.ageing_assessments a
      where a.id = ageing_assessment_domain_results.assessment_id
        and (
          a.patient_id = (select auth.uid())
          or private.can_act_for(a.patient_id)
          or private.is_org_staff(a.organisation_id)
        )
    )
  );

drop policy if exists falls_risk_assessments_select on public.falls_risk_assessments;
create policy falls_risk_assessments_select on public.falls_risk_assessments
  for select using (
    patient_id = (select auth.uid())
    or private.can_act_for(patient_id)
    or private.is_org_staff(organisation_id)
  );

drop policy if exists social_determinant_screenings_select on public.social_determinant_screenings;
create policy social_determinant_screenings_select on public.social_determinant_screenings
  for select using (
    patient_id = (select auth.uid())
    or private.can_act_for(patient_id)
    or private.is_org_staff(organisation_id)
  );

drop policy if exists home_care_requests_select on public.home_care_requests;
create policy home_care_requests_select on public.home_care_requests
  for select using (
    patient_id = (select auth.uid())
    or private.can_act_for(patient_id)
    or private.is_org_staff(organisation_id)
  );

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ageing_assessments' and policyname = 'ageing_assessments_select'
      and qual not like '%can_act_for%'
  ) then
    raise exception 'ageing_assessments_select still does not let a caregiver read back what they entered';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'falls_risk_assessments' and policyname = 'falls_risk_assessments_select'
      and qual not like '%can_act_for%'
  ) then
    raise exception 'falls_risk_assessments_select still does not let a caregiver read back what they entered';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'social_determinant_screenings' and policyname = 'social_determinant_screenings_select'
      and qual not like '%can_act_for%'
  ) then
    raise exception 'social_determinant_screenings_select still does not let a caregiver read back what they entered';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'home_care_requests' and policyname = 'home_care_requests_select'
      and qual not like '%can_act_for%'
  ) then
    raise exception 'home_care_requests_select still does not let a caregiver read back what they entered';
  end if;
end $$;
