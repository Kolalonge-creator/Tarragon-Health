# Symptom Assessment & Triage Engine

Implements the platform brief's §37 ("SYMPTOM ASSESSMENT & TRIAGE ENGINE"). This is a scope note and
go-live checklist, not a duplicate of the spec — read the original brief for the full requirements
(§37.1–§37.12); this file records what was built, the concrete design decisions made to satisfy it,
and what is deliberately deferred.

## What this is (and isn't)

Per §37.1: this module answers **"what should happen next?"**, never **"what diagnosis does this
person have?"** — it is a triage/routing engine, not a diagnostic one. Every output is one of four
fixed categories (`emergency` / `urgent` / `routine` / `self_management`), and every patient-facing
message is a plain next-step sentence, never a probable-condition statement (§37.8). This mirrors
the platform's existing safety-net copy discipline (`private.raise_dangerous_reading_ai_suggestion`,
the AI Coach's `keyword-guardrail.ts`) and the Lifestyle Programme Engine's own red-flag evaluator.

## Where it lives

- **Pure engine** (`packages/symptom-triage-engine/`) — condition/pathway-agnostic interpreter.
  Red-flag screening (`engine/index.ts#screenRedFlags`) runs before any question is asked, exactly
  matching §37.4's flow diagram; the dynamic questionnaire walk
  (`engine/index.ts#nextTriageStep`/`runTriage`) derives the current question from the answers given
  so far rather than trusting client-held position state. Zero DB access, zero I/O — fully unit
  tested (`engine/engine.test.ts`, `protocols/config-schema.test.ts`), 16 tests.
- **Governed protocol config** (`triage_protocols` table,
  `supabase/migrations/20260829091247_symptom_triage_protocols_config.sql`) — the red-flag
  thresholds and question-tree branching are DATA, not code, versioned and Clinical-Director-signed
  exactly like `escalation_slas`/`alert_rules`. §37.5 says explicitly: "the exact rules must be
  clinically approved" — this table, `public.sign_triage_protocols()`, and the admin page at
  `/admin/settings/triage-protocols` are how that happens.
- **Assessment record** (`symptom_triage_assessments` table,
  `supabase/migrations/20260829093804_symptom_triage_assessments.sql`) — one row per completed
  assessment, storing everything §37.10 asks for: symptoms reported (`initial_capture`), questions
  asked and answered (`questions_asked`), pathway used (`presenting_complaint_key`), category,
  timestamp, model/rule version (`protocol_version`, FK'd to `triage_protocols.version`), escalation
  links (`emergency_event_id`/`clinician_alert_id`/`clinician_review_alert_id`), and an outcome
  field. Classification is always recomputed server-side from the signed config — the table has no
  INSERT grant to `authenticated` at all (same discipline as `mental_health_screens`), so a client
  can never post a spoofed category.
- **Escalation wiring** (`private.handle_symptom_triage_assessment()`, same migration) — reuses the
  platform's EXISTING escalation machinery rather than building a parallel one: `emergency` routes
  through `emergency_events` (a new `symptom_triage` source value), `urgent` inserts directly into
  `clinician_alerts` gated by the same `vitals_red_flag_doctor_escalation` plan check every other
  patient-logged-symptom pathway uses (CLAUDE.md's Free-tier carve-out applies here too), and
  `clinician_review_required` (§37.9 — uncertain classification needs a human look) raises a
  separate `clinician_review` alert when the category itself didn't already put a human in front of
  it. Verified end-to-end against the live database (see `packages/db/tests/symptom_triage_assessment_engine.sql`).
- **Safety monitoring** (`triage_safety_monitoring` view,
  `supabase/migrations/20260829100237_symptom_triage_safety_monitoring.sql`) — §37.11's
  automatically-computable metrics (emergency escalation rate, clinician override rate). The three
  metrics that are inherently a clinical judgement call on one specific case — missed red flags,
  false reassurance, inappropriate escalation — can't be inferred automatically; they're recorded as
  reviewing-clinician flags on the assessment row (`clinician_flagged_*` columns) and simply
  aggregated by this view, not computed.
- **Patient-facing UI** (`apps/web/src/app/(dashboard)/patient/symptom-triage-check.tsx`) — a small
  wizard mounted in the Vitals & symptoms section, next to the existing symptom log. Picks a
  presenting complaint, captures the structured initial symptom (§37.3), then walks the dynamic
  question tree one question at a time, ending on a plain "safest next step" message
  (`apps/web/src/lib/symptom-triage/safety-net-copy.ts`) — never a diagnosis.

## Scope decisions (read before extending)

- **Three presenting-complaint pathways seeded, not a full library.** Headache (the brief's own
  §37.7 worked example), chest pain, and breathlessness. These are a faithful transcription of
  widely-taught general-practice red-flag criteria — the same class of criteria already reflected
  elsewhere in this codebase (`symptoms`' low-threshold red-flag list, `condition_protocols`'
  WHO-sourced hypertension escalation criteria) — but they are **not clinically signed content
  invented to look authoritative**. `triage_protocols` v1 is seeded `is_active = false` specifically
  so nothing reaches a real patient until a Clinical Director reviews and signs it. Adding a fourth
  pathway is a content change to that governed config (a new migration inserting a new draft
  version), not an engineering change to the interpreter.
- **Entry points**: §37.2 lists patient app, AI assistant, clinician, nurse, caregiver, monitoring
  system. The `triage_entry_point` enum and `symptom_triage_assessments.entry_point`/
  `logged_by_profile_id` columns model all six, but only the **patient app** entry point has a built
  UI today (matches CLAUDE.md's app/web-first mandate). A caregiver acting on a patient's account via
  the existing `resolveSubjectId`/acting-for grant already works end to end (the same mechanism
  `logSymptom` uses) — the other four (AI assistant, clinician, nurse, monitoring system) are schema-
  ready but need their own UI/integration work, deliberately not built without an explicit ask (same
  guardrail discipline as the Clinical Tier Ladder's Phase 2/3 items in `CLAUDE.md`).
- **No AI/LLM layer.** §37.9's "AI triage -> uncertain -> human clinical review" is implemented as a
  **deterministic** escape hatch: when the governed config's question graph reaches an outcome node
  marked `clinicianReviewRequired: true` (an authored judgement call, not a model's), or when a
  red-flag rule's predicate is malformed and fails to evaluate, the assessment is flagged for human
  review. There is no Claude/LangGraph call anywhere in this pipeline — consistent with §37.1's "not
  a standalone diagnostic engine" framing and with keeping this module's risk surface to what a
  deterministic rule engine can be tested and reasoned about. A future AI-assist layer (in the style
  of `case-briefs/generate.ts`) could sit on top of this later, but wasn't built without an explicit
  ask.
- **`escalation_slas`'s `symptom_triage` pathway entries are also an unsigned draft**
  (`supabase/migrations/20260829092518_symptom_triage_escalation_sla_draft.sql`). The `urgent`
  category's `clinician_alerts` insert depends on it; `private.escalation_sla_minutes` fails loud
  (raises) rather than guessing if it's queried before being signed — which can't happen in
  practice today since `triage_protocols` being unsigned already keeps the whole feature off.

## Go-live checklist

1. A Clinical Director reviews the three seeded pathways (headache/chest_pain/breathlessness) at
   `/admin/settings/triage-protocols` and signs a version.
2. A Clinical Director also reviews and signs the `symptom_triage` pathway entries at
   `/admin/settings/escalation-slas` (needed for the `urgent` category's alert SLA to resolve).
3. Confirm `packages/db/tests/symptom_triage_assessment_engine.sql` still passes against the live
   project before/after any further protocol changes.
