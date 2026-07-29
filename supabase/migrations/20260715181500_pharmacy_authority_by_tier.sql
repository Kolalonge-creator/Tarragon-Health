-- Tarragon Health
-- Pharmacy-authority-by-tier enforcement — docs/Tarragon_Health_Master_Operating_Plan_v4.md
-- §4/§8: Tier 1 confirms/continues existing stable prescriptions under
-- protocol but has no new-prescribing or dose-adjustment authority; Tier 2+
-- (and Tier 4/5, and the org's Clinical Director, per the Responsibility
-- Matrix's "Prescribe (new/change)" row) initiate new medications and
-- adjust doses. DB-enforced (RLS), not just app-layer — this is a
-- regulated clinical action, the same class of structural gate as
-- enforce_clinical_staff_indemnity/clinical_staff_no_self_verification,
-- not a logistics-only restriction like Care Coordinator write access
-- (which CLAUDE.md keeps app-layer only, since it isn't itself a
-- prescribing act).
--
-- Only the org-staff branch of medications' insert/update policies is
-- tightened. A patient's own self-added medications (source='patient',
-- patient_id = auth.uid()) are untouched — self-management was never a
-- prescribing act and isn't gated by clinical tier.
--
-- MDCN/regulatory confirmation of this tier authority split is a founder
-- open item (master plan §16) — this enforces the documented model, it
-- does not claim regulator sign-off.

create or replace function private.has_prescribing_authority(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = org
      and active
      and (
        is_clinical_director
        or doctor_tier in ('tier_2', 'tier_3', 'tier_4_senior_registrar', 'tier_5_partner_specialist')
      )
  );
$$;

drop policy if exists medications_insert on public.medications;
create policy medications_insert on public.medications
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    or (private.is_org_staff(organisation_id) and private.has_prescribing_authority(organisation_id))
  );

drop policy if exists medications_update on public.medications;
create policy medications_update on public.medications
  for update to authenticated
  using (
    patient_id = (select auth.uid())
    or (private.is_org_staff(organisation_id) and private.has_prescribing_authority(organisation_id))
  )
  with check (
    patient_id = (select auth.uid())
    or (private.is_org_staff(organisation_id) and private.has_prescribing_authority(organisation_id))
  );
