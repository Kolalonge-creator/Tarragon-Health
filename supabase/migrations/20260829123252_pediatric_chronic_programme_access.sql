-- Tarragon Health — a parent can see their child's chronic-programme
-- enrolment (Child Health Platform §48.13 gap-close)
--
-- Confirmed gap: chronic_programme_enrolments (20260716223642) predates the
-- can_read_clinical helper (20260731185243) and was never given the same
-- read-access branch as screening_results/escalations/clinician_alerts — a
-- parent with a 'manage' grant on a child dependent (e.g. a child enrolled in
-- the dormant paediatric asthma programme, once activated) could not see the
-- enrolment at all. Read-only: enrolment itself stays staff-initiated
-- (chronic_programme_enrolments_insert is untouched) — a parent requesting a
-- child's enrolment is a conversation with the care team, not a self-service
-- action, matching how chronic enrolment already works for every patient.

drop policy if exists chronic_enrolments_select on public.chronic_programme_enrolments;
create policy chronic_enrolments_select on public.chronic_programme_enrolments
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'chronic_programme_enrolments'
      and policyname = 'chronic_enrolments_select'
      and qual::text like '%can_read_clinical%'
  ) then
    raise exception 'a parent/guardian must be able to read a child''s chronic-programme enrolment';
  end if;
end $$;
