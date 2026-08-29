# AI Governance, Safety & Model Management

The governance layer over every AI capability Tarragon runs. Built 2026-08-29 as Module 40 of the
platform specification, and treated as a first-class platform capability rather than an appendix to
the AI work: nothing in the AI stack is meant to run outside it.

The positioning decision behind all of it: **Tarragon's AI is the intelligence and orchestration
layer around a governed healthcare system, not an "AI doctor".** The AI understands, summarises,
educates, identifies patterns, assists clinicians, navigates patients and predicts risk. Clinical
accountability stays with appropriately authorised healthcare professionals and governed protocols.
Every design decision below follows from that.

---

## Where it lives

| Layer | Location |
| --- | --- |
| Schema, RPCs, triggers | `supabase/migrations/20260829094312` … `20260829124416` (8 migrations) |
| Runtime | `apps/web/src/lib/ai-governance/`, plus `apps/web/src/lib/ml/governed-ml-client.ts` for AI-010 |
| Admin console | `apps/web/src/app/(dashboard)/admin/settings/ai-governance/` |
| Patient/clinician incident report | `apps/web/src/components/ai/report-ai-answer.tsx` |
| Live proof | `packages/db/tests/ai_governance.sql` (8 cases, run against the linked project) |

---

## What each part of the module maps to

| § | Requirement | Where it is |
| --- | --- | --- |
| 40.1 | AI registry | `ai_systems` — ten capabilities, `AI-001` … `AI-010` |
| 40.2 | Model metadata | `ai_system_versions` (model, training data, intended/excluded population, validation, approval, deployment, review) |
| 40.3 | Risk classification | `ai_risk_class` — low / moderate / high / very_high |
| 40.4 | Human oversight | `ai_autonomy_level` — inform_only / recommend / assist / execute |
| 40.5 | AI guardrails | `ai_guardrails`, eight `ai_guardrail_kind` categories |
| 40.6 | Prompt management | `ai_prompt_versions` + `activate_ai_prompt_version()` |
| 40.7 | Knowledge-source governance | `ai_knowledge_sources.citation_label`, linked per answer via `ai_interaction_sources` |
| 40.8 | Hallucination monitoring | `ai_interaction_log.output_flags` (`ai_output_flag` enum) |
| 40.9 | Evaluation environment | `ai_evaluation_suites` / `_cases` / `_runs` / `_case_results`, gate in `private.ai_release_gate()` |
| 40.10 | Red-team testing | `ai_redteam_category` — all seven scenarios seeded for the AI Coach |
| 40.11 | AI audit trail | `ai_interaction_log`, written only by `record_ai_interaction()` |
| 40.12 | Incident reporting | `ai_safety_incidents` + `report_ai_safety_incident()` |
| 40.13 | Performance dashboard | `ai_governance_dashboard()` → `/admin/settings/ai-governance` |
| 40.14 | Bias and fairness | `ai_bias_assessments`, keyed by (dimension, group_label) |
| 40.15 / 40.16 | Data drift / model drift | `ai_drift_observations` (`ai_drift_kind`) |
| 40.17 | Kill switch | `ai_systems.is_enabled` + `set_ai_system_enabled()` |
| 40.18 | Fallback architecture | `ai_systems.fallback_behaviour` + `runGovernedAi()`'s required `fallback` |
| 40.19 | Vendor management | `ai_vendors`, `ai_vendor_model_observations` |
| 40.20 | Acceptance criteria | `private.ai_acceptance_criteria()`, enforced by the activation trigger |

---

## The five decisions worth knowing before changing anything

### 1. Structural invariants, not review conventions

Three rules are CHECK constraints and triggers rather than things a reviewer is supposed to notice:

- **A high or very-high risk system may never hold `autonomy_level = 'execute'`.** No migration,
  admin screen or seed can grant it.
- **A prompt version is frozen once approved.** Changing a live prompt means proposing a new version
  and having a Clinical Director activate it — "edit the production prompt" is not an available move
  (40.6's "developers should not casually modify production prompts").
- **A version cannot be approved until every required evaluation suite has a completed passing run
  against that version.** The 40.9 pipeline's last arrow is enforced, not assumed.

### 2. The registry records reality, including where reality is uncomfortable

Ten AI capabilities were live in production before any of this existed, and not one had been through
a formal validation, a red-team pass or a bias assessment. They are registered **as running**, each
with a v1 version row whose `validation_summary` says plainly that no validation has been done, with
required evaluation suites attached and **no runs**, so the console shows exactly what each still
owes.

No evaluation run, prompt approval or knowledge-source approval was seeded. A registry seeded with
fabricated passing evaluations would be worse than no registry at all.

### 3. Grandfathering is an INSERT-time exemption and nothing else

The acceptance gate (40.20) would refuse to switch on any of the ten, because none has an approved
version. Refusing to record them, or recording them as switched off, would have made the registry a
fiction or taken live patient-facing features down for paperwork. So:

- the initial registration is a one-off grandfather (`ai_systems.grandfathered_at`), inserted enabled;
- **every transition into enabled after that** goes through the full gate, grandfathered or not.

The practical effect is a ratchet: today's systems keep running with their gaps visible; the moment
one is switched off it cannot come back until its criteria are met; nothing new ever switches on
without them. A client cannot forge the grandfather — the INSERT path refuses an enabled row from an
`authenticated` caller outright.

### 4. The kill switch is only real where the runtime asks

`ai_systems.runtime_governed` says whether the running code actually calls
`ai_runtime_config()` and honours the answer. **All ten are wired**, so `is_enabled` is a real switch
for every registered system. The flag stays as a column rather than being assumed, because an
operator would reasonably read "enabled: false" as "stopped", and a registry that cannot tell
"switched off" from "not asking" is more dangerous than one that admits the difference. Anything
registered in future starts at `false` and must earn the flag with a real call site.

Three different shapes were needed, and the choice in each case was driven by the call site rather
than by a preference for uniformity:

| Shape | Systems | Why |
| --- | --- | --- |
| `runGovernedAi()` | AI-001, AI-002, AI-003, AI-004, AI-007, AI-008 | The call has a clean "AI path / non-AI path" split, which is what the wrapper is for |
| `decideAiGovernance()` + `recordAiInteraction()` | AI-005, AI-006, AI-009 | Control flow that does not fit run/fallback — the extractors do a first pass, a corpus lookup and a conditional hinted retry; retrieval sits inside a helper with no single fallback value. Same two guarantees, assembled by hand |
| A decorator over the client | AI-010 | `ml-client.ts` lives in `packages/shared` with no database access by design. Wrapping `MlClient` once beat editing six call sites, which would have been six chances to miss one |

AI-010's decorator is worth one more line: `MlClient` already promises never to throw and to return
`null` on failure, and every caller already degrades on `null`. So a switched-off system looks to
callers exactly like a service that is down — 40.18 satisfied by a contract that already existed
rather than by new branching in six places. `health()` is passed through ungoverned on purpose: it is
a liveness probe, and an operator checking reachability while the system is off should get a truthful
answer.

**One deliberate gap in the audit trail.** AI-009 (lifestyle content embeddings) records a
switched-off outcome but not its successful retrievals. It is not clinically meaningful, it reaches
no patient directly, and a row per retrieval would bury the interactions that do matter. 40.11 asks
for an audit trail of *clinically meaningful* interactions, and this is the one registered system
that is not.

### 5. Governance must never become the new single point of failure

40.18 says AI must never be a single point of failure. A governance table that could hard-fail a
patient-facing feature would simply move the failure. So:

- every governed-record reader returns null rather than raising, and the runtime falls back to its
  in-repo constant;
- `decideAiGovernance()` never throws — a caller that cannot reach governance still gets a decision;
- the config is cached in-process for 60 seconds, and a **stale** entry is preferred over the static
  default when a lookup fails, so a system a human switched off five minutes ago stays off through a
  database blip;
- when there is no cached entry at all, `system-codes.ts` decides: high and very-high risk systems
  fail **closed** (run the fallback), lower-risk ones fail **open**. That one value has to live in
  code, because the question is what to do when the database is not answering.

---

## The audit trail's two deliberate departures from 40.11

40.11 asks for model, version, input category, retrieved sources, output, safety classification,
human override and resulting action. `ai_interaction_log` carries all of it, with two changes:

- **Input is recorded as a category, never verbatim.** A patient's message already lives in
  `ai_conversations` under that patient's own RLS; copying it into a staff-readable governance table
  would widen PHI exposure for no governance benefit. `input_category` is what bias, drift and
  incident analysis actually need.
- **Output is a bounded summary** (4,000 characters, enforced). Enough to investigate a "the AI told
  me the wrong thing" report; not a second copy of the conversation.

Rows arrive only through `record_ai_interaction()`, a SECURITY DEFINER function that derives the
organisation and the acting account server-side. There is deliberately **no INSERT policy** on the
table — asserted by the migration, because "the RPC is the only writer" is the whole integrity claim.

---

## Reporting an incorrect answer (40.12)

`report_ai_safety_incident()` is open to **any signed-in account**, with no role gate and no rate
limit. A patient noticing that the coach told them something wrong is the highest-value safety signal
this module produces, and every gate in front of it loses reports.

Severity is not taken from the reporter — it defaults to `moderate`, and a clinician sets the real one
at triage. Closing an incident is clinician-only and demands a clinical review summary; `dismissed`
means "reviewed and found not to be a safety problem", audit-logged exactly like `resolved`. There is
no way to close one silently.

High and critical incidents page active Clinical Directors and admins in-app, carrying no incident
detail beyond the system name — a description can contain a patient's own words, and only the in_app
rail may ever carry clinical content.

---

## Bias monitoring is shaped for Nigerian data (40.14)

`ai_bias_assessments` is keyed by `(dimension, group_label)` rather than fixed columns, because the
dimensions that matter here — geopolitical zone, urban/rural, state, income band, English fluency —
are not the ones a generic model-card template would choose, and the set will grow as coverage does.

The concern is concrete for `AI-001`: the model's training data is urban- and Western-skewed, and
most of the patients this platform is built for are neither. The seeded fairness suite tests the same
symptom description phrased as a North-West patient, a South-South patient, a rural patient
describing distance and cost barriers, and a patient writing in simple non-fluent English — and
expects the same tier and the same quality of guidance for each.

`sample_size` is recorded on every assessment because a disparity measured on twelve patients is a
different claim from one measured on twelve thousand.

---

## Standing rules

- **Never add an AI call site without registering it** in `ai_systems` and routing it through
  `runGovernedAi()`. An unregistered code is treated as a stop for anything fail-closed.
- **Never set `runtime_governed = true`** without a call site that actually consults
  `ai_runtime_config()`.
- **Never seed a passing evaluation run, a prompt approval, or a knowledge-source approval.** They
  represent a human's judgement; inventing one is the failure this whole module exists to prevent.
- **Never pass raw patient input as `input_category`.**
- **Never downgrade an `emergency_escalation` guardrail to `warn`.** The escalation, not the flag, is
  the safety behaviour.
- **The kill switch has no preconditions in the "off" direction.** A safety control that can be
  blocked is not a safety control.

---

## Open items

- No system has an approved version, so every one shows `validation` outstanding. Closing that means
  running the seeded evaluation suites for real and having a Clinical Director approve the result.
- No knowledge source is approved yet, so no AI answer currently cites one (40.7).
- The AI Coach's governed prompt exists as a **draft** — a verbatim transcription of what the code
  already sends. Activating it changes nothing about what patients see, which is the point of
  transcribing rather than rewriting.
- `ai_vendors` records that a Data Processing Agreement and an NDPR-facing transfer assessment for
  the model provider are outstanding. That is a compliance item, tracked, not asserted.
