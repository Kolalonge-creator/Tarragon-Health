# Master Architecture Blueprint — Gap Analysis vs. Actual Build

**Status: a reference/design doc, not a build order.** On 2026-08-29 the founder pasted in a
generic, vendor-agnostic "master platform architecture" blueprint (99 numbered modules,
architecture-template style — portals, event-driven backend, orchestration/rules/workflow
engines, data platform, clinical record, search, notification, document, audit, observability,
testing, security, deployment, DR, AI governance) that was **not written with knowledge of this
codebase**. It doesn't correspond to any doc already in this repo (`FULL_SPECIFICATION_V4.md`,
`Tarragon_Health_Master_Operating_Plan_v4.md`, and the v3 `tarragon-build-spec-v3.md` all have far
fewer, differently-numbered sections). This file records, section by section, what of that
blueprint is genuinely built, partially built, or missing in the real codebase as of `main-dev`
@ `7271546a` (2026-08-29) — six research agents independently verified each area against live
code/migrations rather than trusting prior memory summaries. **Where the blueprint's ask collides
with a standing CLAUDE.md guardrail (the 8-stage referral pipeline, in particular), that's called
out explicitly — this doc does not license building past those guardrails.**

Legend: **Built** / **Partial** / **Missing** / **N/A-by-design** (blueprint concept doesn't apply
because Tarragon deliberately chose a different, equally valid shape).

---

## 1. Experience Layer & API Architecture

The blueprint frames 8 distinct portals (patient app, patient web, clinician, specialist,
pharmacy, lab, partner/institution, admin) plus a formal API-Gateway → Authn → Authz → Service →
Data pipeline.

**Reality: the capability is there, the "8 portals" framing isn't — everything lives inside one
Next.js monolith, split by role-gated routes, not separate apps/deployments.**

| Blueprint item | Verdict | Evidence |
|---|---|---|
| Patient mobile app | Built | `apps/mobile/src` (Expo), bearer-authed routes e.g. `apps/web/src/app/api/mobile/vitals/route.ts:76-83` |
| Patient web | Built | `apps/web/src/app/(dashboard)/patient/` |
| Clinician portal | Built | `apps/web/src/app/(dashboard)/clinician/` |
| Specialist portal | N/A-by-design | Merged into `clinician` account role 2026-07-31 (`roles.ts:7`) — Tiers 1-5 share one dashboard by founder decision, not a gap |
| Pharmacy portal | Partial | Real feature (`(dashboard)/pharmacist/`) but a role-gated route tree in the same app, not an independent portal |
| Laboratory portal | Partial | Two roles (`lab-partner`, `lab-liaison`), same pattern |
| Partner/institution portal | Partial | `corporate_admin`/`hmo_admin` dashboards, aggregate-only per I9; same pattern |
| Admin portal | Built | `apps/web/src/app/(dashboard)/admin/` |
| API Gateway | N/A-by-design | No standalone gateway product; Next.js routing + `apps/web/src/proxy.ts` serves as the single ingress, doing session refresh + MFA step-up + role/path authorization before handlers run (`proxy.ts:14-91`) |
| Authentication stage | Built | Per-route, not centralized: cookie-session via `proxy.ts:15`; mobile bearer via `lib/supabase/bearer.ts:13-21`; webhook signature verification via `api/wearables/webhook/[provider]/route.ts:76-79` |
| Authorization stage | Built | Layered after authn: DB-driven role check in `proxy.ts:93-95,168-172` (never JWT claims) + explicit RPC checks (`can_act_for`) + Postgres RLS as the final backstop regardless of app-code checks |

**Takeaway:** no real gap here — the blueprint's literal component names don't exist, but the
capability they describe does, just collapsed into the Next.js+Supabase pairing.

---

## 2. Event-Driven Architecture, Care Orchestration, Rules Engine, Workflow Engine

| Blueprint item | Verdict | Evidence |
|---|---|---|
| Named domain events (PatientRegistered, AbnormalResultReceived, etc.) | **Missing** | Zero matches for any of the 10 blueprint event names anywhere in `apps/web/src` or `supabase/`; no message-bus/broker product exists at all |
| Care Orchestration Engine | **Partial** | One real, fully generalized instance: `supabase/functions/abnormal-result-handler/index.ts` (trigger → draft care plan/referral → alert clinician → force-escalating patient notification). **Not generalized** — the parallel BP/SpO2/temperature red-flag engines only insert alerts, they never draft a care plan or run a review loop |
| Rules Engine | **Built** | `alert_rules` table (`20260828013011`) is genuinely versioned, jsonb-configured, Clinical-Director-signed, and in **live runtime use** across 15 alert types (`private.alert_rule_config()` called from 3+ migrations). Same governed pattern for `escalation_slas`, `cv_risk_config`, `protocol_versions`. Caveat: alert *severity* itself stays hardcoded in trigger logic by deliberate design ("so the two can never drift") |
| Workflow Engine (durable, long-running) | **Partial** | One real timeout-driven ladder exists: `private.escalate_unacknowledged_clinician_alerts()` (pg_cron, 3-hop escalation). The referral pipeline (`referral_status` enum, 8 values) is a **status column, not a state machine** — no cron job nudges a stuck referral forward, no wait-for-acceptance/appointment/report chaining |

**⚠️ Direct guardrail collision:** the blueprint's referral example (accept → appointment →
consultation → report → follow-up) is exactly the "full specialist-matching engine + 8-stage
referral-status pipeline" that CLAUDE.md's Clinical Tier Ladder section lists as **Phase 2/3 —
never build functional code for this without an explicit ask**. Do not use this blueprint as
justification to build it.

---

## 3. Data Platform, Clinical Record, Search, Single Patient Graph

| Blueprint item | Verdict | Evidence |
|---|---|---|
| Transactional DB → Event stream → Analytics platform | **Missing** | No separate OLAP/warehouse/BI layer anywhere; the `(dashboard)/analytics/` feature queries the same transactional Postgres directly; `patient_timeline` is an append-only log table feeding UI, not a pipeline into a separate store |
| Clinical record (observations/conditions/meds/encounters/care plans/orders/results/referrals/provenance) | **Partial, more built than expected** | Conditions/problem-list **built 2026-08-27** (`patient_conditions`); care plans built; provenance pervasive + a platform-wide correction trail added 2026-08-27; medications/orders/results/referrals all real. **Encounters are narrow** (only `video_consultations`, no generic clinical-notes/encounter model). **Imaging is mostly missing** (ECG-only 3-table pipeline, nothing generic) |
| Search (patients/conditions/meds/results/referrals) | **Partial** | Patient-directory name search exists (`clinician/patients/page.tsx`, `ilike` on `full_name`, RLS via `is_org_staff`) — but permission model is **org-boundary only**, not per-clinician-assignment (any org-staff account sees the whole roster by design, for cross-coverage). Zero search exists across conditions, medications, results, or referrals |
| "Single Patient Graph" | **Built** | Genuine FK connectivity via shared `patient_id`/`organisation_id` across ~110+ RLS-governed tables, confirmed even in the newest (2026-08-28) appointment-engine schema. No formal "episode of care" object exists though — connectivity is patient-centric, not episode-centric |

---

## 4. Notification, Document, Audit Architecture

| Blueprint item | Verdict | Evidence |
|---|---|---|
| Central notification service | **Partial** | Real central dispatch exists: `send-pending-notifications` Edge Function, one `notifications` table, a 219-key template map, a tracked critical-escalation ladder. **But**: no live DB-driven template catalog on `main-dev` (exists only on two unmerged PRs #282/#288); **two confirmed ad-hoc bypasses** that call WhatsApp/Termii directly instead of routing through the table — one of them (`abnormal-result-handler`'s own duplicate client) is used for **every non-sensitive abnormal-result patient follow-up today**; **a live bug**: three ack-timeout-escalation template keys referenced by a live trigger have zero entries in the template map — production sends have been failing (62+ and climbing per prior memory), unfixed on `main-dev` |
| Document architecture (reports/PDFs/referral letters/consent docs w/ encryption+metadata+access-control+retention) | **Partial** | Real PDF generation (health passport, reports, referral letters, lab/ECG docs, vax certificates) with genuine per-document RLS + signed URLs + real metadata. **Missing**: no field-level PHI encryption beyond Supabase's at-rest default, no retention policy, no right-to-erasure/export RPC, no export audit trail (nothing logs who downloaded which PDF when), no dedicated per-encounter consent-document entity (only versioned ToS/marketing consent exists) |
| Audit architecture (User/Action/Object/Timestamp/Reason/Result) | **Partial — missing exactly Reason and Result** | Real `audit_log` + a generic row-change trigger on 21 core tables capturing User/Action/Object/Timestamp reliably. **Reason is deliberately never captured** (migration comment: only changed column names + a row hash are stored, not values or rationale). **Result/outcome has no column at all** — the trigger only fires post-commit, so rejected/rolled-back actions leave zero trace. A couple of feature-specific tables (finance approvals, `clinician_alerts` snooze/resolution) do capture reason/outcome, but that isn't part of the central audit schema |

---

## 5. Observability, Clinical Observability, Testing, Synthetic Patients, Load Testing

| Blueprint item | Verdict | Evidence |
|---|---|---|
| General observability (uptime/latency/errors/queues/DB/integrations) | **Partial** | Sentry genuinely wired (server/edge/client configs). Uptime: 1 of 3 monitors active, 2 disabled on billing per last audit (2026-08-12, not re-verified live this pass). No queue-health, DB-health, or integration-health dashboards anywhere |
| Clinical observability (separate ops surface: overdue results, referral failures, care gaps, safety events) | **Missing** | No dedicated safety/ops dashboard exists at all. The escalation-SLA admin page is config/sign-off only, not a live monitor; the clinician escalation worklist is the same patient-workflow tool clinicians already use, not a separate engineering-observability surface |
| Testing architecture (unit/integration/e2e/security/clinical-safety/performance) | **Partial, uneven** | Unit tests real (107 TS files + 12 Python). DB/RLS integration tests strong (~70 SQL test files in `packages/db/tests`, replayed in CI). "E2E" is **mislabeled** — one Jest file hitting real infra at the API/DB level, not browser UI; **zero** browser E2E tooling (no Playwright/Cypress installed despite lockfile noise suggesting otherwise). **Zero** dedicated security test files — prior IDOR audits were manual, not a regression suite. No distinct "clinical safety testing" tier — folded into the RLS suite |
| Synthetic patient personas | **Missing as blueprint means it** | The 23 `@tarragon.test` QA accounts are role/login fixtures, not clinical personas with realistic longitudinal data run through the full platform |
| Load testing (10k→10M scale) | **Missing, plainly** | Zero load-testing tooling anywhere (no k6/Artillery/Locust). Expected and not alarming at pre-revenue/pilot stage — but the blueprint's staged-scale claim has no basis here at any tier |

---

## 6. Security, Deployment/CI-CD, DR/Data Residency, AI Architecture, Low-Bandwidth/Mobile-First

| Blueprint item | Verdict | Evidence |
|---|---|---|
| MFA | **Built** | Real self-service TOTP; AAL2 step-up genuinely enforced in `proxy.ts:59-62`, not just a settings toggle |
| Rate limiting | **Built, but on its weaker path** | Hybrid Upstash/in-memory design (`lib/rate-limit.ts`), but Upstash env vars have never been set anywhere in the repo — currently running in-memory-only (per-instance, not distributed) |
| RBAC / least privilege / audit | Built | RLS + `is_org_staff()` + row-change audit triggers, consistent with prior memory |
| Secrets management | **Missing** | No vault/secrets-manager integration anywhere; env vars only |
| Vulnerability management | **Partial** | No Dependabot/CodeQL/Snyk in CI; patching is manual pnpm `overrides` with dated CVE comments |
| Penetration testing | **Missing** | No references anywhere in docs or code |
| CI/CD | **Built (basic)** | Typecheck/lint/test/build + Python ruff/mypy/pytest + migration replay in `.github/workflows/ci.yml`; no security-scanning stage |
| Infrastructure-as-code | **Missing** | No Terraform/Pulumi/CDK anywhere; Supabase/Vercel/Cloudflare are dashboard-configured |
| Feature rollout %, canary releases | **Missing** | No feature-flag product exists; "canary" mentions found in docs are QA metaphors, not a release mechanism |
| Rollback strategy | **Partial** | New `release-integrity.yml` detects Vercel-promotion/edge-fn/migration drift post-hoc (needs secrets not confirmed added); no defined rollback runbook beyond ad hoc recoveries narrated in CLAUDE.md |
| Backups, redundancy, tested restore | **Missing** | No backup/PITR config, no DR runbook, no restore-drill scripts anywhere |
| Data residency documentation | **Partial, with a real doc-drift bug** | Documented consistently as `eu-west-1` in CLAUDE.md/`ARCHITECTURE.md`/`FEATURE_SPEC.md` — **but `CLINICAL_TRUST_MODEL_SPEC.md:92` says `af-south-1`**, contradicting every other doc. No RPO/RTO, no subprocessor list anywhere |
| AI safety layer / human-in-the-loop (for shipped flows) | Built/Partial | Real guardrails on the AI coach; the null-gated "reviewed by doctor" pattern is genuinely enforced |
| Formal AI model registry | **Missing on `main-dev`, confirmed still orphaned** | Full `ai_systems`/`ai_drift_observations`/governance schema is live only on the remote Supabase project; its migrations are absent from this checkout; wiring exists only on two **unmerged** PRs (#311, #343); zero app-code references on the current branch — matches and reconfirms the 2026-08-29 memory finding |
| Low-bandwidth retry | Built | Mobile API client retries network failures (not HTTP-error responses) with a 20s timeout, explicitly designed for Nigerian network conditions |
| Offline caching | **Partial, deliberately narrow** | Service worker caches only a navigation fallback page — API/clinical data is intentionally never cached ("stale vitals/escalations/results are a safety hazard"). No offline-first queue on mobile — a failed vitals POST just errors, it isn't queued for replay |
| Compressed assets | Partial | `next/image` used in only 9 files |
| Video→audio degradation | **Missing** | Video visits go straight through the Zoom SDK; no custom bandwidth-degradation logic |

---

## 7. Digital Health Education & Content Platform (§79)

Pasted separately from the original 99-module blueprint (2026-08-29, later the same day as the
sweep above) — it doesn't map into any of the 6 categories in sections 1–6, which is why it was
missed the first time. The platform already ships a real, comparably-scoped system for this under
a different name: **"Health Education"** (`docs/archive/HEALTH_EDUCATION_PATHWAY_SPEC.md`, status
BUILT, PR #66, first shipped 2026-07-17, extended through 2026-08-10), plus a separate DB-backed
marketing content hub (`marketing_resources`, 2026-07-23 on). Verdicts below are against that build,
not against a blank slate.

| Blueprint item (§) | Verdict | Evidence |
|---|---|---|
| §79.2 Content categories | **Partial** | `health_education_category` enum (`20260810013703`) has 14 values covering hypertension/diabetes/weight/heart/kidney/respiratory/cancer_screening/womens_health/mens_health/mental_health/nutrition/medicines/family_child/getting_started. **No distinct category for exercise, sleep, or vaccination** — that content exists as prose inside other tracks (e.g. `htn_w10_sleep_apnoea`, the `family-childhood-vaccine-schedule` row) but isn't independently browsable by topic |
| §79.3 Content formats | **Partial, mostly missing** | `health_education_content_type` enum is **`'article' \| 'video'` only** (`20260717150000_health_education.sql:30`) — no audio, infographic, interactive module, or checklist type exists anywhere. Quizzes exist only as a `knowledge_check` jsonb *embedded in* an article row, never as standalone content. "Courses" is a direct tension with a locked decision — see callout below |
| §79.4 Personalised content triggered by patient's programme | **Built, close to spec** | `health_education_feed()` (`20260717150000_health_education.sql:146`) ranks content by active `care_plans` condition + `patient_risk_scores.risk_level`; a real 12-week drip engine (`private.health_education_current_week()`, `20260723010123_health_education_drip.sql:20`) unlocks one week at a time per HTN/diabetes/obesity track — functionally the blueprint's "programme → sequence" example, just framed as an ongoing weekly drip rather than a one-time enrolment trigger |
| §79.5 Recommendation engine inputs (age / care programme / risk / current task / health literacy / language) | **Partial** | Care programme + risk: built (above). **Age: not read anywhere in the feed RPC.** **"Current task": no concept of care-journey step driving recommendations.** **Health literacy: doesn't exist** (§79.7). **Language preference: `profiles.language` exists (`en`/`pcm`/`yo`/`ha`/`ig`, `20260723201654_voice_reminders_and_language.sql:22`) but its own column comment says "in-app UI stays English for now" — `health_education_feed()`/`health_education_library()` don't read it at all** |
| §79.6 Learning pathways (e.g. "Hypertension 101," Lesson 1–5) | **Partial, tension with a locked decision** | The `drip_week` column + unlock RPC is a real in-order pathway mechanism — structurally close to what's asked. But there's no discrete named pathway object, no upfront syllabus a patient can see ("Lesson 1 of 5"), and free browsing is a *separate* RPC (`health_education_library()`, `20260810013703...sql:98`) that deliberately ignores pacing. See callout below |
| §79.7 Health-literacy self-assessment | **Missing** | No confidence-rating field, table, or UI exists anywhere in `health_education_*` or `profiles` |
| §79.8 Nigeria-specific localisation (diet, food availability, cultural practice, access, terminology, affordability) | **Built, genuinely strong** | This is the platform's best-covered item in the whole module. Shipped content routinely names Nigerian foods and habits directly (suya spice mixes, unripe plantain, groundnuts, seasoning cubes vs. table salt, "Nigerian diets... fall short" framing) rather than generic dietary advice — see `20260730115924_health_education_12_week_priority_curricula.sql` and the `marketing_resources` seed rows |
| §79.9 Multi-language architecture (English/Pidgin/major Nigerian languages) | **Partial — the precedent exists, content doesn't** | `profiles.language` (`en`/`pcm`/`yo`/`ha`/`ig`) is exactly the value set this item asks for, but it was built for **reminder/notification text only** and isn't fully wired even there (per its own migration comment, the send path doesn't yet fetch `language`). Zero `health_education_content`/`marketing_resources` rows have a translated variant; the schema has no locale column or translation-table pattern at all |
| §79.10 Clinical governance fields (author, reviewer, approval date, review date, version, source, status) | **Partial, mostly missing** | Today: `clinician_reviewed` bool + `reviewed_by_name` text + `reviewed_at` timestamp + `is_active` bool — explicitly documented as a "thin slice," not full governance (`HEALTH_EDUCATION_PATHWAY_SPEC.md` §6). **Missing:** `author`, `version`, `next_review_due`, `source`/citation, and any real `status` beyond the `is_active` on/off switch |
| §79.11 Content lifecycle (Draft → Clinical review → Approved → Published → Review due → Updated) | **Missing** | No state machine exists. Content becomes live the moment a migration/seed inserts it; the admin surface (`health-education-manager.tsx`) only toggles `is_active` and edits the review badge — there is no draft/staging state, and nothing tracks "due for re-review" |
| §79.12 Outdated-content detection when guidance changes | **Missing** | `condition_protocols`/`protocol_versions` are genuinely versioned and Clinical-Director-signed (§2 above) — but nothing links a protocol version to the `health_education_content` rows that describe it, so a protocol change today flags zero content for re-review |
| §79.13 Care-event-triggered education (post-medication-change, post-abnormal-result) | **Missing as a push; the hook point already exists** | The feed is pull-based (condition+risk gates visibility), not event-triggered — no "medication changed → surface this article now" or "abnormal cholesterol → recommend this content" wiring exists. The natural integration point is the abnormal-result-handler Edge Function, which is real and already the platform's central event pipeline (§2, §4 above) |
| §79.14 Behaviour-change content (learn → set goal → track) | **Partial, deliberately not in this schema — tension with a locked decision** | `HEALTH_EDUCATION_PATHWAY_SPEC.md` §1 locked decision #2 explicitly rejected a "behaviour changed" flag as an unverifiable claim; impact is meant to be read from existing adherence/vitals signals instead. A real, separate goal/tracking piece exists (the sodium daily-budget-meter + food-swap build, 2026-08-10) that could satisfy the practical intent — but per memory it's **committed to a branch, not merged to `main-dev`**, and isn't wired to health-education content at all today |

> **⚠️ Two items above collide with a locked founder decision, not just an unbuilt feature —
> flagging for a decision, not silently building past it.** `HEALTH_EDUCATION_PATHWAY_SPEC.md` §1
> explicitly rejected the founder's own earlier "funnel" sketch (condition → education → video →
> article → behaviour change → knowledge assessment) in favour of a personalised loop, and locked
> "behaviour change is NOT a schema concept" as decision #2. §79.3's "courses" and §79.6's
> "Lesson 1–5" pathway, and §79.14's learn→goal→track loop, are close to re-proposing exactly what
> was turned down. That doesn't mean the blueprint is wrong — a real syllabus view or a wired
> goal-tracking loop could be genuinely good product — but it should go back to the founder as an
> explicit reversal-or-confirm decision before anyone builds either, not get built as a quiet
> reinterpretation of the existing loop design.

**If the founder wants to close these gaps, in a sane build order:**
1. **Decide the two collisions first** (courses/pathway-syllabus vs. the loop design; goal-tracking
   wired to education vs. staying a separate system) — everything else can be built either way, but
   building content-format/pathway work before this is decided risks throwing it away.
2. **§79.9 language** — wire `health_education_feed()`/`library()` to `profiles.language` and add a
   translations table; the value set and precedent already exist, so this is the cheapest real gap.
3. **§79.10/§79.11 governance + lifecycle** — add `author`/`version`/`next_review_due`/`source`
   columns and a real `status` enum; low risk, additive, and unblocks §79.12.
4. **§79.12 protocol-change → content flag** — once §79.11 exists, link `protocol_versions` to
   affected `health_education_content` rows so a signed protocol change opens a re-review task.
5. **§79.13 event-triggered surfacing** — hook the abnormal-result-handler (and a medication-change
   equivalent) to recommend a specific content row, reusing the existing notification path.
6. **§79.7 health-literacy self-assessment** — cheap, additive, engagement-only; must not touch
   `patient_risk_scores` or escalation, per the same locked decision #1 that gates knowledge-check
   scores today.
7. **§79.2/§79.3 category + format expansion** — exercise/sleep/vaccination as real categories;
   audio/infographic content types — only after (1)–(6), since format/taxonomy churn is cheapest
   to redo once, not repeatedly.

---

## Bottom line

Most of what the blueprint calls "architecture" already exists in a Nigerian-pragmatic,
Postgres-and-Next.js-native shape rather than the blueprint's generic microservices/event-bus
shape — that's a deliberate, sound trade-off given Stack A, not something to chase into
conformance. The handful of items worth real founder attention, in priority order:

1. **Live production bug** — three clinician-alert ack-timeout-escalation template keys are
   missing from the notification template map; sends have been failing since the escalation
   ladder shipped 2026-08-28 (~62+ failures and climbing per prior tracking).
2. **Audit trail can't answer "why" or "did it succeed"** — Reason and Result are structurally
   absent from the central audit schema; only User/Action/Object/Timestamp are captured.
3. **Data-residency doc contradiction** — `CLINICAL_TRUST_MODEL_SPEC.md` says `af-south-1`, every
   other doc says `eu-west-1` (the actual region). Compliance-adjacent doc; worth a one-line fix.
4. **Notification architecture has real bypasses** — the abnormal-result pipeline (the platform's
   single highest-priority business event) runs its own duplicate WhatsApp/Termii client instead
   of the central `notifications` table path everything else uses.
5. **AI governance schema is still fully built but fully orphaned** — two real PRs (#311, #343)
   sitting unmerged; the underlying schema is live on the remote project with no app code pointed
   at it at all.

Everything else — the missing analytics warehouse, formal event bus, browser E2E suite, IaC,
canary releases, DR drills, AI model registry, load testing at scale — is a legitimate absence
for a pre-revenue/pilot-stage platform and matches this project's own phased-build discipline
(see CLAUDE.md's Phase 2/3 gates). None of it should be built off the back of this blueprint
alone; it needs the same explicit-ask discipline as everything else in the Clinical Tier Ladder
section.
