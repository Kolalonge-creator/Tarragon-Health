# Tarragon Health — Shared Lifestyle Programme Engine (LPE) · Build Plan

> **This is the build contract** for implementing `guideline/LIFESTYLE_ENGINE_SPEC.md` (TH-SPEC-LPE-001).
> The spec is the *destination*; this doc is *how and in what order we get there*, mapped onto the real
> Tarragon codebase. Read alongside `CLAUDE.md` and the spec.
>
> **Status:** In build · branch `claude/lifestyle-engine` (off `main-dev`) · pre-launch (no live patient data yet).

---

## 0. Decisions locked (with the founder)

| Decision | Choice | Rationale |
|---|---|---|
| Adopt the LPE architecture? | **Yes** — condition-agnostic core + thin adapters | One engine for HTN/DM/obesity; "add a 4th condition = one adapter" is the expansion moat |
| The existing lifestyle layer (PR #65, `lifestyle_*` tables)? | **Build LPE fresh, retire the old** | No live patient data yet → migrating the old, simpler schema buys nothing; a clean model avoids permanent debt |
| Obesity delivery | LPE supersedes the earlier "obesity = `care_plans` only" decision | Obesity remains doctor-led via `care_plans`, but its *lifestyle scaffolding* now runs through the shared engine, not bespoke code |
| Build order | **Value-first + safety-first**, Phases 1→5 | Foundation → Safety → Patient experience → Doctor/partner → Intelligence |
| Phase 5 (ML + agent) timing | **Build the plumbing now; models start heuristic and learn as patients register** | Inserting ML into a live, payment-taking system later = open-heart surgery. Build it while safe to break; ship rules-based, recalibrate on real data |

**Non-negotiables carried from `CLAUDE.md` (unchanged, enforced throughout):**
- App/web is the source of truth for all logging. **No write path ever sets `source='whatsapp'`.** WhatsApp/SMS = alerts + human support only.
- Every table has `organisation_id` + RLS at the Postgres level. NGN in kobo, phones E.164, `Africa/Lagos`.
- Every clinical decision is a doctor's. The engine *requests* decisions, never makes them. No Care Coordinator write access to clinical fields.
- "Reviewed by Dr X" is a single null-gated component tied to a real `reviewed_by`/`reviewed_at`. Never a hardcoded string.
- Abnormal-result Cat 2→1 escalation path must never be blocked or swallowed.

---

## 1. Guiding principle

The three pathways share the *same* lifestyle scaffolding (diet · activity · behaviour · sleep · stress) and differ only in
**targets, cadence, red-flag thresholds, and content emphasis**. So: **one engine, conditions are configuration.**

Stakeholder payoff:
- **Patient** — one consistent, safe, non-shaming experience across every condition.
- **Founder** — one codebase, one safety core to audit, linear cost to add conditions.
- **Partners/HMO** — one clean outcomes-data shape to report renewals against.

---

## 2. Architecture placement (mapped to the real repo)

```
apps/web/                         # Next.js — patient app/web + doctor console (existing)
packages/lifestyle-engine/        # ← NEW: the LPE core (condition-agnostic, pure TS, unit-tested)
  ├─ core/                        # state machine, scheduler, goal/task engine
  ├─ safety/                      # red-flag evaluator + escalation orchestration (Phase 2 — the gate)
  ├─ measurements/                # ingestion, validation, unified schema
  ├─ adapters/                    # htn.ts · diabetes.ts · obesity.ts (config only, zero procedural logic)
  ├─ messaging/                   # WhatsApp cadence planner → MessagingGateway interface
  └─ types/                       # shared TS types + zod schemas
packages/shared/                  # existing — ml-client.ts (never-throw contract) lives here already
services/ml/                      # existing Python FastAPI service (Sprint 4, un-paused for Phase 5)
supabase/migrations/              # LPE schema migrations
```

The engine is a **package, not a service** — the same tested logic runs in route handlers, cron jobs, and the doctor
console. All side-effects (DB, WhatsApp, ML) are injected as interfaces so `core/` and `safety/` are unit-testable in isolation.

**Reuse, don't reinvent** (grounded in existing schema):
- `vitals_readings` (`vital_type`: blood_pressure/glucose/weight/pulse/temperature/spo2; `vital_source`: manual/device/wearable) is the existing measurement store. The unified LPE `measurement` model **bridges to it** for any overlapping vital (no dual source of truth); *passive/lifestyle-only* signals with no `vital_type` equivalent (mood, sleep, food_log, waist, activity_minutes) get their own LPE-owned rows — mirroring the existing `wearable_readings`-vs-`vitals_readings` split.
- `care_plans` / `care_plan_condition` (already has `hypertension`/`diabetes`/`obesity`) stays the doctor-owned clinical spine.
- `escalations` + `clinician_alerts` (existing) are the escalation substrate — the Phase 2 red-flag evaluator **feeds these**, it does not build a parallel `red_flag_event` table unless the spec's stand-down semantics genuinely can't be expressed on them (decided during Phase 2).
- `ml-client.ts` never-throw `{ok,data|error}` contract is the template for all Phase 5 calls.
- `notifications` queue + `send-pending-notifications` Edge Function is the outbound transport the `MessagingGateway` wraps.

---

## 3. The five phases

Each phase ends at a **verification gate**: `pnpm typecheck`/`lint`/`test` green, migrations applied + `get_advisors` clean,
RLS on every new table, and (where UI-facing) an authenticated browser click-through.

### Phase 1 — Foundation
**Goal:** the substrate everything sits on.
- Scaffold `packages/lifestyle-engine` with the module layout above; wire into the pnpm workspace + `apps/web` typecheck.
- **Unified `measurement` model** in `measurements/` + zod schemas; ingestion validates plausibility (§8.2 of spec), persists, and **routes overlapping vitals into `vitals_readings`** while LPE-only signals go to a new `lifestyle_measurements` table. Rule enforced in code + test: no path sets `source='whatsapp'`.
- **Template hierarchy** (authored, versioned, clinician-reviewed): `programme_template → phase_template → goal_template → task_template` + `content_block`. Superset schema (obesity-complete; HTN/DM are subsets).
- **Three adapters** (`htn.ts`, `diabetes.ts`, `obesity.ts`) as pure `ConditionAdapter` config: modules+weights, targets, monitoring schedule, red-flag rule *definitions* (evaluated in Phase 2), cadence, content pack, guardrails.
- **Retire the old layer:** migration dropping `lifestyle_assessments/_goals/_programmes/_programme_enrolments/_checkins/_reviews` + remove `apps/web/.../patient/lifestyle*`, `clinician/lifestyle-reviews`, `lib/queries/lifestyle.ts`, `lib/validation/lifestyle.ts`. (Safe: no live data.) Preserve the *good* ideas (kind check-ins, null-gated `reviewed_by`) by re-expressing them in the LPE model.
- **DoD:** package builds + unit tests; adapters typecheck against the interface; a mock 4th adapter compiles with zero changes to `core/`/`safety/` (spec §18.8).

### Phase 2 — Safety core ⭐ (the hard gate)
**Goal:** nothing patient-facing ships past here without it.
- `safety/` **red-flag evaluator** — runs **synchronously before any patient-facing reply** (spec §9.1, test-enforced). Rules = adapter-specific thresholds + a **shared base set** (self-harm, chest-pain/stroke, pregnancy) applied to all.
- **Escalation levels ①–④** wired to existing `escalations`/`clinician_alerts` with SLA fields; ③/④ hit the doctor worklist as Priority-1 and reuse the abnormal-result pipeline.
- **ED / mental-health auto-pause:** an obesity ED/self-harm flag sets programme `paused` and suspends all *weight-loss* tasks/nudges **in the same transaction**; only a doctor resumes, with a reason (audited). Physical-health support continues.
- **Invariants (tested, spec §9.3/§18):** no red flag ever lost; no auto-close/auto-downgrade (doctor + reason only); no bot clinical reassurance ("your BP/sugar/weight is fine" strings blocked); missing expected data = soft flag → nudge → worklist, never assumed safe.
- **`toneGuard(text)`** deny-list (no `obese`/`fat`/`failure`/`cheat` toward the patient; no clinical verdicts) — runs in **CI and at send time**.
- **DoD:** golden safety scenarios in CI (HTN ≥180/120, DM glucose 2.8, obesity self-harm mood item); `safety/` at ~100% branch coverage.

### Phase 3 — Patient experience
**Goal:** what the patient actually feels — built safe-by-construction on 1+2.
- Goal/task engine (SMART + few, `maxActiveGoals` guard); **kind streaks** (a miss never produces a red/failure UI — gentle nudge, then after N misses a worklist item).
- Staged phases + **maintenance**; programme **state machine** (draft→active→paused→maintenance→disengaged→completed) with disengagement handled as a care signal, never shamed; one-tap re-engage.
- App/web logging UI as the source of truth (patient + coordinator-on-behalf); offline-tolerant queue.
- Redis-backed (Upstash) task/nudge scheduler, idempotent per `patient_id+task_key+due_date`.
- **DoD:** authenticated browser click-through of enrol → log → goal → check-in as a patient test account (fresh fixtures — all sprint test logins were deleted 2026-07-19).

### Phase 4 — Doctor + partner value
**Goal:** doctors own decisions; partners get evidence.
- Doctor **worklist + reviews** (schedule-driven per phase + event-driven on amber/red/disengagement/plateau); review payload = trend summary + engagement + mood/ED screen + adherence + suggested next step (support-only). Priority-1 always top.
- Doctor actions: adjust goals, advance/hold phase, resume/pause, request labs, refer, or **request a prescribing decision** (routes to clinical module — LPE never prescribes).
- **Consent** (channel + data-use + family-access) captured before enrolment; **immutable `audit_event`** for every state transition/red-flag/message (spec §14).
- **MessagingGateway** over the existing `notifications` queue: outbound cadence (reminder/nudge/result/escalation/reengagement) + **inbound intent handling** (numbers → "log it in the app"; concern text → safety classifier → escalate or route to human queue). Never writes a measurement.
- Outcomes data shape for HMO/employer renewal reporting (feeds existing cohort analytics).
- **DoD:** doctor-side browser click-through; audit completeness test; inbound-number-never-becomes-a-measurement test.

### Phase 5 — Intelligence layer (build now, learn later)
**Goal:** full plumbing in place while it's safe to break; models start on clinical heuristics and recalibrate on real data.
- **Un-pause Sprint 4 ML** (`services/ml`): `/trends` (slopes/averages/TIR/variability/plateau), `/risk/*` (reuse existing SCORE2/HbA1c work), `/engagement` (disengagement_risk 0–1). Pydantic v2, stateless, no DB access, 5s timeout, graceful fallback via `ml-client.ts`. **Heuristic thresholds first**, versioned so they can be tuned as data accrues.
- Signals attach to the programme as **advisory only** — surfaced to the doctor; never trigger autonomous clinical action or a "you're fine" message.
- **LangGraph guarded coaching agent** scaffold: observe→propose→GUARDRAILS(safety+red-flag+toneGuard+no-clinical-change)→act. Human-in-the-loop for anything clinical; the agent cannot prescribe/diagnose/titrate/reassure/override a paused state.
- **pgvector** content personalisation hooks on `content_block` (retrieval wired; ranking improves with usage).
- **DoD:** ML endpoints tested (heuristic outputs deterministic); agent guardrail tests (agent cannot emit a clinical action or resume a paused programme, spec §18.7); graceful degradation when ML is down (platform keeps working).

---

## 4. The safety gate (single most important rule)

> **No patient-facing lifestyle/obesity coaching surface is enabled until Phase 2 is complete and its golden tests pass.**

Rationale: a weight-loss product that nudges a patient with an eating disorder is an ethical, clinical, and legal catastrophe.
The safety core is the liability shield, not a feature. This gate holds even for internal demos with real-shaped data.

---

## 5. Why "build Phase 5 now" is correct (not premature)

Two separable things live in Phase 5:
- **Plumbing** (endpoints, agent scaffold, signal-attachment, pgvector wiring) — *painful and risky to graft into a live,
  payment-taking, patient-holding system.* Build it now, while breaking things is free. ✅ (This is the founder's stated fear, and it's valid.)
- **Model accuracy** (threshold tuning, plateau/disengagement precision) — *genuinely needs real behaviour to be good.*
  Ship with clinical heuristics as v1; the models learn/recalibrate as patients register. No later surgery required, because
  the plumbing already exists.

Result: satisfies the "don't operate on a live platform" fear **and** the "models need data" reality.

---

## 6. Open decisions for the founder (from spec §19 — do not block Phase 1)

1. **Coach role** — will an accredited non-clinical coach/dietitian deliver content under the doctor's plan (adds a role + RLS scope), or platform + doctor only? *(Affects roles/RLS; default: platform + doctor for MVP.)*
2. **AOM / anti-obesity meds** — confirm formulary; gates the obesity pharmacotherapy branch. *(Default: deferred, lifestyle-managed only, per existing CLAUDE.md decision.)*
3. **Device ingestion at pilot** — accept BP monitors / smart scales / step counters now (`source='device'`), or Phase 3-later? *(BLE clinical devices already exist; default: reuse them.)*
4. **toneGuard** — deny-list for MVP, classifier later? *(Default: deny-list now, classifier in Phase 5.)*
5. **Content authoring** — who signs off content packs, DB vs MDX? *(Default: DB `content_block` for editability + clinician review.)*

Defaults above are assumed unless the founder says otherwise; none block starting Phase 1.

---

## 7. Reconciliation notes

- **Supersedes** the 2026-07-17 "Obesity + Lifestyle Coaching pathway" build (PR #65) — those tables/UI are retired in Phase 1.
- **Un-pauses** Sprint 4 (Python ML) per explicit founder ask — update `CLAUDE.md` "Current Sprint" when Phase 5 lands.
- The existing entitlement gating (`has_feature_access('lifestyle_coaching')`, add-ons) is **kept** and re-pointed at the LPE surfaces.
- WhatsApp templates the LPE needs (reminders/nudges/results/escalation) are added to `send-pending-notifications`; note the **deployed function is stale (v13)** and needs the standing catch-up redeploy before any of these send (SMS fallback meanwhile).
```
