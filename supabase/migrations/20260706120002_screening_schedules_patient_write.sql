-- Tarragon Health — screening recommendation engine (Sprint 3 Phase 3)
-- Widen screening_schedules write access to the owning patient
--
-- Same rationale as 20260706120001_prevention_risk_scores_patient_write.sql:
-- the recommendation engine runs inside submitRiskAssessment, a Server
-- Action that writes through the patient's own RLS-scoped session (no
-- service-role client in this app). The engine only ever tightens cadence
-- from the screen_types catalogue's own published values — it never lets a
-- patient set an arbitrary due_date — so self-write is safe here.

drop policy screening_schedules_insert on public.screening_schedules;
drop policy screening_schedules_update on public.screening_schedules;

create policy screening_schedules_insert on public.screening_schedules
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy screening_schedules_update on public.screening_schedules
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
