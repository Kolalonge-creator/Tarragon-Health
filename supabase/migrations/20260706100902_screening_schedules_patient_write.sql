-- Tarragon Health — screening recommendation engine (Sprint 3 Phase 3)
-- Widen screening_schedules write access to the owning patient
--
-- Backfilled from the remote project's migration history (applied directly,
-- never checked in locally) so `supabase/migrations` matches what's actually
-- live. Same superseded-in-practice note as
-- 20260706093538_prevention_risk_scores_patient_write.sql: current code
-- writes this table through the service-role client instead.
--
-- Original rationale: the recommendation engine runs inside
-- submitRiskAssessment, a Server Action that writes through the patient's
-- own RLS-scoped session (no service-role client in this app, at the time
-- this was written). The engine only ever tightens cadence from the
-- screen_types catalogue's own published values — it never lets a patient
-- set an arbitrary due_date — so self-write was considered safe here.

drop policy screening_schedules_insert on public.screening_schedules;
drop policy screening_schedules_update on public.screening_schedules;

create policy screening_schedules_insert on public.screening_schedules
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy screening_schedules_update on public.screening_schedules
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
