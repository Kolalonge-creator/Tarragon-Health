-- Tarragon Health — Symptom Assessment & Triage Engine, part 1: governed
-- protocol config (platform brief §37).
--
-- Same "config, not code" discipline as escalation_slas / alert_rules: the
-- red-flag screen thresholds and dynamic-questionnaire branching for each
-- presenting complaint are clinical judgment calls, not engineering, so
-- they live in a versioned, Clinical-Director-signed jsonb ledger rather
-- than hardcoded application logic. The pure interpreter that walks this
-- config lives in @tarragon/symptom-triage-engine (packages/) — see that
-- package's src/protocols/index.ts for the TypeScript-shaped source of the
-- seed below (kept in sync by hand; the two must describe the same graph).
--
-- §37.5 is explicit: "the exact rules must be clinically approved." The v1
-- seed below is a faithful transcription of widely-taught general-practice
-- red-flag criteria for three presenting complaints (headache, chest pain,
-- breathlessness) — the SAME class of criteria already live elsewhere in
-- this codebase (symptoms' low-threshold red-flag list, condition_protocols'
-- WHO-sourced hypertension escalation criteria). It is seeded UNSIGNED and
-- INACTIVE (is_active = false) — unlike escalation_slas v1, nothing in this
-- platform depends on a triage protocol existing yet, so this feature stays
-- fail-closed (disabled, not "trust an unreviewed clinical ruleset") until a
-- Clinical Director actually signs a version via sign_triage_protocols().
-- See docs/SYMPTOM_TRIAGE_ENGINE_SPEC.md for the full scope note and the
-- go-live checklist.

create type public.triage_category as enum ('emergency', 'urgent', 'routine', 'self_management');

create type public.triage_entry_point as enum (
  'patient_app', 'ai_assistant', 'clinician', 'nurse', 'caregiver', 'monitoring_system'
);

comment on type public.triage_category is
  'Symptom Assessment & Triage Engine (§37.5) output — a routing decision, never a diagnosis. Ordered emergency > urgent > routine > self_management.';
comment on type public.triage_entry_point is
  'Who/what reported the symptom that started a triage assessment (§37.2). Only patient_app has a built-in UI today (see docs/SYMPTOM_TRIAGE_ENGINE_SPEC.md) — the other values exist so the schema does not need to change when a later entry point is wired up.';

create table public.triage_protocols (
  id            uuid primary key default gen_random_uuid(),
  version       integer not null,
  config        jsonb not null,
  notes         text,
  approved_by   uuid references public.clinical_staff (id),
  approved_at   timestamptz,
  is_active     boolean not null default false,
  created_at    timestamptz not null default now(),
  constraint triage_protocols_unique_version unique (version)
);

alter table public.triage_protocols enable row level security;

create policy triage_protocols_select on public.triage_protocols
  for select
  to authenticated
  using (true);

-- Mirrors escalation_slas_insert / alert_rules_insert exactly: any admin may
-- propose a new inactive, unsigned draft version; only sign_triage_protocols()
-- (Clinical-Director-gated) may activate/sign one.
create policy triage_protocols_insert on public.triage_protocols
  for insert
  to authenticated
  with check (
    private.is_admin()
    and approved_by is null
    and approved_at is null
    and is_active = false
  );

grant select, insert on public.triage_protocols to authenticated;

-- ---------------------------------------------------------------------------
-- Lookup helper — the single place the app layer reads the active protocol
-- config from. Returns null rather than raising when no protocol is signed
-- yet — the caller (apps/web/src/lib/symptom-triage) treats a null as "the
-- symptom checker is not available", which is the correct fail-closed
-- behaviour for an unreviewed clinical ruleset (contrast
-- private.escalation_sla_minutes, which fails loud because an SLA gap on an
-- ALREADY-firing alert is worse than a blocked insert — here, nothing has
-- fired yet, so blocking the whole feature is the safe default).
-- ---------------------------------------------------------------------------
create or replace function private.active_triage_protocol_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select config from public.triage_protocols where is_active limit 1;
$$;

revoke all on function private.active_triage_protocol_config() from public;

-- ---------------------------------------------------------------------------
-- Sign / attest RPC — mirrors sign_escalation_slas() / sign_alert_rules()
-- exactly: active Clinical Director only, one active version at a time,
-- audit-logged.
-- ---------------------------------------------------------------------------
create or replace function public.sign_triage_protocols(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
begin
  if not exists (select 1 from public.triage_protocols where id = p_id) then
    raise exception 'Triage protocol config version not found';
  end if;

  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.active
    and cs.is_clinical_director
  limit 1;

  if v_staff is null then
    raise exception 'not authorised: only an active Clinical Director can sign the triage protocol config';
  end if;

  update public.triage_protocols set is_active = false
    where is_active and id <> p_id;

  update public.triage_protocols
    set approved_by = v_staff, approved_at = now(), is_active = true
    where id = p_id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  select cs.organisation_id, (select auth.uid()), 'triage_protocols.signed',
         'triage_protocols', p_id,
         jsonb_build_object('signed_by_clinical_staff', v_staff)
  from public.clinical_staff cs where cs.id = v_staff;

  return p_id;
end;
$$;

comment on function public.sign_triage_protocols(uuid) is
  'Clinical-Director-only sign step for a triage_protocols draft version, mirroring public.sign_escalation_slas()/public.sign_alert_rules(). Retires any other active version, stamps approved_by/approved_at from the caller''s own clinical_staff record (never client-supplied), audit-logs the signature.';

revoke all on function public.sign_triage_protocols(uuid) from public, anon;
grant execute on function public.sign_triage_protocols(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Seed v1 — DRAFT, UNSIGNED, INACTIVE. Transcribed from
-- packages/symptom-triage-engine/src/protocols/index.ts (SEED_TRIAGE_PROTOCOL_CONFIG).
-- Three presenting-complaint pathways: headache, chest_pain, breathlessness.
-- A Clinical Director must review and call sign_triage_protocols() before
-- this reaches a real patient — see docs/SYMPTOM_TRIAGE_ENGINE_SPEC.md.
-- ---------------------------------------------------------------------------
insert into public.triage_protocols (version, config, notes, is_active)
values (
  1,
  '{
    "version": 1,
    "pathways": [
      {
        "key": "headache",
        "label": "Headache",
        "knownAssociatedSymptoms": ["fever", "neck_stiffness", "visual_disturbance", "vision_loss", "weakness_or_numbness", "confusion", "nausea_vomiting"],
        "knownTriggers": ["head_injury_recent", "straining_coughing_or_sex"],
        "knownHistory": ["pregnant", "hiv_or_immunocompromised", "cancer_history", "anticoagulant_use"],
        "redFlagScreen": [
          {"key": "headache.thunderclap_onset", "label": "Sudden, severe (thunderclap) headache", "category": "emergency", "rule": {"onset": "sudden", "minSeverity": 8}},
          {"key": "headache.neuro_deficit", "label": "Headache with new weakness, numbness or confusion", "category": "emergency", "rule": {"anyAssociatedSymptom": ["weakness_or_numbness", "confusion"]}},
          {"key": "headache.meningitic_signs", "label": "Headache with fever and neck stiffness", "category": "emergency", "rule": {"allAssociatedSymptoms": ["neck_stiffness", "fever"]}},
          {"key": "headache.vision_loss", "label": "Headache with loss of vision", "category": "emergency", "rule": {"anyAssociatedSymptom": ["vision_loss"]}},
          {"key": "headache.recent_head_injury", "label": "Headache after a recent head injury", "category": "emergency", "rule": {"anyTrigger": ["head_injury_recent"], "minSeverity": 6}},
          {"key": "headache.immunocompromised_new_severe", "label": "New severe headache in an immunocompromised or cancer patient", "category": "urgent", "rule": {"anyHistory": ["hiv_or_immunocompromised", "cancer_history"], "minSeverity": 6}},
          {"key": "headache.pregnancy_severe", "label": "Severe headache in pregnancy", "category": "urgent", "rule": {"anyHistory": ["pregnant"], "minSeverity": 6}}
        ],
        "startNodeKey": "duration_check",
        "nodes": {
          "duration_check": {"type": "question", "kind": "boolean", "key": "duration_check", "prompt": "Has this headache lasted more than 3 days, or is it a pattern you''ve never had before?", "onYes": "worsening_check", "onNo": "frequency_check"},
          "worsening_check": {"type": "question", "kind": "boolean", "key": "worsening_check", "prompt": "Is it getting worse day by day, or waking you up from sleep?", "onYes": "outcome_urgent_worsening", "onNo": "frequency_check"},
          "frequency_check": {"type": "question", "kind": "boolean", "key": "frequency_check", "prompt": "Do you get headaches like this often - more than 10 days a month?", "onYes": "outcome_routine_frequent", "onNo": "severity_check"},
          "severity_check": {"type": "question", "kind": "choice", "key": "severity_check", "prompt": "How would you describe the pain right now?", "options": [
            {"value": "mild", "label": "Mild - I can carry on as normal", "next": "outcome_self_mild"},
            {"value": "moderate", "label": "Moderate - it''s slowing me down", "next": "outcome_routine_moderate"},
            {"value": "severe", "label": "Severe - it''s hard to do anything", "next": "outcome_urgent_severe"}
          ]},
          "outcome_urgent_worsening": {"type": "outcome", "key": "outcome_urgent_worsening", "category": "urgent", "safetyNetMessageKey": "headache.urgent_worsening", "clinicianReviewRequired": false, "rationale": "Progressive pattern or waking from sleep - needs prompt clinical assessment to rule out a secondary cause."},
          "outcome_routine_frequent": {"type": "outcome", "key": "outcome_routine_frequent", "category": "routine", "safetyNetMessageKey": "headache.routine_frequent", "clinicianReviewRequired": false, "rationale": "Frequent headache pattern - suitable for a routine review and a management plan."},
          "outcome_self_mild": {"type": "outcome", "key": "outcome_self_mild", "category": "self_management", "safetyNetMessageKey": "headache.self_mild", "clinicianReviewRequired": false, "rationale": "Mild, non-red-flag headache - self-care and monitoring appropriate."},
          "outcome_routine_moderate": {"type": "outcome", "key": "outcome_routine_moderate", "category": "routine", "safetyNetMessageKey": "headache.routine_moderate", "clinicianReviewRequired": false, "rationale": "Moderate, non-red-flag headache affecting daily activity - suitable for a routine appointment."},
          "outcome_urgent_severe": {"type": "outcome", "key": "outcome_urgent_severe", "category": "urgent", "safetyNetMessageKey": "headache.urgent_severe", "clinicianReviewRequired": true, "rationale": "Severe pain without a clear non-urgent explanation from the questions asked - routed to prompt review."}
        },
        "fallbackOutcome": {"type": "outcome", "key": "fallback", "category": "urgent", "safetyNetMessageKey": "generic.fallback_review", "clinicianReviewRequired": true, "rationale": "Triage graph reached an unexpected state - routed to human review as a safety default."}
      },
      {
        "key": "chest_pain",
        "label": "Chest pain",
        "knownAssociatedSymptoms": ["breathlessness", "sweating", "arm_or_jaw_pain", "nausea_vomiting", "fainting"],
        "knownTriggers": ["recent_injury"],
        "knownHistory": ["known_heart_disease", "diabetes", "hypertension"],
        "redFlagScreen": [
          {"key": "chest_pain.cardiac_pattern", "label": "Chest pain with breathlessness, sweating, or arm/jaw pain", "category": "emergency", "rule": {"anyAssociatedSymptom": ["breathlessness", "sweating", "arm_or_jaw_pain"], "minSeverity": 6}},
          {"key": "chest_pain.sudden_severe_tearing", "label": "Sudden, severe chest pain", "category": "emergency", "rule": {"onset": "sudden", "minSeverity": 8}},
          {"key": "chest_pain.syncope", "label": "Chest pain with fainting", "category": "emergency", "rule": {"anyAssociatedSymptom": ["fainting"]}},
          {"key": "chest_pain.known_cardiac_history", "label": "Chest pain in a patient with known heart disease", "category": "emergency", "rule": {"anyHistory": ["known_heart_disease"], "minSeverity": 5}}
        ],
        "startNodeKey": "reproducible_check",
        "nodes": {
          "reproducible_check": {"type": "question", "kind": "boolean", "key": "reproducible_check", "prompt": "Does the pain get worse when you press on your chest, or when you move or breathe deeply?", "onYes": "msk_duration_check", "onNo": "exertion_check"},
          "exertion_check": {"type": "question", "kind": "boolean", "key": "exertion_check", "prompt": "Does the pain come on with exercise or exertion, and ease with rest?", "onYes": "outcome_urgent_exertional", "onNo": "duration_check"},
          "msk_duration_check": {"type": "question", "kind": "boolean", "key": "msk_duration_check", "prompt": "Has this been going on for more than a day without getting worse?", "onYes": "outcome_self_msk", "onNo": "outcome_routine_msk"},
          "duration_check": {"type": "question", "kind": "choice", "key": "duration_check", "prompt": "How long has the pain lasted?", "options": [
            {"value": "under_1_hour", "label": "Less than an hour", "next": "outcome_urgent_new"},
            {"value": "longer", "label": "A few hours or longer", "next": "outcome_routine_general"}
          ]},
          "outcome_urgent_exertional": {"type": "outcome", "key": "outcome_urgent_exertional", "category": "urgent", "safetyNetMessageKey": "chest_pain.urgent_exertional", "clinicianReviewRequired": false, "rationale": "Exertional chest pain pattern - needs prompt cardiac assessment."},
          "outcome_self_msk": {"type": "outcome", "key": "outcome_self_msk", "category": "self_management", "safetyNetMessageKey": "chest_pain.self_msk", "clinicianReviewRequired": false, "rationale": "Reproducible, stable, non-red-flag chest wall pain - self-care appropriate."},
          "outcome_routine_msk": {"type": "outcome", "key": "outcome_routine_msk", "category": "routine", "safetyNetMessageKey": "chest_pain.routine_msk", "clinicianReviewRequired": false, "rationale": "Reproducible chest wall pain, new or changing - suitable for a routine appointment."},
          "outcome_urgent_new": {"type": "outcome", "key": "outcome_urgent_new", "category": "urgent", "safetyNetMessageKey": "chest_pain.urgent_new", "clinicianReviewRequired": true, "rationale": "New, non-exertional, non-reproducible chest pain under an hour old - genuinely ambiguous, routed to review."},
          "outcome_routine_general": {"type": "outcome", "key": "outcome_routine_general", "category": "routine", "safetyNetMessageKey": "chest_pain.routine_general", "clinicianReviewRequired": false, "rationale": "Non-red-flag chest pain lasting several hours or more - suitable for a routine appointment."}
        },
        "fallbackOutcome": {"type": "outcome", "key": "fallback", "category": "urgent", "safetyNetMessageKey": "generic.fallback_review", "clinicianReviewRequired": true, "rationale": "Triage graph reached an unexpected state - routed to human review as a safety default."}
      },
      {
        "key": "breathlessness",
        "label": "Breathlessness",
        "knownAssociatedSymptoms": ["chest_pain", "cannot_complete_sentences", "leg_swelling_one_sided", "wheeze"],
        "knownTriggers": [],
        "knownHistory": ["asthma", "copd", "heart_failure"],
        "redFlagScreen": [
          {"key": "breathlessness.severe_sudden", "label": "Sudden, severe breathlessness at rest", "category": "emergency", "rule": {"onset": "sudden", "minSeverity": 8}},
          {"key": "breathlessness.spo2_low", "label": "Low oxygen saturation", "category": "emergency", "rule": {"measurementBelow": {"key": "spo2_pct", "value": 92}}},
          {"key": "breathlessness.chest_pain", "label": "Breathlessness with chest pain", "category": "emergency", "rule": {"anyAssociatedSymptom": ["chest_pain"]}},
          {"key": "breathlessness.cannot_complete_sentences", "label": "Too breathless to complete a sentence", "category": "emergency", "rule": {"anyAssociatedSymptom": ["cannot_complete_sentences"]}},
          {"key": "breathlessness.unilateral_leg_swelling", "label": "Breathlessness with one-sided leg swelling", "category": "urgent", "rule": {"anyAssociatedSymptom": ["leg_swelling_one_sided"]}}
        ],
        "startNodeKey": "exertion_only",
        "nodes": {
          "exertion_only": {"type": "question", "kind": "boolean", "key": "exertion_only", "prompt": "Does the breathlessness only happen with exercise or exertion, easing quickly with rest?", "onYes": "outcome_routine_exertional", "onNo": "worsening_over_days"},
          "worsening_over_days": {"type": "question", "kind": "boolean", "key": "worsening_over_days", "prompt": "Has it been steadily getting worse over the past few days?", "onYes": "outcome_urgent_worsening", "onNo": "outcome_self_mild"},
          "outcome_routine_exertional": {"type": "outcome", "key": "outcome_routine_exertional", "category": "routine", "safetyNetMessageKey": "breathlessness.routine_exertional", "clinicianReviewRequired": false, "rationale": "Breathlessness limited to exertion, easing with rest - suitable for a routine appointment."},
          "outcome_urgent_worsening": {"type": "outcome", "key": "outcome_urgent_worsening", "category": "urgent", "safetyNetMessageKey": "breathlessness.urgent_worsening", "clinicianReviewRequired": false, "rationale": "Progressively worsening breathlessness over days - needs prompt clinical assessment."},
          "outcome_self_mild": {"type": "outcome", "key": "outcome_self_mild", "category": "self_management", "safetyNetMessageKey": "breathlessness.self_mild", "clinicianReviewRequired": false, "rationale": "Mild, stable, non-red-flag breathlessness - self-care and monitoring appropriate."}
        },
        "fallbackOutcome": {"type": "outcome", "key": "fallback", "category": "urgent", "safetyNetMessageKey": "generic.fallback_review", "clinicianReviewRequired": true, "rationale": "Triage graph reached an unexpected state - routed to human review as a safety default."}
      }
    ]
  }'::jsonb,
  'v1 - draft, unsigned. Transcribed from packages/symptom-triage-engine/src/protocols/index.ts (widely-taught general-practice red-flag criteria for headache/chest pain/breathlessness). Flagging for Clinical Director review before go-live: see docs/SYMPTOM_TRIAGE_ENGINE_SPEC.md for the full scope note, including which presenting complaints are NOT yet covered.',
  false
);

do $$
begin
  if (select count(*) from public.triage_protocols where version = 1) <> 1 then
    raise exception 'FAIL: expected exactly one v1 triage_protocols row';
  end if;
  if (select is_active from public.triage_protocols where version = 1) then
    raise exception 'FAIL: v1 triage_protocols must seed inactive (unsigned)';
  end if;
  if private.active_triage_protocol_config() is not null then
    raise exception 'FAIL: active_triage_protocol_config() must return null until a version is signed';
  end if;
  raise notice 'PASS: triage_protocols v1 seeded as an unsigned, inactive draft';
end $$;
