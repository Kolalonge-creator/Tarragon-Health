-- Patients can already read their own care_plans (including
-- assigned_clinician_id), but profiles_select had no branch letting them
-- resolve that clinician's name — the embedded join in the care-plan display
-- silently returned null (RLS filters embedded resources, it doesn't error).
-- Scoped narrowly: a patient may see a clinician's profile only when that
-- clinician is assigned to one of the patient's own care plans, not the
-- broader org-staff visibility already granted to staff/admin.
drop policy profiles_select on public.profiles;

create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or private.is_admin()
    or (organisation_id is not null and private.is_org_staff(organisation_id))
    or exists (
      select 1 from public.care_plans cp
      where cp.assigned_clinician_id = profiles.id
        and cp.patient_id = (select auth.uid())
    )
  );
