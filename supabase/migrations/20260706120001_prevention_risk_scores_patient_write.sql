-- Tarragon Health — risk assessment questionnaire (Phase 2)
-- Widen prevention_risk_scores write access to the owning patient
--
-- Originally scoped org-staff-only (mirroring patient_risk_scores), on the
-- assumption a server-side rules engine would need elevated write access.
-- But no Server Action in this app uses a service-role client — every
-- existing write (e.g. logVital) happens through the patient's own
-- RLS-scoped session. This is a transparent, rule-based tier (not a
-- diagnosis), always recomputed server-side from stored responses, never
-- trusting a client-supplied tier value — so patient self-write is safe
-- here, matching the "patient owns their own row" pattern already used
-- everywhere else (vitals_readings, vaccination_records, etc.).

drop policy prevention_risk_scores_insert on public.prevention_risk_scores;
drop policy prevention_risk_scores_update on public.prevention_risk_scores;

create policy prevention_risk_scores_insert on public.prevention_risk_scores
  for insert to authenticated
  with check (profile_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy prevention_risk_scores_update on public.prevention_risk_scores
  for update to authenticated
  using (profile_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (profile_id = (select auth.uid()) or private.is_org_staff(organisation_id));
