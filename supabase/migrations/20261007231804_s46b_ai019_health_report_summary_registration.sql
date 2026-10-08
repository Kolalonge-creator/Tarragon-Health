-- S46b: register AI-019 healthReportSummaryDraft in ai_systems (3.15). Registered DISABLED.
-- AI-018 is taken on the S43 branch (document capture), so this session uses AI-019.
-- The model drafts one short paragraph ("your year in one paragraph") from facts the report already holds. The draft lives only on an unsigned
-- health_reports row (ai_draft), is never shown to the patient, and is wiped when a clinician signs (INV-11). Fallback is the deterministic
-- template paragraph, which costs nothing and is what the report uses today.
insert into public.ai_systems (
  system_code, name, purpose, owner_role, risk_class, autonomy_level, clinically_meaningful,
  lifecycle_status, is_enabled, runtime_governed, fallback_behaviour, code_reference
) values (
  'AI-019',
  'Health Report Summary Draft',
  'Drafts the one-paragraph summary of a yearly Health Report for a clinician to edit and sign. The draft is saved only on an unsigned draft row, '
  || 'never shown to the patient and wiped on signature (INV-11). It never sees HIV, hepatitis or other sensitive results (INV-04) and never states a diagnosis.',
  'Clinical Director',
  'moderate',
  'assist',
  true,
  'draft',
  false,
  false,
  'The deterministic template paragraph built from the same facts (no AI), which the clinician can still edit before signing.',
  'apps/web/src/lib/health-report/ai-summary.ts'
) on conflict (system_code) do nothing;

do $$
begin
  if not exists (select 1 from public.ai_systems where system_code = 'AI-019' and is_enabled = false) then
    raise exception 'S46b self-check: AI-019 must be registered and disabled';
  end if;
end $$;
