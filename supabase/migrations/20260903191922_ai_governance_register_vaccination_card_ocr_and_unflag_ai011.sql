-- Two AI-governance corrections from the 2026-09-03 full-platform audit.
-- Applied live 2026-09-03 as version 20260903191922 (filename pinned to the live version).
--
-- 1) AI-012: the vaccination-card OCR (apps/web/src/lib/vaccination-cards/extract.ts,
--    shipped in PR #318) has been calling a vision model with NO registration, kill
--    switch, or audit trail -- the exact failure class docs/AI_GOVERNANCE_SPEC.md
--    exists to prevent. Register it now. Per the standing rule, it starts at
--    runtime_governed = false and earns the flag only once the call site that
--    consults public.ai_runtime_config() (decideAiGovernance, same pattern as
--    AI-005/AI-006) is merged and deployed -- that wiring ships in the same PR as
--    this migration file; a follow-up migration flips the flag after deploy.
--
-- 2) AI-011 (Nigerian meal plan generation, registered 20260903005600) was set
--    runtime_governed = true with no call site consulting ai_runtime_config in any
--    merged OR unmerged code (the nutrition branch's meal-plan-generate.ts calls
--    ChatAnthropic directly). A kill switch wired to nothing violates the registry's
--    own contract -- flip it false until a consulting call site actually ships.
--
-- Zero-row data impact beyond the registry tables themselves.

update public.ai_systems
   set runtime_governed = false
 where system_code = 'AI-011'
   and runtime_governed = true;

insert into public.ai_systems (
  system_code, name, purpose, owner_role, vendor_id, risk_class, autonomy_level,
  clinically_meaningful, lifecycle_status, is_enabled, fallback_behaviour,
  code_reference, review_interval_days, next_review_due,
  grandfathered_at, grandfather_note
)
select 'AI-012', 'Vaccination card OCR extraction',
       'Reads a photo or scan of a patient''s paper vaccination card and extracts the recorded doses into structured vaccination-history fields for the patient to confirm.',
       'Clinical Director',
       (select id from public.ai_vendors where name = 'Anthropic'),
       'moderate'::public.ai_risk_class,
       'assist'::public.ai_autonomy_level,
       true, 'live', true,
       'Extraction is recorded as failed and the card stays as an uploaded image for manual entry. Nothing downstream depends on the extraction succeeding.',
       'apps/web/src/lib/vaccination-cards/extract.ts', 365, current_date + 365,
       now(),
       'Found running unregistered in the 2026-09-03 full-platform audit (shipped 2026-08-29 in PR #318 without registration). Registered retroactively; validation, evaluation and bias assessment are outstanding and visible on the governance console.'
where not exists (select 1 from public.ai_systems where system_code = 'AI-012');

insert into public.ai_system_versions (
  ai_system_id, version, model_identifier, training_data_description,
  intended_population, excluded_population, validation_summary, change_summary
)
select s.id, 'v1', 'claude-sonnet-5',
       'General-purpose vision-capable foundation model, no Tarragon fine-tuning.',
       'Patients photographing their own paper vaccination cards (any issuing country) for import into their record.',
       'Any document that is not a vaccination card; the system transcribes recorded doses and never infers immunity or advises on scheduling.',
       'No formal validation has been carried out. This version row records what is running as at retroactive registration so that the gap is visible and dated, not so that it can be claimed as validated. Approval requires a passing run of every required evaluation suite (public.approve_ai_system_version).',
       'Retroactive registration of the already-running system.'
from public.ai_systems s
where s.system_code = 'AI-012'
  and not exists (
    select 1 from public.ai_system_versions x where x.ai_system_id = s.id and x.version = 'v1'
  );

insert into public.ai_guardrails (ai_system_id, rule_code, kind, description, enforcement, config)
select s.id, g.rule_code, g.kind::public.ai_guardrail_kind, g.description,
       g.enforcement::public.ai_guardrail_enforcement, g.config::jsonb
from public.ai_systems s
join (values
  ('transcribes_recorded_doses_only', 'prohibited_diagnosis',
   'Carries across what the card records. Never infers immunity status, never generates vaccination advice of its own.',
   'blocking', '{}'),
  ('confirm_before_entering_record', 'mandatory_human_review',
   'Extracted doses are reviewed and confirmed by the patient before they become part of the record.',
   'blocking', '{}'),
  ('max_autonomy', 'max_autonomy',
   'Performs part of the workflow; what enters the record stays with a person.',
   'blocking', '{"max_level":"assist"}')
) as g(rule_code, kind, description, enforcement, config) on true
where s.system_code = 'AI-012'
  and not exists (
    select 1 from public.ai_guardrails x where x.ai_system_id = s.id and x.rule_code = g.rule_code
  );

do $$
begin
  if (select runtime_governed from public.ai_systems where system_code = 'AI-011') then
    raise exception 'FAIL: AI-011 still claims runtime governance with no consulting call site';
  end if;
  if not exists (select 1 from public.ai_systems where system_code = 'AI-012' and is_enabled and not runtime_governed) then
    raise exception 'FAIL: AI-012 not registered as expected (enabled, not yet runtime-governed)';
  end if;
  if (select count(*) from public.ai_guardrails g join public.ai_systems s on s.id = g.ai_system_id
       where s.system_code = 'AI-012') <> 3 then
    raise exception 'FAIL: AI-012 guardrails not registered';
  end if;
  raise notice 'PASS: AI-012 registered (runtime_governed pending call-site deploy); AI-011 flag corrected';
end $$;
