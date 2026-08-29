# AI Health Assistant — Architecture & Gap Analysis (§36)

> **Status: design/reconciliation doc. Nothing here is built by this document.** An incoming
> "Clinical Intelligence Layer" spec (§36, *AI Health Assistant*, reproduced section-by-section in
> §5 below) was handed in. This reconciles it against what the codebase actually contains today —
> which is considerably more than a blank slate — and proposes a phased path that respects
> `CLAUDE.md`'s standing guardrails.
>
> Subordinate to `CLAUDE.md`, which stays authoritative wherever the two conflict. In particular
> this doc does **not** authorise §36.10's "initiate the referral workflow" behaviour (see §3), and
> does not itself constitute the explicit ask that `CLAUDE.md` requires for guardrailed work.
>
> Written against the tree at branch `claude/ai-health-assistant-arch-a186k2`. Every "what exists"
> claim in §2 was read out of the source, not taken from `docs/CLAUDE_SPRINT_HISTORY_ARCHIVE.md` —
> per that archive's own warning, it records decisions, not current facts.
>
> **2026-08-29 — Phases A–D below are now shipped, same branch.** Built, in order: (A) an
> `ai_assistant_turns` audit table mirroring `case_briefs`' provenance columns, wired into every
> `runCoachTurn()` exit path including the two short-circuits, plus a narrowed `ai_conversations`
> staff-read policy (blanket `is_org_staff()` read → only conversations that actually raised a
> `clinician_alerts`/`escalations` row); (B) `loadPatientContext()` widened from 2 of §36.3's 11
> items to all 11, a second retrieval source (`health_education_content`, embedded and queried the
> same way `lpe_content_blocks` already was, still inert pending a `VOYAGE_API_KEY` and reviewed
> content — see §8, item 3), and retrieved source ids now recorded per turn; (C) six read-only record
> tools (`tools.ts` — vitals, medications, allergies, appointments, conditions, recent labs) bound
> into a bounded tool-calling loop ahead of the existing classify+reply call, plus three
> deterministic (no-LLM) composed surfaces — "explain my record", "what do I need this month",
> "prepare for my appointment" — reachable from the chat UI as quick-action buttons; (D) an
> AI-Coach-raised emergency now opens a real `care_messages` thread (linked via
> `care_message_threads.escalation_id`) so a clinician's reply reaches the patient in-app, closing
> §36.14's "conversation continues" half — **the `clinician_review` tier is deliberately NOT linked**,
> since `logAiCoachReviewFlag` creates no `escalations` row to hang a thread off (see §7 Phase D).
> The sections below are the original, unedited analysis this work was built from; §5's status table
> and §9's acceptance table have been updated in place to reflect what shipped, everything else is
> left as written.
>
> **Same session, later — 36.7 and 36.10 also closed, on an explicit founder ask that overrode both
> standing guardrails.** (1) §36.7 medication information: a `getMedicationInformation` tool plus a
> 14-drug starter library (migration `20260829112000`, reusing `health_education_content`'s existing
> `'medicines'` category rather than new schema) — purpose/mechanism only, no dose language, and
> every row ships `clinician_reviewed = false` per this codebase's standing draft-library discipline,
> so nothing reaches a patient until an actual clinician reviews it. (2) §36.10 referral navigation: a
> `requestSpecialistReferral` tool (`lib/ai-coach/referral-tool.ts`) — but NOT a direct
> `specialist_referrals` insert, which this session judged out of scope even under the explicit ask,
> because that table is repeatedly documented elsewhere in this codebase as staff/trigger-created only
> and load-bearing for a real safety gate (the protocol-scope-referral check). The tool instead opens
> a `clinician_alerts` request (new `type_code='referral_requested'`, migration `20260829113000`) a
> clinician reviews before creating any real referral through the existing path. See §3 for the full
> reasoning on why the direct-write line held even under an explicit ask, and `CLAUDE.md`'s Clinical
> Tier Ladder guardrail bullet, updated in place with a pointer to this decision.

## 0. What this document is

§36 describes a patient-facing AI assistant across eighteen sub-sections: context awareness, record
explanation, result explanation, medication explanation, care-plan explanation, appointment prep,
navigation, emergency safety, symptom capture, uncertainty, human handoff, an approved knowledge
base, retrieval-augmented generation, audit logging, and acceptance criteria.

Read cold, that reads like a greenfield build. It isn't. **Tarragon already ships a patient-facing
LangGraph + Claude assistant** (`apps/web/src/lib/ai-coach/`, the "AI Health Coach"), already ships
two *other* production AI surfaces with better provenance discipline than the chat has, and already
has an approved-content library with pgvector retrieval wired into the chat turn. Roughly half of
§36 is present in some form.

So the useful work here is not "design an assistant." It is:

1. Establish honestly which §36 sections are **shipped**, **partial**, **absent**, or **guardrailed**.
2. Name the *structural* gaps — the ones that are not "add a feature" but "the current shape can't
   express this at all" (§4). There are three, and they are the whole story.
3. Sequence the work by the spec's own governance principle: the closer a function gets to a
   clinical decision, the heavier the oversight (§1).

## 1. The governance ladder is the organising principle

The spec's preamble is the most important paragraph in it, and it should drive the build order, not
just the review process:

> 1. Information and education
> 2. Risk stratification
> 3. Clinical decision support
> 4. Clinical action
>
> The closer a function gets to making or executing a clinical decision, the stronger the governance,
> validation, clinician oversight and audit requirements must become.

Mapping §36's sub-sections onto those four levels sorts them almost perfectly by risk — and, usefully,
almost perfectly by how much of each is already built:

| Level | §36 sections | Character | Guardrail weight |
|---|---|---|---|
| **1 — Information & education** | 36.4 (record questions), 36.5 (record explanation), 36.6 (result explanation), 36.7 (medication explanation), 36.8 (care-plan explanation), 36.9 (appointment prep) | Reads the record, explains it back. Adds no new clinical claim. | Retrieval provenance + "documented fact vs AI interpretation" labelling |
| **2 — Risk stratification** | 36.11 (emergency), 36.12 (symptom capture), 36.13 (uncertainty) | Classifies a message's urgency. | Deterministic floor that works when the model doesn't; fail-cautious on error |
| **3 — Clinical decision support** | 36.14 (human handoff), 36.17 (audit) | Puts something in front of a clinician, with provenance. | Full audit record; SLA; never silently dropped |
| **4 — Clinical action** | 36.10 (navigation → initiating a referral) | Creates a real workflow object. | **Guardrailed — needs an explicit founder ask (§3)** |

This ladder matters because it cuts against the intuitive build order. The tempting first move is to
make the chat *smarter* (Level 1 breadth). The correct first move is to fix the **Level 3 audit gap**
(§4.3), because the assistant already escalates to clinicians today with almost no provenance record —
the highest-consequence thing it does is the least evidenced thing it does.

## 2. What already exists (audited, not assumed)

### 2.1 The assistant itself — `apps/web/src/lib/ai-coach/`

A real, shipped, plan-gated LangGraph turn. ~820 lines across nine modules. The graph
(`graph.ts`, `buildCoachGraph`):

```
START -> keywordGuardrail -+-> (emergency) --------> escalate -> END
                            \-> llmTurn -+-> (emergency) -> escalate -> END
                                          +-> (clinician_review) -> logReview -> END
                                          +-> (routine) -----------------------> END
```

Compare that against §36.2's required pipeline — it is a genuine subset, missing the retrieval and
post-response safety stages:

| §36.2 stage | Status |
|---|---|
| Identity / context | **Partial** — `loadPatientContext()`, but only 2 of §36.3's 11 items (§4.2) |
| Safety classification | **Shipped** — and better than asked: deterministic *and* model-based |
| Retrieve approved information | **Partial** — one library of three, and currently inert (§2.4) |
| Patient record context | **Partial** — same gap as "identity / context" |
| AI response | Shipped |
| Safety check (post-response) | **Absent** — classification happens pre-response only (§5, 36.2) |
| Response | Shipped |
| Audit | **Largely absent** — the central gap (§4.3) |

What is genuinely good here and should not be rebuilt:

- **`keyword-guardrail.ts` runs before any model call.** Eight regex families (chest pain, breathing
  difficulty, suicidal ideation, severe bleeding, stroke signs, loss of consciousness, seizure,
  overdose). This is exactly §36.11's "do not continue the normal chatbot workflow", and because it
  is deterministic it still fires when Claude is slow, wrong, or unreachable. This is the single
  strongest piece of the existing design.
- **Fail-cautious degradation.** `llmTurn`'s catch block returns `clinician_review`, never `routine`
  (`graph.ts`). A model outage biases toward a clinician looking, not toward silence. That is §36.13's
  "this needs to be reviewed by a clinician" already implemented as a system property rather than a
  prompt hope.
- **The emergency sentence is never model-phrased.** `EMERGENCY_SAFETY_REPLY` in `prompts.ts` is
  appended verbatim; the model's own wording is additive, never substitutive. Correct instinct — that
  is the one sentence that must not drift.
- **Escalation is real, not a log line.** `escalate.ts` writes `clinician_alerts` (4-hour
  `sla_due_at`, `category='clinical'`, `type_code='symptom_escalation'`), an `escalations` row, and an
  `emergency_events` row with `source='ai_coach'` — which reuses the same acknowledge-gated patient
  emergency pathway a danger-symptom checklist raises. A `clinician_review` tier writes a lighter
  `clinician_alerts` row at a 72-hour SLA plus `audit_log`. The commentary in `escalate.ts` records
  that `clinician_review` used to be `audit_log`-only and that this was fixed precisely because
  "nobody's dashboard reads audit_log" — that lesson should not be re-learned.

### 2.2 Access control and cost control — already admin-configurable

- `has_ai_coach_access()` (`20260707071318_ai_coach_access_rules.sql`, RPC exposed
  `20260707072157`, hardened `20260707072321`/`20260707072420`): admins always pass; then a per-patient
  admin rule; then a global "everyone" admin rule; then the subscription plan's `ai_coach` feature
  flag. Security-definer, because the backing table is admin-only.
- `get_ai_coach_daily_limit()` (`20260707074210_ai_coach_daily_limits.sql`): per-patient override →
  most generous active plan cap → org default → `AI_COACH_DAILY_MESSAGE_LIMIT` (20).
- `20260810025721_bundle_ai_coach_with_lifestyle_coaching.sql` bundles the entitlement with lifestyle
  coaching.
- Checked twice — in the UI gate and again inside `runCoachTurn()` — deliberately, because
  `runCoachTurn` is documented as transport-agnostic and a future non-UI caller would otherwise skip it.

Both checks short-circuit *before* the Claude call and append a canned reply rather than throwing.

### 2.3 Where the patient meets it

Two mount points, both plan-gated, both a bare text box with no structured entry points:

- `apps/web/src/app/(dashboard)/patient/(sections)/care/page.tsx:69`
- `apps/web/src/app/(dashboard)/patient/lifestyle/lifestyle-client.tsx:189`

Server action `ai-coach-actions.ts` (Zod-validated), React Query in `lib/queries/ai-coach.ts`, admin
console at `admin/settings/ai-coach/`.

### 2.4 Retrieval — real, but one library out of three, and currently inert

`findRelevantLifestyleContent()` (`lib/lifestyle/find-relevant-content.ts`) → the
`match_lpe_content_blocks` pgvector RPC (`20260810034407`), over `lpe_content_blocks`
(`20260719120001_lpe_foundation.sql`). Non-admin reads are RLS-gated to `clinician_reviewed` rows
(`20260810034122`) and the RPC re-applies that filter. Never throws; returns `[]` on any failure.

This is a correctly-built retrieval path. Its limits are what matter:

- **Scoped to the patient's active lifestyle programme only**, by design — `graph.ts` skips retrieval
  entirely for a paused or red-flagged programme, and for any patient with no programme at all. A
  hypertension patient asking about their medication retrieves nothing.
- **Inert today.** `graph.ts`'s own comment states no `VOYAGE_API_KEY` is configured and no
  `lpe_content_blocks` row is `clinician_reviewed` yet. The path is drop-in ready, not running.
- **Two other approved libraries are not retrievable at all**: `health_education_content` (has
  `clinician_reviewed`, `reviewed_by_name`, `reviewed_at` — but no embedding column and no match RPC)
  and `condition_protocols` / `protocol_versions` — which are the *first* source §36.15 names.

### 2.5 The two other AI surfaces — and the pattern the chat should have copied

This is the most useful finding in the audit.

| Surface | Table | `model_id` | `input_snapshot` | `status` / `error_message` |
|---|---|---|---|---|
| Case briefs (clinician-facing) | `case_briefs` | ✅ not null | ✅ not null | ✅ |
| Result explainer (patient-facing) | `patient_result_explanations` | ✅ | ✅ | ✅ |
| **AI Coach chat (patient-facing)** | `ai_conversations` | ❌ | ❌ | ❌ |

`case_briefs`' own migration comment describes `input_snapshot` as *"exactly what was sent to the
model — the audit/reproducibility record for a clinical-safety-adjacent AI output."* That discipline
exists in this codebase, is documented in this codebase, and was applied to both the lower-volume
surfaces — and not to the highest-volume, most patient-facing, escalation-triggering one.

`patient_result_explanations` (`20260802205209`) is also a substantially complete §36.6: latest +
previous value for trend framing, five-language support, cached per `(patient, kind, subject_key,
language)`, built from a deliberately minimal snapshot (`lib/patient-explainer/snapshot.ts`) rather
than the whole chart.

### 2.6 Everything §36.3 asks for already exists as data

Not one of these needs a new table. They are simply not read by the assistant:

| §36.3 item | Where it lives |
|---|---|
| age, sex | `profiles.date_of_birth`, `profiles.sex` |
| active conditions | `patient_conditions` |
| medications | `medications`, `medication_logs`, `medication_refill_state` |
| allergies | `patient_allergies` |
| recent results | `lab_analyte_readings`, `screening_results`, `vitals_readings` |
| care programme | `chronic_programme_enrolments`, `lpe_enrollments`, `care_plans` |
| current tasks | `lpe_task_instances`, `care_plan_goals`, `screening_schedules` |
| appointments | `appointments`, `video_consultations` |
| monitoring | `vitals_reminder_rules`, `vitals_reminder_state`, `medication_adherence_checkins` |

### 2.7 The privacy notice already makes promises about this assistant

`20260812004025_legal_consent_em_dash_cleanup.sql` shows the live consent text already tells patients
that AI runs "before they act on your case; it never diagnoses" and explains results "in your own
language: never a diagnosis", and that the in-app conversation "cannot be closed". Those are already
published commitments. Any §36 work has to hold them, and §4.3's audit gap is what would make them
demonstrable rather than merely asserted.

## 3. Guardrails — what this document does not authorise

`CLAUDE.md` forbids building functional code for the full specialist-matching/referral pipeline
without an explicit ask. §36.10 ("Health navigation") describes exactly that boundary:

> "I need to see a cardiologist." The assistant can initiate the referral/appointment workflow. It
> should not independently decide that cardiology is definitely required unless the workflow is an
> approved clinical pathway.

§36.10 draws its own line in the right place. Read together with `CLAUDE.md`, the split was:

- **Safe now (Level 1, navigation-only):** the assistant deep-links the patient to the existing
  referral request or booking screen and explains what happens there. It writes nothing.
- **Needs an explicit founder ask (Level 4, clinical action):** the assistant creates a
  `specialist_referrals` / `booking_requests` / `referrals` row, or names a specialty as required.

The distinction is whether a chat turn causes a clinical workflow object to exist.

**2026-08-29 — that ask was made, explicitly, and a narrower version of the Level 4 piece was
built.** `lib/ai-coach/referral-tool.ts` gives the assistant one write-capable tool,
`requestSpecialistReferral`, callable only on a clear, explicit patient request (never
speculatively). What it does NOT do, deliberately, even under the explicit ask: insert into
`public.specialist_referrals`. That table is staff/trigger-created only — stated as a design
invariant in at least two prior migrations
(`20260724020810_referral_facility_activation.sql`, `20260715125456_clinician_originated_orders.sql`)
and load-bearing for the protocol-scope-referral safety gate
(`20260826225042_protocol_scope_referral_gate.sql`, which requires a real `specialist_referrals`
row before an out-of-protocol-scope case can be marked `referred`) and several downstream triggers
(commission recording, provider notifications, patient-timeline entries) that all assume a
referral's provenance is a trusted staff/system action. The tool instead writes a `clinician_alerts`
row (`category='care_management'`, `type_code='referral_requested'`) and opens a `care_messages`
thread — a real, human-reviewed **request**, routed to a clinician (Tier 4 per the Clinical Tier
Ladder — "approves referrals") who creates the actual referral through the existing, completely
unchanged staff-only path if appropriate. §36.10's own line — "should not independently decide that
cardiology is definitely required" — is exactly what this preserves: the assistant never creates the
binding clinical workflow object, a human still does. See `docs/CLAUDE.md`'s Clinical Tier Ladder
guardrail bullet, updated in place with the same reasoning. The full specialist-matching/ranking
engine (a separate, larger piece — see `docs/CLINICAL_NETWORK_SPEC.md` §3) was NOT touched and its
guardrail is unaffected by this.

Two further standing rules bear directly on this build:

- **Never render a doctor-attribution claim without a real `reviewed_by`/`reviewed_at` record.**
  §36.6's example copy — *"Your clinician has been notified/reviewed this result"* — is a
  two-in-one claim, and "reviewed" is precisely the assertion `CLAUDE.md` and
  `docs/CLINICAL_TRUST_MODEL_SPEC.md` §2/§9 forbid unless a record backs it. The assistant must
  say "notified" only when a delivery record exists and "reviewed" only when an attribution record
  does, via the shared null-gated component — never as one fused sentence, and never as a template
  default. **This is a copy bug waiting to be introduced by implementing §36.6 literally.**
- **Never let an abnormal screening result be deprioritised or silently swallowed.** If the
  assistant ever explains a screening result, it must not become an alternative path that bypasses
  the Category 2→1 upgrade pipeline.

## 4. The three structural gaps

Everything else in §5 is incremental. These three are not: each is something the current shape
cannot express, and each blocks a cluster of §36 sections.

### 4.1 There is no tool/function-calling layer — anywhere in the codebase

Verified by search: no `bindTools`, no `tool_calls`, no `DynamicStructuredTool`, no import of
`@langchain/core/tools` anywhere in `apps/web/src`. `llmTurn` is a single structured-output call over
a **statically pre-fetched context string**.

This is the gap behind most of §36. Every §36.4 example question is a record lookup:

| §36.4 question | Answerable today? |
|---|---|
| "What is my blood pressure?" | ❌ `vitals_readings` is never read |
| "When is my next appointment?" | ❌ `appointments` is never read |
| "What medication am I taking?" | ❌ `medications` is never read |
| "Why was I referred to cardiology?" | ❌ `specialist_referrals` is never read |
| "What does HbA1c mean?" | ⚠️ From model internal knowledge only — the thing §36.16 exists to prevent |
| "Why do I need this blood test?" | ⚠️ Same |

A patient asking any of the first four today gets a fluent, plausible, **unfounded** answer, or a
deflection. Neither is acceptable for a health record assistant, and the fluent-but-unfounded case is
the dangerous one.

**Two ways to close it**, and the choice is a real architectural decision:

- **(a) Wide static context** — pre-fetch a fuller snapshot into the prompt every turn. Simple,
  no new failure modes, matches the existing `loadPatientContext` shape. But it puts the patient's
  medications, allergies, and results into *every* prompt regardless of relevance — needless PHI
  exposure per §36.17's "avoid retaining unnecessary conversational data", and it scales badly.
- **(b) Retrieval tools** — a small, fixed, read-only set the model may call: `getVitals`,
  `getMedications`, `getAllergies`, `getAppointments`, `getCareTasks`, `getRecentResults`,
  `getConditions`. Each one RLS-scoped to the caller's own session, each returning a typed shape,
  each logged as a knowledge source for §36.17.

**Recommend (b)**, with a hard rule: **read-only tools only.** No tool may write. That keeps the
entire tool layer at Level 1 of the governance ladder and makes §3's guardrail structural rather than
a matter of prompt discipline — a model that cannot call a write tool cannot create a referral by
being talked into it. A minimal (a)-style widening of `loadPatientContext` is still worth doing first
as Phase 1, because it is cheap and unblocks §36.5/36.8/36.9 without any new machinery.

### 4.2 Context is 2 of §36.3's 11 items

`loadPatientContext()` reads exactly two things: `prevention_risk_scores` rows tiered above `low`,
and lifestyle programme enrolments/goals/phase. That is 2 of 11 (§2.6).

The consequence is §36.3's own worked example inverted: the assistant can say "HbA1c in general" but
not "your HbA1c" — which §36.3 names as the entire point of the section.

This is the **highest-value, lowest-risk gap in the spec**: pure Level 1, every table already exists,
every one is already RLS-scoped to the patient's own session, and it needs no new model behaviour.

Two cautions when widening it:

- `loadPatientContext` documents itself as never throwing. Every added read must hold that contract —
  a failed appointment lookup must degrade the answer, never fail the turn.
- Widening context widens what is persisted into `ai_conversations.messages`, which today has **no
  retention policy and is readable by all org staff** (§4.3). Fix the audit/retention shape first or
  in the same change — not after.

### 4.3 There is no AI provenance record for the chat — and the pattern already exists in-repo

§36.17 asks for: model/version, knowledge sources, timestamp, interaction type, safety
classification, escalation, final action.

`ai_conversations` (`20260706084944`) is `id, organisation_id, profile_id, messages jsonb,
created_at, updated_at`. The only §36.17 field captured anywhere is `tier`, tucked inside each
assistant message in the `messages` blob. Not captured: which model answered, which prompt version,
which knowledge sources were retrieved, whether an escalation resulted, what the final action was.

Concretely, today: **a chat turn can create a `clinician_alerts` row, an `escalations` row, and an
`emergency_events` row — and there is no record of which model produced the classification, what
context it saw, or what it retrieved.** For a Level 3 clinical-decision-support output that is a real
governance gap, not a documentation nicety. It is also the difference between honouring the published
consent text in §2.7 and merely asserting it.

The remedy needs no invention — copy `case_briefs` / `patient_result_explanations` (§2.5). A
per-turn `ai_assistant_turns` row (one row per turn, not per conversation) carrying `model_id`,
`prompt_version`, `interaction_type`, `safety_classification`, `retrieved_source_ids`,
`clinician_alert_id`, `escalation_id`, `final_action`, `input_snapshot`, `status`, `error_message`,
`generated_at`. Normalising the classification out of the jsonb blob also makes "how often does the
assistant escalate, and was it right?" a query instead of a jsonb scan.

Two adjacent issues to settle in the same change:

- **Retention.** §36.17 says "avoid retaining unnecessary conversational data." There is no retention
  or purge policy on `ai_conversations` at all — transcripts accumulate indefinitely. Structured
  audit metadata is exactly what makes a transcript-retention limit *possible*: the audit row is what
  you must keep, the free text is what you can age out. Decide the window (§8).
- **Staff read scope.** `ai_conversations_select` grants read to `private.is_org_staff(organisation_id)`
  — every org staff account can read every patient's full assistant transcript. `CLAUDE.md` flags
  `is_org_staff` as the highest-leverage security function in the codebase, gating ~110 tables. Free-text
  symptom chat is more sensitive than most of what it gates, and a coordinator who has no reason to
  read it can. Worth a narrower policy; changing `is_org_staff` itself is not the fix.

## 5. Section-by-section against §36

**Legend** — ✅ shipped · 🟡 partial · ❌ absent · 🔒 guardrailed (needs explicit founder ask)

| § | Requirement | State | Detail |
|---|---|---|---|
| 36.1 | Purpose — bounded, not an unrestricted chatbot | ✅ | `COACH_SYSTEM_PROMPT` bounds scope to education/guidance/triage; explicit "never diagnose, never recommend a dose, never claim to replace the care team" |
| 36.2 | Core pipeline | 🟡 | **2026-08-29: identity/context and retrieval are now full** (§7 Phases B/C). **Post-response safety check is still absent** — classification is pre-response only, so a model reply is appended and returned without a second pass. The deterministic pre-pass mitigates but does not replace it — this is the one §36.2 stage this session did not build |
| 36.3 | Context awareness (11 items) | ✅ | **2026-08-29: all 11** (`context.ts`'s widened `loadPatientContext`), though only demographics + risk tiers + lifestyle state are pushed into every prompt as static context — the rest (medications, allergies, vitals, labs, appointments, conditions) is available on demand via the read-only tools below, deliberately, to avoid pushing PHI into every turn regardless of relevance (§4.1) |
| 36.4 | Patient questions | ✅ | **2026-08-29:** all six example questions now answerable — `tools.ts`'s six read-only record tools (`getVitals`, `getMedications`, `getAllergies`, `getAppointments`, `getConditions`, `getRecentLabResults`), bound into `llmTurn`'s bounded tool-calling loop (`graph.ts`) |
| 36.5 | "Explain my health record" | ✅ | **2026-08-29:** `composed-surfaces.ts`'s `explainHealthRecord()`, a chat quick-action button. Deliberately deterministic (no LLM call) rather than model-narrated — every field is a value read straight from the record, formatted, never phrased by a model, which is the strictest way to satisfy §36.5's "distinguish documented facts from AI interpretation" |
| 36.6 | Result explanation | 🟡 | `patient_result_explanations` + `lib/patient-explainer/` — cached, 5 languages, latest+previous trend framing, `model_id` and `input_snapshot` recorded. **Still not reachable from chat** as a citation source (the new `getRecentLabResults`/`getVitals` tools read raw values, not this cached explainer), and see §3 on its example copy |
| 36.7 | Medication explanation | 🟡 | **2026-08-29:** a `getMedicationInformation` tool and a 14-drug starter library now exist (migration `20260829112000`, reusing `health_education_content`'s existing `'medicines'` category and review/embedding machinery), covering the core hypertension/diabetes formulary plus common cardiovascular co-prescriptions — purpose and mechanism only, no dose language anywhere in the content. **Still 🟡, not ✅, because every drafted row ships `clinician_reviewed = false`** (same honesty rule as every other draft library in this codebase) — the tool returns `found: false` for all of them until an actual clinician reviews and approves each one, at which point they start answering with no further code change. §8, item 2 (who reviews it) is unresolved; this closed "no pipeline exists," not "content is live" |
| 36.8 | Care-plan explanation ("what do I need this month") | ✅ | **2026-08-29:** `composed-surfaces.ts`'s `careTasksThisMonth()`, composing `vitals_reminder_state`, medication refill dates, `screening_schedules`, and upcoming appointments into the ✓/○ checklist §36.8's own example shows |
| 36.9 | Appointment preparation | 🟡 | **2026-08-29:** `composed-surfaces.ts`'s `prepareForAppointment()` covers symptoms, recent measurements, and medication issues (an overdue refill). Not included: "changes since previous review" (needs a review-history read not yet built) and a generated "questions to ask" list (deliberately out of scope — see composed-surfaces.ts's own top comment on why these three surfaces stay LLM-free) |
| 36.10 | Health navigation | 🟡 | **2026-08-29, on explicit founder ask:** `requestSpecialistReferral` (see §3) flags a patient's explicit request for a clinician to review — real, but deliberately not a binding referral. **Still 🟡, not ✅:** it does not create a `specialist_referrals` row itself, by design (§3) — a human clinician still makes that call through the unchanged, existing staff-only path |
| 36.11 | Emergency safety | ✅ | Deterministic pre-model guardrail; verbatim safety copy; `clinician_alerts` + `escalations` + `emergency_events` with a 4h SLA; reuses the acknowledge-gated patient emergency pathway. **2026-08-29: now also opens a real `care_messages` thread** (§36.14 below) |
| 36.12 | Structured symptom capture | ❌ | Free text only, still. `symptoms` table and `lib/triage/score.ts` exist and are now *readable* from chat (`prepareForAppointment` reads recent `symptoms` rows), but nothing *collects* a new structured report (onset/duration/severity/associated symptoms) from within a conversation |
| 36.13 | AI uncertainty | 🟡 | Real as a *system* property (fail-cautious to `clinician_review`; `COACH_UNAVAILABLE_REPLY`) and, as of 2026-08-29, reinforced at the prompt level: `COACH_SYSTEM_PROMPT`'s grounding rules now explicitly instruct "if a tool returns nothing... say plainly you don't have enough information... do not fill the gap from general knowledge." Still not a first-class, separately audited response *mode* — it's prompt instruction, not a structural guarantee the way the keyword guardrail is |
| 36.14 | Human handoff | 🟡 | **2026-08-29: the emergency half of the "conversation continues" gap is closed** — `logAiCoachEscalation` now opens a `care_messages` thread (linked via `care_message_threads.escalation_id`) so a clinician's reply reaches the patient in-app. **The `clinician_review` tier is still unlinked** — `logAiCoachReviewFlag` creates no `escalations` row to hang a thread off, and adding one was judged out of scope for a schema change to a shared table within this pass (§7 Phase D) |
| 36.15 | Approved knowledge base | 🟡 | **2026-08-29: two of the named sources retrievable** (`lpe_content_blocks` and now `health_education_content`, mirrored the same way — `knowledge-base.ts`, `match_health_education_content` RPC). Both remain inert pending a `VOYAGE_API_KEY` and reviewed content (§8, item 3), same as before this session. **`condition_protocols`/`protocol_versions` — §36.15's first-named source — still not retrievable at all**; no approved medication content (36.7) |
| 36.16 | Retrieval-augmented generation | 🟡 | **2026-08-29: now multi-source** (two libraries queried per turn instead of one, source ids recorded per turn into the new audit table). Still inert pending the same operational blockers as §36.15 |
| 36.17 | Response logging | ✅ | **2026-08-29:** `ai_assistant_turns` (migration `20260829100000`) — `audit.ts`'s `logAssistantTurn`, called from every `runCoachTurn()`/`runQuickAction()` exit path, recording model id, prompt version, safety classification, retrieved source ids, escalation linkage, and status. The central governance gap this document identified (§4.3) is closed |
| 36.18 | Acceptance criteria | 🟡 | See §9 |

**Summary, 2026-08-29 (end of session): 7 shipped, 10 partial, 1 absent, 0 guardrailed** (was 3/7/7/1
before this session). 36.10 moved out of guardrailed on an explicit founder ask partway through this
session — see §3 for exactly what was and wasn't built under that ask, and the status callout at the
top of this document for the full session summary.

## 6. Target architecture

The §36.2 pipeline, with the missing stages named and each stage's governance level marked:

```
PATIENT MESSAGE
     |
[1] IDENTITY / ENTITLEMENT          has_ai_coach_access() + daily cap     (shipped)
     |
[2] DETERMINISTIC SAFETY PASS       keyword-guardrail.ts, pre-model       (shipped)  L2
     |                              emergency -> skip straight to [7]
[3] PATIENT RECORD CONTEXT          loadPatientContext(), widened          (gap 4.2)  L1
     |
[4] RETRIEVAL                       approved sources only, ids captured    (gap 2.4)  L1
     |                              protocols + education + medication + lifestyle
[5] MODEL TURN                      classification + reply, cited          (shipped)  L1/L2
     |                              may call READ-ONLY record tools        (gap 4.1)
     |
[6] POST-RESPONSE SAFETY CHECK      re-classify the reply, not just        (gap 36.2) L2
     |                              the question
     |
[7] ACTION                          routine -> reply
     |                              uncertain -> "needs a clinician"       (gap 36.13)
     |                              clinician_review -> alert (72h SLA)    (shipped)  L3
     |                              emergency -> alert + escalation +      (shipped)  L3
     |                                           emergency_event (4h SLA)
     |                              handoff -> link into care_messages     (gap 36.14) L3
     |
[8] AUDIT                           ai_assistant_turns: model, prompt      (gap 4.3)  L3
                                    version, sources, classification,
                                    escalation, final action
```

Four design commitments worth stating explicitly, because each is a place this could go wrong:

1. **The deterministic pass stays first and stays authoritative.** It is the only part that works
   when the model doesn't. No retrieval, tool call, or context widening may be allowed to run before
   it or to override it.
2. **Every record tool is read-only** (§4.1). The governance boundary between Level 1 and Level 4 is
   enforced by the tool surface, not by the prompt.
3. **Retrieval is source-gated, and sources are recorded.** Only `clinician_reviewed` content; the
   retrieved ids land in the audit row. "Which approved source did this claim come from?" must be
   answerable per turn — that is what separates §36.16 from a chatbot with a nice prompt.
4. **Documented fact and AI interpretation are visually distinct** (§36.5). A value read from the
   record and a sentence generated about it are different epistemic objects and must not render
   identically. `patient_result_explanations`' split of `input_snapshot` from `explanation_text` is
   the right shape to follow.

## 7. Phased recommendation

Ordered by the governance ladder (§1), not by visible impact — audit before breadth.

**2026-08-29 — Phases A, B, and C below are done; Phase D is done for the emergency tier only.** See
the status callout at the top of this document for the summary and exact file names. What follows is
left as originally written (the plan this work was built from) except where a phase heading below is
marked done inline.

### Phase A — Governance foundation (no new patient-facing behaviour) — ✅ done 2026-08-29

The prerequisite for everything else. Nothing here changes what a patient sees.

1. `ai_assistant_turns` — one row per turn, following `case_briefs`' column shape (§4.3).
   Backfill is not required; start recording forward.
2. Write it from `runCoachTurn()`, including on the short-circuit paths (access denied, rate limited)
   and on the degraded path — a failed turn is exactly the one worth having a record of.
3. Link `clinician_alert_id` / `escalation_id` back onto the turn that caused them.
4. Decide and implement the transcript retention window (§8).
5. Narrow `ai_conversations_select`'s staff read scope (§4.3).

*Level 3. Migrations + one library change. No UI.*

### Phase B — Context and grounding (Level 1 breadth) — ✅ done 2026-08-29

6. Widen `loadPatientContext()` to §36.3's 11 items (§4.2), preserving its never-throws contract.
7. Embed `health_education_content`; add a `match_health_education_content` RPC mirroring
   `match_lpe_content_blocks`; make retrieval source-agnostic so the graph queries all approved
   libraries rather than only the lifestyle one, and stop scoping retrieval to lifestyle enrolment.
8. Record retrieved source ids into the Phase A audit row.
9. Add the "I don't have enough information to answer that safely" response mode as a first-class
   outcome (§36.13) — grounded in "retrieval and tools returned nothing", not model mood.

*Blocked on: a `VOYAGE_API_KEY`, and at least some content actually marked `clinician_reviewed` —
both are operational, not engineering (§8).*

### Phase C — The structured surfaces patients asked for — ✅ done 2026-08-29

10. Read-only record tools (§4.1(b)).
11. "Explain my health record" (§36.5) — fact/interpretation split, reusing the
    `patient-explainer` snapshot discipline.
12. "What do I need to do this month" (§36.8) — composed from existing task tables.
13. Appointment preparation (§36.9).
14. Surface the shipped result explainer (§36.6) from inside chat instead of only from result cards.

*Level 1 throughout. This is where the assistant becomes the thing §36.1 describes.*

### Phase D — Handoff continuity and symptom capture — 🟡 emergency-tier handoff done 2026-08-29, symptom capture not built

15. Close the §36.14 loop: link an assistant-raised flag to a `care_messages` thread so the clinician's
    reply reaches the patient in-app, and the patient can see that a human picked it up. **In-app only** —
    `CLAUDE.md`'s 2026-07-30 rule puts two-way patient↔care-team conversation in `care_messages`, never
    WhatsApp.
16. Structured symptom capture (§36.12) feeding the existing `symptoms` table and `lib/triage/score.ts`.

### Phase E — Guardrailed, needs an explicit founder ask — 🟡 both items closed 2026-08-29 on that ask

17. ~~§36.10 write-side navigation (§3). Deep-linking only until then.~~ **Done, narrower than
    written here:** `requestSpecialistReferral` (§3) flags a request for clinician review — it does
    NOT create a `specialist_referrals` row itself, which this session judged out of scope even
    under the explicit ask (see §3's full reasoning). A human clinician still creates any real
    referral through the existing, unchanged staff-only path.
18. ~~Approved medication-information content (§36.7)~~ **Done as a pipeline, not yet as content
    patients see:** a `getMedicationInformation` tool and a 14-drug draft library now exist
    (migration `20260829112000`), but every row ships `clinician_reviewed = false` — this session
    authored the drafts, it did not (and could not) provide the clinical review itself. §8 item 2
    (who reviews it) is still open.

## 8. Open decisions

Genuine founder/clinical calls, not engineering choices. Each blocks something above.

1. **Transcript retention window.** §36.17 asks for data minimisation; there is no policy today.
   What is the window, and does an escalated conversation retain longer than a routine one? *(Blocks A4.)*
2. **Medication-information content.** §36.7 cannot ship safely without an authored, clinician-reviewed
   library. Who authors it, who reviews it, and does it launch scoped to the chronic-disease formulary
   only? *(Blocks E18.)*
3. **`VOYAGE_API_KEY` and content review.** Retrieval is inert until both exist. Neither is code.
   *(Blocks B7/B8 — and note the existing lifestyle retrieval path is equally inert today.)*
4. **Free-plan escalation policy.** `escalate.ts` writes a `clinician_alerts` row on every
   `clinician_review`/`emergency` turn with no feature-flag check. Today the plan gate on the coach
   itself makes this mostly moot — but `has_ai_coach_access()` lets an admin set a **global "everyone"
   rule that bypasses the plan feature flag entirely**, and a Free patient reaching chat under that
   rule would page a clinician. This may well be *correct*: `CLAUDE.md`'s 2026-08-10 correction gates
   patient-logged vitals red flags to paid plans but explicitly preserves the emergency safety net and
   the screening pipeline on every plan, and an assistant-detected emergency looks much more like the
   safety net than like the vitals gate. **Flagging it as a decision to make deliberately rather than
   inherit by accident** — not asserting it is a bug.
5. **Should the assistant answer at all when retrieval returns nothing?** §36.13 says saying "I don't
   know" is a feature. The strict reading — no approved source, no answer — is safest and would make
   the assistant noticeably less useful until the content libraries fill out. Recommend strict for
   anything clinical (medications, results, protocols), permissive for navigation and platform
   questions. *(Shapes B9.)*

## 9. §36.18 acceptance criteria — current standing

> The AI assistant must be: Useful → contextual → transparent → bounded → clinically governed → auditable.

| Criterion | Standing | What closes it |
|---|---|---|
| **Useful** | ✅ | **2026-08-29:** can now answer questions about the patient's own record via tools (36.4), reach three composed surfaces (36.5/36.8/36.9) directly, look up reviewed medication information when it exists (36.7 — the pipeline is real, but content is still all unreviewed drafts, so it mostly still says "I don't know" today), and flag an explicit specialist-referral request (36.10) |
| **Contextual** | ✅ | **2026-08-29:** all 11 of §36.3's context items (§4.2, Phase B) |
| **Transparent** | 🟡 | **2026-08-29:** retrieved source ids are now recorded per turn (audit table), and the three composed surfaces are 100% documented-fact with no generated text at all. Still missing: in-chat source *citation* to the patient (the retrieved titles inform the model's answer but aren't shown), and the chat's own free-text replies have no fact/interpretation visual split the way the composed surfaces do |
| **Bounded** | ✅ | Scope guardrails in the system prompt (strengthened 2026-08-29 with explicit grounding/uncertainty rules); deterministic emergency pass; entitlement and rate limits; fail-cautious degradation; read-only tools only (§4.1's hard invariant). Still the strongest criterion |
| **Clinically governed** | 🟡 | Escalation paths, SLAs, and `clinician_reviewed` content gating are real. **2026-08-29: the handoff loop now closes back to the patient for the emergency tier** (36.14) — `clinician_review` still doesn't. There is still no post-response safety check (§36.2) |
| **Auditable** | ✅ | **2026-08-29:** `ai_assistant_turns` records model/version, retrieved sources, safety classification, escalation linkage, and status per turn (§4.3, Phase A) |

**Four of six criteria are now met, as of 2026-08-29** (was one of six). The two still short —
**Transparent** and **Clinically governed** — share one open item each: source citation isn't
surfaced to the patient yet, and the `clinician_review` tier's handoff loop still doesn't close.
Both are incremental extensions of infrastructure this session already built (the audit table
already records what it would cite; `care_message_threads` already supports the same linkage
pattern the emergency path now uses), not further structural gaps.

## 10. Where to look

- Assistant implementation → `apps/web/src/lib/ai-coach/`
- Chat UI → `apps/web/src/app/(dashboard)/patient/ai-coach-chat.tsx`, mounted at
  `patient/(sections)/care/page.tsx:69` and `patient/lifestyle/lifestyle-client.tsx:189`
- Admin console → `apps/web/src/app/(dashboard)/admin/settings/ai-coach/`
- Retrieval → `apps/web/src/lib/lifestyle/find-relevant-content.ts`, RPC `match_lpe_content_blocks`
- Provenance patterns to copy → `apps/web/src/lib/case-briefs/`, `apps/web/src/lib/patient-explainer/`
- Schema → `20260706084944_ai_conversations.sql`, `20260707071318_ai_coach_access_rules.sql`,
  `20260707074210_ai_coach_daily_limits.sql`, `20260719120001_lpe_foundation.sql`,
  `20260802205209_patient_result_explanations.sql`
- Attribution rules that constrain §36.5/36.6 copy → `docs/CLINICAL_TRUST_MODEL_SPEC.md` §2, §9
- Referral-pipeline guardrail → `CLAUDE.md`, "What Claude Must Never Do"; `docs/CLINICAL_NETWORK_SPEC.md` §3

## Appendix — §36 source spec, reproduced in full

Reproduced verbatim from the handed-in spec for reference; §5 above is the section-by-section
reconciliation against it.

> **36. AI HEALTH ASSISTANT**
>
> **36.1 Purpose.** The AI Health Assistant is the patient's intelligent interface to Tarragon. It
> should help patients: understand their health; navigate Tarragon; understand results; understand
> medications; understand care plans; prepare for appointments; complete monitoring; find appropriate
> services; ask health questions; stay engaged. It should not simply behave like an unrestricted
> general-purpose chatbot.
>
> **36.2 Core architecture.** PATIENT QUESTION → IDENTITY/CONTEXT → SAFETY CLASSIFICATION → RETRIEVE
> APPROVED INFORMATION → PATIENT RECORD CONTEXT → AI RESPONSE → SAFETY CHECK → RESPONSE → AUDIT.
>
> **36.3 Context awareness.** With appropriate authorisation, the assistant can understand: age; sex;
> active conditions; medications; allergies; recent results; care programme; current tasks;
> appointments; monitoring. This allows "Your HbA1c" rather than "HbA1c in general."
>
> **36.4 Patient questions.** Examples: "What is my blood pressure?" "Why do I need this blood test?"
> "What does HbA1c mean?" "When is my next appointment?" "What medication am I taking?" "Why was I
> referred to cardiology?"
>
> **36.5 Health record explanation.** Patient selects: Explain my health record. AI creates a simple
> summary: current conditions; recent results; current medicines; upcoming appointments; active care
> goals. It should distinguish documented facts from AI interpretation.
>
> **36.6 Result explanation.** Example: "Your HbA1c is 7.8%. This test gives an indication of average
> blood glucose over the previous several weeks. Your clinician has been notified/reviewed this
> result." The AI should not independently diagnose the patient.
>
> **36.7 Medication explanation.** Example: "This medication has been prescribed to help control your
> blood pressure." The assistant should retrieve medication information from approved Tarragon content.
>
> **36.8 Care-plan explanation.** Patient can ask: "What do I need to do this month?" AI retrieves
> active tasks, e.g.: This month: ✓ BP monitoring ✓ Medication ○ Blood test ○ GP review.
>
> **36.9 Appointment preparation.** Before consultation: "What should I tell my doctor?" AI can
> summarise: symptoms; recent measurements; medication issues; questions; changes since previous
> review.
>
> **36.10 Health navigation.** Example: "I need to see a cardiologist." The assistant can initiate the
> referral/appointment workflow. It should not independently decide that cardiology is definitely
> required unless the workflow is an approved clinical pathway.
>
> **36.11 Emergency safety.** The assistant needs a dedicated safety layer. If a conversation contains
> potential emergency symptoms: Potential emergency → Do not continue normal chatbot workflow →
> Emergency guidance → Appropriate emergency pathway. It should not attempt lengthy diagnostic
> questioning when immediate emergency action is appropriate.
>
> **36.12 Symptom conversations.** For non-emergency symptoms, the assistant can collect structured
> information: symptom; onset; duration; severity; associated symptoms; relevant history. Then route
> to an appropriate pathway.
>
> **36.13 AI uncertainty.** The AI should be capable of saying: "I don't have enough information to
> answer that safely." and: "This needs to be reviewed by a clinician." This should be considered a
> feature, not a failure.
>
> **36.14 Human handoff.** AI conversation → Needs human → Create support/clinical task →
> Nurse/clinician → Conversation continues.
>
> **36.15 Approved knowledge base.** The AI should preferentially use: Tarragon clinical protocols;
> approved education materials; approved medication information; approved patient instructions;
> relevant trusted sources.
>
> **36.16 Retrieval-augmented generation.** The production architecture should use retrieval rather
> than relying solely on the model's internal knowledge. Question → Retriever → Approved Tarragon
> sources → Relevant context → LLM → Response.
>
> **36.17 AI response logging.** Store appropriate audit metadata: model/version; knowledge sources;
> timestamp; interaction type; safety classification; escalation; final action. Avoid retaining
> unnecessary conversational data.
>
> **36.18 AI acceptance criteria.** The AI assistant must be: Useful → contextual → transparent →
> bounded → clinically governed → auditable.
