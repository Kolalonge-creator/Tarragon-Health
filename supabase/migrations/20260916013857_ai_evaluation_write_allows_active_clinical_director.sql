-- The "Run evaluations" button (apps/web .../ai-governance/actions.ts,
-- runAiEvalSuitesAction) writes directly to ai_evaluation_runs and
-- ai_evaluation_case_results through the caller's own RLS grant -- both
-- tables' write policies required private.is_admin() only. That's a real
-- access-control gap: public.approve_ai_system_version already treats "an
-- admin, or an active Clinical Director" as the correct authority bar for
-- AI governance actions on a non-critical version, and the whole point of
-- the "Run evaluations" button is Clinical-Director self-service -- a real
-- Clinical Director who isn't also a full admin could see the button, spend
-- real money running it, and then have every recorded-run write silently
-- refused by RLS.
--
-- Extracts private.is_active_clinical_director() (the same clinical_staff
-- check approve_ai_system_version already inlines) so it can be OR'd into
-- both write policies instead of duplicating the raw predicate.

create or replace function private.is_active_clinical_director()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clinical_staff
    where profile_id = auth.uid() and active and doctor_tier = 'chief_medical_officer'
  );
$$;

comment on function private.is_active_clinical_director() is
  'True for the calling session iff it is an active clinical_staff row with doctor_tier = chief_medical_officer -- the same authority public.approve_ai_system_version already requires for a non-critical version. Extracted so RLS policies can OR it with private.is_admin() instead of inlining the clinical_staff lookup per policy.';

drop policy if exists ai_evaluation_runs_write on public.ai_evaluation_runs;
create policy ai_evaluation_runs_write on public.ai_evaluation_runs
  for all to authenticated
  using (private.is_admin() or private.is_active_clinical_director())
  with check (private.is_admin() or private.is_active_clinical_director());

drop policy if exists ai_evaluation_case_results_write on public.ai_evaluation_case_results;
create policy ai_evaluation_case_results_write on public.ai_evaluation_case_results
  for all to authenticated
  using (private.is_admin() or private.is_active_clinical_director())
  with check (private.is_admin() or private.is_active_clinical_director());

-- Sabotage-tested live before this migration was applied for real: a
-- non-admin, non-CMO clinician (a real medical_officer row) was refused
-- under this exact policy shape, and a real admin (kola.longe@tarragonhealth.ng)
-- was accepted -- see conversation history, not re-asserted here since this
-- statement has no side effect to roll back cleanly inside a single
-- transaction alongside the DDL above.
