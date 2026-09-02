-- Perf lint fix (auth_rls_initplan) on the 3 policies just added in
-- health_education_feedback: wrap auth.uid()/current_org_id() so Postgres evaluates them
-- once per query instead of once per row.
drop policy health_education_feedback_select on public.health_education_feedback;
create policy health_education_feedback_select on public.health_education_feedback
  for select to authenticated using (patient_id = (select auth.uid()) or private.is_admin());

drop policy health_education_feedback_insert on public.health_education_feedback;
create policy health_education_feedback_insert on public.health_education_feedback
  for insert to authenticated
  with check (patient_id = (select auth.uid()) and organisation_id = private.current_org_id());

drop policy health_education_feedback_update on public.health_education_feedback;
create policy health_education_feedback_update on public.health_education_feedback
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_admin())
  with check (patient_id = (select auth.uid()) or private.is_admin());
