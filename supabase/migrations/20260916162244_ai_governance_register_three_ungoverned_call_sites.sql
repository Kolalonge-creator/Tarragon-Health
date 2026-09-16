-- Tarragon Health — AI Governance: register the three AI call sites that
-- were running with no registry entry at all.
--
-- CLAUDE.md's rule is explicit: "Never add an AI call site that is not
-- registered in ai_systems and routed through runGovernedAi(). An
-- unregistered call site has no kill switch, no audit trail and no guardrail
-- record." Three did exactly that, found by diffing every file that imports
-- a model SDK against the twelve registered systems on 2026-09-16:
--
--   apps/web/src/lib/appointment-prep/generate.ts        -> AI-013
--   apps/web/src/lib/care-messages/generate-draft-reply.ts -> AI-014
--   apps/web/src/lib/service-navigation/generate.ts      -> AI-015
--
-- All three call ChatAnthropic directly. None appears in ai_systems, in
-- system-codes.ts, or in a single ai_interaction_log row. Two of them
-- (AI-013, AI-014) read real patient data and put generated text in front of
-- a patient or a Care Coordinator. Switching them off was impossible; there
-- was nothing to switch.
--
-- Same shape as 20260903005600 (AI-011) and 20260903191922 (AI-012): each is
-- grandfathered, because it has genuinely been live and answering before this
-- migration rather than being introduced by it, and each is wired through
-- runGovernedAi in the same change, so runtime_governed is true here and
-- there is no window in which is_enabled is a switch nothing reads.
--
-- No version row is approved and no evaluation run is seeded. Both would be a
-- human's judgement, and inventing one is precisely the failure Module 40
-- exists to prevent.

-- ---------------------------------------------------------------------------
-- AI-013 — appointment prep suggestions
-- ---------------------------------------------------------------------------

insert into public.ai_systems (
  system_code, name, purpose, owner_role, vendor_id, risk_class, autonomy_level,
  clinically_meaningful, lifecycle_status, is_enabled, runtime_governed,
  fallback_behaviour, code_reference, review_interval_days, next_review_due,
  grandfathered_at, grandfather_note
)
select
  'AI-013', 'Appointment preparation suggestions',
  'Suggests 3-6 short questions, in the patient''s own voice, that they might want to raise at an upcoming video visit — drawn from a minimized snapshot of why the visit was booked and their known care-plan conditions.',
  'Clinical Director', v.vendor_id, 'moderate', 'inform_only', true, 'live', true, true,
  'appointment_prep_suggestions records status = ''failed'' with the reason, and the waiting-room card shows "We couldn''t put together suggestions for this visit" — the patient joins the visit exactly as they would have anyway. The suggestions are a convenience before a consultation that happens regardless; nothing downstream reads them.',
  'apps/web/src/lib/appointment-prep/generate.ts', 365, current_date + 365,
  now(),
  'Registered after being found running entirely ungoverned in production — no ai_systems row, no kill switch, no audit trail, no guardrail record. Live and generating for patients since before this migration; validation, evaluation and bias assessment are outstanding and visible on the governance console.'
from (select id as vendor_id from public.ai_vendors where name = 'Anthropic') v
where not exists (select 1 from public.ai_systems where system_code = 'AI-013');

-- ---------------------------------------------------------------------------
-- AI-014 — Care Coordinator draft reply
-- ---------------------------------------------------------------------------

insert into public.ai_systems (
  system_code, name, purpose, owner_role, vendor_id, risk_class, autonomy_level,
  clinically_meaningful, lifecycle_status, is_enabled, runtime_governed,
  fallback_behaviour, code_reference, review_interval_days, next_review_due,
  grandfathered_at, grandfather_note
)
select
  'AI-014', 'Care Coordinator draft reply',
  'Drafts a non-clinical reply for a Care Coordinator to read, edit and decide whether to send in an in-app care-message thread, and flags a thread that needs a clinician instead.',
  'Clinical Director', v.vendor_id, 'high', 'assist', true, 'live', true, true,
  'care_message_draft_replies records status = ''failed'' with the reason and the "Draft reply" control reports that no draft could be produced. The Care Coordinator writes the reply themselves, which is the pre-existing path and the only one that existed before this system — no message is ever sent without a human composing or approving it.',
  'apps/web/src/lib/care-messages/generate-draft-reply.ts', 180, current_date + 180,
  now(),
  'Registered after being found running entirely ungoverned in production — no ai_systems row, no kill switch, no audit trail, no guardrail record. Classified high risk despite never sending anything itself: it drafts text a non-clinical staff member may send to a patient, and its clinical-escalation flag is the only thing standing between a clinical question and a Care Coordinator answering it. Live since before this migration; validation and evaluation are outstanding.'
from (select id as vendor_id from public.ai_vendors where name = 'Anthropic') v
where not exists (select 1 from public.ai_systems where system_code = 'AI-014');

-- ---------------------------------------------------------------------------
-- AI-015 — service navigation assistant
-- ---------------------------------------------------------------------------

insert into public.ai_systems (
  system_code, name, purpose, owner_role, vendor_id, risk_class, autonomy_level,
  clinically_meaningful, lifecycle_status, is_enabled, runtime_governed,
  fallback_behaviour, code_reference, review_interval_days, next_review_due,
  grandfathered_at, grandfather_note
)
select
  'AI-015', 'Service navigation assistant',
  'Turns a patient''s free-text question about where to get a health service into directory search filters, then phrases an answer strictly over the real facility rows that search returned.',
  'Clinical Director', v.vendor_id, 'low', 'inform_only', false, 'live', true, true,
  'answerServiceNavigationQuestion returns { status: "failed" } and the card invites the patient to browse the facility directory directly, which is the same data by the same filters without the natural-language layer. Nothing clinical depends on it.',
  'apps/web/src/lib/service-navigation/generate.ts', 365, current_date + 365,
  now(),
  'Registered after being found running entirely ungoverned in production — no ai_systems row, no kill switch, no audit trail, no guardrail record. Low risk and not clinically meaningful: it is a directory lookup phrased in sentences, explicitly forbidden from offering a clinical opinion about which facility is better.'
from (select id as vendor_id from public.ai_vendors where name = 'Anthropic') v
where not exists (select 1 from public.ai_systems where system_code = 'AI-015');

-- ---------------------------------------------------------------------------
-- v1 version metadata (40.2), unapproved on purpose — these record what is
-- running, not a claim that it has been validated.
--
-- model_identifier is claude-haiku-4-5 for all three: that is the literal
-- MODEL_ID constant in each of the three files, not the platform default.
-- ---------------------------------------------------------------------------

insert into public.ai_system_versions (
  ai_system_id, version, model_identifier, training_data_description,
  intended_population, excluded_population, validation_summary, change_summary
)
select s.id, 'v1', 'claude-haiku-4-5', d.training_data, d.intended, d.excluded,
  'No formal validation has been carried out. This version row records what is running as at registration so the gap is visible and dated, not so that it can be claimed as validated. Approval requires a passing run of every required evaluation suite (public.approve_ai_system_version).',
  'Initial registration of an already-running, previously unregistered system.'
from public.ai_systems s
join (values
  ('AI-013',
   'General-purpose foundation model, no Tarragon fine-tuning. Grounded at call time in a minimized snapshot of the booking reason and the patient''s care-plan conditions — never the full chart.',
   'Adults with an upcoming video consultation on the platform.',
   'Not offered where no video consultation is booked. The snapshot deliberately excludes the full record, so anything not in it cannot be reasoned about.'),
  ('AI-014',
   'General-purpose foundation model, no Tarragon fine-tuning. Grounded at call time in a minimized transcript of the recent messages in one care-message thread — never the patient''s chart or clinical notes.',
   'Care Coordinators replying in an in-app care-message thread.',
   'Never drafts a substantive reply to a clinical question, a new or worsening symptom, or a result/medication query — those return a holding reply with needsClinicalReview set, for a clinician to pick up.'),
  ('AI-015',
   'General-purpose foundation model, no Tarragon fine-tuning. Grounded at call time in the real facility rows a directory search returned — no patient data is sent at all.',
   'Any signed-in patient asking where to find a service.',
   'Not a clinical recommender: explicitly forbidden from saying which facility is clinically better.')
) as d(system_code, training_data, intended, excluded)
  on d.system_code = s.system_code
where s.system_code in ('AI-013', 'AI-014', 'AI-015')
  and not exists (
    select 1 from public.ai_system_versions v where v.ai_system_id = s.id and v.version = 'v1'
  );

-- ---------------------------------------------------------------------------
-- Guardrails (40.5) — transcribed from the system prompts and guard code
-- that actually run today in each of the three files, not aspirational.
-- ---------------------------------------------------------------------------

insert into public.ai_guardrails (ai_system_id, rule_code, kind, description, enforcement, config)
select s.id, g.rule_code, g.kind::public.ai_guardrail_kind, g.description,
       g.enforcement::public.ai_guardrail_enforcement, g.config::jsonb
from public.ai_systems s
join (values
  -- AI-013
  ('AI-013', 'no_diagnosis', 'prohibited_diagnosis',
   'The system prompt forbids diagnosing: output is questions for the patient to ask their care team, never answers.',
   'blocking', '{"source":"apps/web/src/lib/appointment-prep/generate.ts"}'),
  ('AI-013', 'no_treatment_or_dose_suggestion', 'prohibited_prescribing',
   'Forbidden from suggesting a medication, a dose or a specific treatment.',
   'blocking', '{"source":"apps/web/src/lib/appointment-prep/generate.ts"}'),
  ('AI-013', 'grounded_in_minimized_snapshot_only', 'output_constraint',
   'Only the booking reason and care-plan conditions are sent (buildAppointmentPrepSnapshot), never the full chart, and the prompt forbids stating any fact, trend or number that is not in that snapshot.',
   'blocking', '{"source":"apps/web/src/lib/appointment-prep/snapshot.ts"}'),
  ('AI-013', 'max_autonomy', 'max_autonomy',
   'Shows optional prompts before a consultation that happens regardless. Nothing downstream reads them and no clinical action follows from them.',
   'blocking', '{"max_level":"inform_only"}'),
  -- AI-014
  ('AI-014', 'no_diagnosis_or_result_interpretation', 'prohibited_diagnosis',
   'A Care Coordinator is non-clinical. The prompt forbids diagnosing and forbids interpreting a lab or vitals result or telling the patient what a reading or symptom means.',
   'blocking', '{"source":"apps/web/src/lib/care-messages/generate-draft-reply.ts"}'),
  ('AI-014', 'no_medication_discussion', 'prohibited_prescribing',
   'Forbidden from suggesting, discussing or changing a medication, dose or treatment.',
   'blocking', '{"source":"apps/web/src/lib/care-messages/generate-draft-reply.ts"}'),
  ('AI-014', 'clinical_question_holds_for_clinician', 'emergency_escalation',
   'A new or worsening symptom, a clinical question, or a result/medication query must produce only a short holding reply plus needsClinicalReview = true with a reason — never a substantive answer.',
   'escalate', '{"source":"apps/web/src/lib/care-messages/generate-draft-reply.ts"}'),
  ('AI-014', 'never_sent_automatically', 'mandatory_human_review',
   'The draft is persisted for a human to read, edit and decide on. No path sends it automatically, and it must never claim to be from a doctor.',
   'blocking', '{"source":"apps/web/src/lib/care-messages/actions.ts"}'),
  ('AI-014', 'max_autonomy', 'max_autonomy',
   'Drafts text a human then edits and sends. It never sends, never writes to the clinical record, and is never itself a clinical action.',
   'blocking', '{"max_level":"assist"}'),
  -- AI-015
  ('AI-015', 'real_facilities_only', 'output_constraint',
   'May only mention facilities from the rows the directory search returned, using their exact name and address; inventing a facility, address, phone number or price is forbidden, and an empty result must be reported plainly rather than filled in. Only the patient''s own typed question and those public rows reach the model — no record data is sent.',
   'blocking', '{"source":"apps/web/src/lib/service-navigation/generate.ts"}'),
  ('AI-015', 'no_clinical_recommendation', 'prohibited_diagnosis',
   'A directory lookup, not medical advice: forbidden from saying which facility is clinically better.',
   'blocking', '{"source":"apps/web/src/lib/service-navigation/generate.ts"}'),
  ('AI-015', 'max_autonomy', 'max_autonomy',
   'Describes what is in the directory. Takes no action and books nothing.',
   'blocking', '{"max_level":"inform_only"}')
) as g(system_code, rule_code, kind, description, enforcement, config)
  on g.system_code = s.system_code
where s.system_code in ('AI-013', 'AI-014', 'AI-015')
on conflict (ai_system_id, rule_code) do nothing;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  r        record;
  v_count  int;
  v_expect int;
begin
  for r in select * from (values ('AI-013', 4), ('AI-014', 5), ('AI-015', 3)) as t(code, guardrails) loop
    if not exists (select 1 from public.ai_systems where system_code = r.code) then
      raise exception '% was not registered', r.code;
    end if;

    if not (select is_enabled from public.ai_systems where system_code = r.code) then
      raise exception '% was registered disabled — it is grandfathered as already-running', r.code;
    end if;

    if not (select runtime_governed from public.ai_systems where system_code = r.code) then
      raise exception '% was not marked runtime-governed, but this migration wires its call site', r.code;
    end if;

    select count(*) into v_count
      from public.ai_guardrails g
      join public.ai_systems s on s.id = g.ai_system_id
      where s.system_code = r.code and g.is_active;
    v_expect := r.guardrails;
    if v_count <> v_expect then
      raise exception 'expected % active guardrails for %, found %', v_expect, r.code, v_count;
    end if;

    if exists (
      select 1 from public.ai_system_versions v
      join public.ai_systems s on s.id = v.ai_system_id
      where s.system_code = r.code and v.approved_at is not null
    ) then
      raise exception '%''s version was seeded as approved — no evaluation has been run', r.code;
    end if;

    if not (public.ai_runtime_config(r.code)->>'runtime_governed')::boolean then
      raise exception '% was marked runtime-governed but ai_runtime_config does not say so', r.code;
    end if;

    if not (public.ai_runtime_config(r.code)->>'registered')::boolean then
      raise exception '% is not visible to ai_runtime_config', r.code;
    end if;
  end loop;

  -- The check that would have caught the original gap: no file in the app may
  -- reach a model from a code_reference that is not in this table. That can't
  -- be asserted from SQL, so assert the next best thing — that the count of
  -- registered systems matches what system-codes.ts now mirrors.
  select count(*) into v_count from public.ai_systems;
  if v_count <> 15 then
    raise exception 'expected 15 registered AI systems after this migration, found % — AI_SYSTEMS in apps/web/src/lib/ai-governance/system-codes.ts must mirror this exactly', v_count;
  end if;
end;
$$;
