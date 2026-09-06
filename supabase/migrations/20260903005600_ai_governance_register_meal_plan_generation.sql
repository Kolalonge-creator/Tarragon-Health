-- Tarragon Health — AI Governance: register and wire the 7-day Nigerian
-- meal planner (spec 19.8) as AI-011.
--
-- generateMealPlan() (apps/web/src/lib/nutrition/meal-plan-generate.ts) has
-- called ChatAnthropic directly since PR #292 (2026-08-28) — a day before
-- 20260829111050 swept every other running AI call site into the registry.
-- It landed on a branch that merged after that sweep was drafted, so it was
-- never registered, never guardrailed on the record, and had no kill switch
-- or audit trail. This closes that gap the same way part 6 closed the
-- original ten: grandfathered, because it has genuinely been live and
-- answering patients since before this migration, not introduced by it.
--
-- Unlike part 6, this migration also wires the call site in the same
-- change (apps/web/src/app/(dashboard)/patient/nutrition-actions.ts's
-- generateMealPlanAction now wraps the call in runGovernedAi), so
-- runtime_governed is set true here rather than in a separate follow-up —
-- there is no window where is_enabled would be a switch nothing reads.

insert into public.ai_systems (
  system_code, name, purpose, owner_role, vendor_id, risk_class, autonomy_level,
  clinically_meaningful, lifecycle_status, is_enabled, runtime_governed,
  fallback_behaviour, code_reference, review_interval_days, next_review_due,
  grandfathered_at, grandfather_note
)
select
  'AI-011', 'Nigerian meal plan generation',
  'Drafts a 7-day Nigerian meal plan from a fixed food catalogue, tailored to the patient''s active chronic-disease conditions and stated budget/preferences.',
  'Clinical Director', v.vendor_id, 'moderate', 'recommend', false, 'live', true, true,
  'nutrition_meal_plans records ai_status = ''failed'' (kill switch / governance unreachable / model error) or the caller''s existing ''unavailable'' state (no API key configured), and the patient sees "Meal plan generation isn''t switched on yet." Meal logging, the food catalogue, and manual nutrition tracking are entirely unaffected — this system only ever drafts an optional plan.',
  'apps/web/src/lib/nutrition/meal-plan-generate.ts', 365, current_date + 365,
  now(),
  'Registered after being found running ungoverned in production — landed on a branch that merged the day after the original ten-system registration sweep (20260829111050) and was missed by it. Live and answering patients since before this migration; validation, evaluation and bias assessment are outstanding and visible on the governance console, same as the original grandfathered ten.'
from (select id as vendor_id from public.ai_vendors where name = 'Anthropic') v
where not exists (select 1 from public.ai_systems where system_code = 'AI-011');

-- ---------------------------------------------------------------------------
-- v1 version metadata (40.2), unapproved on purpose — same discipline as
-- every other grandfathered system: this records what is running, not a
-- claim that it has been validated.
-- ---------------------------------------------------------------------------

insert into public.ai_system_versions (
  ai_system_id, version, model_identifier, training_data_description,
  intended_population, excluded_population, validation_summary, change_summary
)
select s.id, 'v1', 'claude-sonnet-5',
  'General-purpose foundation model, no Tarragon fine-tuning. Grounded at call time in the patient''s active care-plan conditions, stated budget tier/preferences, and a fixed Nigerian food catalogue the model must choose every item from.',
  'Adults with an active hypertension or diabetes care plan, or no chronic condition, requesting a 7-day Nigerian meal plan in English.',
  'Patients with an active CKD care-plan condition are refused before the model is ever called (defence in depth: both the server action and generateMealPlan() itself check this) — CKD nutrition needs individual lab-based sodium/potassium/phosphorus balancing a generic generated plan cannot safely provide; those patients are routed to the dietitian-referral pathway instead.',
  'No formal validation has been carried out. This version row records what is running as at registration so the gap is visible and dated, not so that it can be claimed as validated. Approval requires a passing run of every required evaluation suite (public.approve_ai_system_version).',
  'Initial registration of the already-running system.'
from public.ai_systems s
where s.system_code = 'AI-011'
  and not exists (
    select 1 from public.ai_system_versions v where v.ai_system_id = s.id and v.version = 'v1'
  );

-- ---------------------------------------------------------------------------
-- Guardrails (40.5) — transcribed from the guard code that runs today
-- (buildSystemPrompt / validateMealPlan in meal-plan-generate.ts and
-- meal-plan-validate.ts)
-- ---------------------------------------------------------------------------

insert into public.ai_guardrails (ai_system_id, rule_code, kind, description, enforcement, config)
select s.id, g.rule_code, g.kind::public.ai_guardrail_kind, g.description,
       g.enforcement::public.ai_guardrail_enforcement, g.config::jsonb
from public.ai_systems s
join (values
  ('coaching_not_prescribed_diet', 'output_constraint',
   'Coaching guidance only — the system prompt states this explicitly and forbids phrasing anything as treatment or a medical instruction. Never a prescribed or clinical diet, never fed to patient_risk_scores or an escalation, never attributed to a doctor.',
   'blocking', '{"source":"apps/web/src/lib/nutrition/meal-plan-generate.ts"}'),
  ('ckd_refused_before_model_call', 'population_restriction',
   'A patient with an active CKD care-plan condition is refused before any model call, in both the server action and generateMealPlan() itself. CKD nutrition needs individual lab-based balancing this generator cannot safely provide.',
   'blocking', '{"excluded":["ckd"]}'),
  ('food_code_hallucination_guard', 'output_constraint',
   'Every item the model proposes is re-validated against the real food catalogue server-side (meal-plan-validate.ts); a food_code that does not exist in the catalogue is dropped from the plan, never trusted, and surfaced via droppedItems rather than silently thinned out. The model''s own gram/nutrition arithmetic is likewise never trusted — recomputed from the catalogue.',
   'blocking', '{"source":"apps/web/src/lib/nutrition/meal-plan-validate.ts"}'),
  ('max_autonomy', 'max_autonomy',
   'Drafts an optional plan the patient may accept, adjust, regenerate, or ignore. It never enforces anything and is never itself a clinical action.',
   'blocking', '{"max_level":"recommend"}')
) as g(rule_code, kind, description, enforcement, config)
  on true
where s.system_code = 'AI-011'
on conflict (ai_system_id, rule_code) do nothing;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_id     uuid;
  v_rep    jsonb;
  v_count  int;
begin
  select id into v_id from public.ai_systems where system_code = 'AI-011';
  if v_id is null then
    raise exception 'AI-011 was not registered';
  end if;

  if not (select is_enabled from public.ai_systems where id = v_id) then
    raise exception 'AI-011 was registered disabled — it is grandfathered as already-running';
  end if;

  if not (select runtime_governed from public.ai_systems where id = v_id) then
    raise exception 'AI-011 was not marked runtime-governed, but this migration wires its call site';
  end if;

  select count(*) into v_count from public.ai_guardrails where ai_system_id = v_id and is_active;
  if v_count <> 4 then
    raise exception 'expected 4 active guardrails for AI-011, found %', v_count;
  end if;

  if exists (select 1 from public.ai_system_versions where ai_system_id = v_id and approved_at is not null) then
    raise exception 'AI-011''s version was seeded as approved — no evaluation has been run';
  end if;

  if not (public.ai_runtime_config('AI-011')->>'runtime_governed')::boolean then
    raise exception 'AI-011 was marked runtime-governed but ai_runtime_config does not say so';
  end if;

  -- Mirrors the system-codes.ts fail-closed mirror check in
  -- packages/db/tests/ai_governance.sql case 8: AI-011 is moderate risk, so
  -- fail-open (as declared for mealPlanGeneration) is within the rule.
  if (select risk_class from public.ai_systems where id = v_id) in ('high', 'very_high') then
    raise exception 'AI-011 risk_class drifted to high/very_high — system-codes.ts declares it fail-open, which the rule only permits below that';
  end if;

  select private.ai_acceptance_criteria(v_id) into v_rep;
  if (v_rep->'criteria'->>'validation')::boolean then
    raise exception 'AI-011 reports validation satisfied with no approved version';
  end if;
  if not (v_rep->'criteria'->>'guardrails')::boolean then
    raise exception 'AI-011 reports no guardrails after they were seeded';
  end if;
  if not (v_rep->'criteria'->>'monitoring')::boolean then
    raise exception 'AI-011 reports no monitoring after review date and the baseline suite (applies to every system, ai_system_id is null) exist';
  end if;
  if not (v_rep->>'grandfathered')::boolean then
    raise exception 'AI-011 is not marked grandfathered';
  end if;
end;
$$;
