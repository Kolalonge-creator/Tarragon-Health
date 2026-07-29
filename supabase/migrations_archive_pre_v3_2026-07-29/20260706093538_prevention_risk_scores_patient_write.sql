-- Tarragon Health — widen prevention_risk_scores write access to the owning patient
--
-- Backfilled from the remote project's migration history (applied directly,
-- never checked in locally) so `supabase/migrations` matches what's actually
-- live. Superseded in practice: current code
-- (apps/web/.../patient/actions.ts submitRiskAssessment) writes this table
-- through the service-role client instead, so this widened policy is no
-- longer exercised by the app, but is left in place rather than silently
-- reverted without a decision to do so.

drop policy prevention_risk_scores_insert on public.prevention_risk_scores;
drop policy prevention_risk_scores_update on public.prevention_risk_scores;

create policy prevention_risk_scores_insert on public.prevention_risk_scores
  for insert to authenticated
  with check (profile_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy prevention_risk_scores_update on public.prevention_risk_scores
  for update to authenticated
  using (profile_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (profile_id = (select auth.uid()) or private.is_org_staff(organisation_id));
