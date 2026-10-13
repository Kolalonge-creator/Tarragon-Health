# S85 to S87: review, competitor comparison and build plan

Date: 2026-10-07. Evidence base: the three session prompts, `docs/BUILD-SPEC-v5.md` D.7, D.8, Part C and the invariants, three read-only audits of `origin/main-dev` at `60c843718` (code and migrations only, nothing run, no live row counts), `docs/DECISIONS.md` (D-14), `docs/OPEN-QUESTIONS.md`, and a light check of public competitor pages. Competitor statements are vendor or press claims, not verified in product.

## 0. Scope correction

**There is no S88, S89 or S90.** `00-INDEX.md` says "Total sessions: 90" because S01 has four rows. The index ends at S87. This plan covers S85, S86 and S87, the three cross-cutting sessions that follow the S82 to S84 audits.

All three depend on S40, and S40 is not passed (see the Stage 1 sign-off draft). Every one of these sessions starts with "if a dependency is not marked done, tell me". So the plan below says what can start now and what must wait.

## 1. Headline findings

1. **S86 as written contradicts a founder decision.** D-14 (2026-10-06) made the product English only and removed Pidgin, Yoruba, Hausa and Igbo, because strings were machine or session written and never reviewed by a native speaker or clinician. The S86 prompt and spec D.8 still say "add `yo`, `ha`, `ig`" and the shared rules still say "(en, pcm)". D-14 itself allows a return only with "a native reviewer and a clinician-signed translation process". So S86 should build that process in dormant form and ship no language.
2. **S85 cannot be completed as written, because most of what the journeys touch is not built.** No Health Points (S58), no symptom checker module (S59/S60, only precursors), no consultation directory (S64), no cohort-code redemption or institution console (S79), no PHQ-9 event, no wearable event, no pregnancy event. Journey 3 is blocked outright. Journey 2 is the most buildable. The prompt's own wording, "across all modules built so far", supports an incremental harness, not a finished suite.
3. **The D.7.2 event map is mostly aspiration today.** Of 10 rows: 2 wired end to end (BP/glucose logged; payment completed, but its only subscriber is lead assignment, not entitlement), 4 partial (symptom check, consultation completed, lab result, silence), 4 missing (dose confirmed/missed, wearable synced, mood/PHQ-9, pregnancy recorded). Thirteen event types are seeded and only 7 subscribers exist. `dose.recorded`, `dose.missed` and `silence.detected` are seeded types with no emitter.
4. **The existing E2E layer has never been proven.** `apps/web/e2e-browser` specs were written without Docker and "never executed". Maestro flows are "written, NOT run" and not in CI (CI only lints the YAML). The live smoke workflow needs three secrets that are not set. The README says `db reset` replays a `seed.sql` that does not exist in the repo. `is_test` is not used by any web E2E spec.
5. **S87 has real conflicts to report, not a clean bill.** No `docs/audit-partC.md` exists. Findings in section 5. Most are already in OPEN-QUESTIONS, but three are not framed as Part C breaches (salaried clinicians, the live fertile-window display, patient SMS paths still open).
6. **Two spec statements are stale and should be recorded, not built to.** D.8 (languages) and C.2 "Salaried clinicians: freelance only" (the founder decided on 2026-09-30 that employed doctors exist, with pushed tasks).

## 2. Competitor comparison

The task asks for comparison with full products. The relevant comparison per session is different.

### S85: the journeys against full products

| Journey | Closest full products | What they do | Tarragon position | Build consequence |
|---|---|---|---|---|
| 1 First month | Omada, Noom, Personify | Onboarding, connected device, coached feedback loop, points and streaks. Omada pairs a cellular BP cuff and scale with a care team and uploads readings automatically (Omada public material). Noom's trial funnel drew a $56M settlement over auto-renewal and hard cancel | Tarragon has the safer commercial model (pay per item, no auto-renew) but Health Points (S58) and cohort-code onboarding are not built, so day 30 cannot be tested | Test the buildable spine (signup, risk questionnaire, entitlement, daily BP, silence nudge). Mark points and care-pack offer as pending steps, not skipped silently |
| 2 Red reading at night | Omada hypertension, Livongo/Teladoc BP, Luscii/Doccla (virtual ward, removed by C.2) | Alerting a care team on a dangerous reading, usually during staffed hours or via an escalation queue | Tarragon's chain (reading, deterministic triage, queue, paging, Care Circle push) is largely built and is the strongest differentiator: no model in the path (INV-01). The 2 am offline guidance and on-call page are exactly what is least proven | Highest value test. Build first. Assert guidance with no network, page created, no AI call, audit trail |
| 3 Symptom to treatment | Ada, K Health, Buoy, Babylon (lesson), Practo, Vezeeta | Structured symptom check, urgency grade, then book or async consult, e-prescription, pharmacy fulfilment | Tarragon plans likely causes with commonness, an urgency grade, async consult, test, prescription to a partner pharmacy for collection and a monthly accuracy audit. None of S59, S60, S64 exist, and the pharmacy flow is a pay-through-Tarragon order, not "send for collection" (OQ-272/281) | Blocked. Write the journey as a contract test skeleton now (typed steps, all pending), turn steps on as S59/S60/S64 land |
| 4 Employer programme | Personify Health, Omada, Virgin Pulse style employer platforms | Cohort code enrolment, sponsored entitlements, aggregate-only reporting | Aggregate-only and no reproductive or mental health data is the right line (C.1, Ovia lesson). `sponsor_cohorts` exists (s38e), redemption and institution console do not | Test the privacy property first: a cohort of 300 never exposes an individual or a sensitive category, including small-cell suppression |

What full products do that the journeys do not yet cover: Omada-style coach continuity, Practo/Vezeeta slot and language filters, Eka Care record import. These are not S85 scope; they belong to their modules.

### S86: languages against full products

- **Practo** launched consultations in 15 Indian languages by matching users to doctors who speak their language, not by translating clinical content (public announcement, 2021). That is the safest model for Tarragon today and it needs no translated clinical strings. Tarragon already holds a free-text clinician `languages` field (kept by D-14).
- **Healthily, Ada, Infermedica** publish clinically reviewed content per market. Translation is reviewed content, versioned, dated and owned (D.4), which is what Tarragon's own governance already demands.
- **Practical finding from the audit:** Tarragon already has two review-gate patterns that a language framework can reuse instead of inventing a third: `clinical-wording.json` (current, proposed, signed by, on, version) and the audio manifest (per clip, per language, sha256, approvals, script hash that drops sign-offs when the script changes).

### S87: Part C against full products

The Part C list is already derived from competitor failures: Flo (FTC 2021, health data shared with advertising and analytics firms), Noom (auto-renewal and hard cancel, $56M cash plus $6M credits), Ovia (employer visibility), Strava (public exposure), Yazio/Lifesum (fasting timers). The right S87 posture is the same discipline those cases enforce: **an automated, standing check, not a one-off document.** A one-time scan goes stale within a week at this team's merge rate.

## 3. Recommended builds

### S87: Part C conformance, as a standing scan (build first)

Why first: smallest, read-only against production behaviour, and it produces the founder decisions the rest depends on.

1. `docs/audit-partC.md`: one row per Part C item (C.1 twelve, C.2 eleven), status CLEAN, CONFLICT or DORMANT, evidence `file:line`, linked OQ id, owner decision needed. Seed it from the findings in section 5, then re-verify each CLEAN with a second method (schema query for live tables, not only grep).
2. A **repo scan test** next to the existing PROPOSED-config scan (`packages/shared/src/proposed-config`): fails on new occurrences of banned terms in code, schema and marketing copy (WhatsApp, wallet or stored balance, auto-renew, fasting timer, leaderboard, ad SDK package names, "Helemed", "instant doctor", "cure"). Each known conflict is an **allowlist entry with an OQ id and an expiry**, so the list can only shrink. A new violation or an expired entry fails CI.
3. A **live schema check** (a SQL proof in `packages/db/tests`, registered in `ci.manifest`): no table or column matches stored-balance patterns; the delivery and plan-subscription objects are enumerated and counted so removal is provable.
4. A line in `docs/OPEN-QUESTIONS.md` for each conflict not already there. Delete nothing in production (the prompt forbids it).
5. A sabotage step: add one banned string, confirm the scan fails, remove it.

Not scanned yet and must be in the first pass: employer reporting for reproductive, pregnancy or mental health data (C.1 last row); the scribe patient-summary path (is any AI output patient-visible without a signature, INV-11); `partner-map.tsx` (confirm it shows no patient data); `escalation_slas` v8 still listing a WhatsApp hop (OQ-198).

### S86: a dormant language-readiness framework (build second, small)

Constraint: D-14. No language ships. No `LOCALES` change in production code. No DB constraint is widened.

1. **Language registry as config, not schema.** A versioned config (PROPOSED values rule applies) with per-language status: `draft`, `native_reviewed`, `clinician_signed`, `enabled_for` (a list of feature keys). Default state: only `en` enabled everywhere. Registry changes need a CMO signature through the existing sign-off route, never an agent.
2. **Coverage and review report** (a script, run in CI): per language and per feature, share of keys present, share reviewed, share signed, audio paired. Reuses the `clinical-wording` signed pattern and the audio manifest approvals; do not create a third review mechanism.
3. **Build-time parity gate.** The existing jest parity test already iterates `LOCALES`. Add a type-level check and a check that a language cannot appear in the enabled list unless every key and audio clip for the enabled features is signed.
4. **Generalise the English-only assumptions**: `AudioScript { en }`, the audio import and ingest scripts, and the language list used by the first-screen picker (which must list only enabled languages, so with one enabled language it should render nothing).
5. **Dry run with a stub language** exactly as the prompt asks, but **test-only**: a fixture locale (for example `xx`) injected by the test harness, never exported from production config. Prove: missing key fails the gate; an unsigned string cannot be enabled; fallback to English works; the picker hides it; audio pairing fails on a hash mismatch.
6. **Language-matched consultation** as the near-term answer to "serve a Yoruba, Hausa or Igbo speaker" (the Practo approach): surface the clinician `languages` field in matching later (S64), with no translated clinical strings. Record this as the recommended path in the design note, not as a build item here.
7. **Docs**: mark spec D.8 as superseded by D-14 in `docs/DECISIONS.md`; update the shared rules text (en only); add the return conditions from D-14 as a checklist.

No migration, no new table, no UI beyond the picker rule. If the founder prefers, this whole session can be reduced to items 1, 2 and 7.

### S85: end-to-end journeys, incremental (build third, journey 2 first)

1. **Event-map conformance test** (replaces the prompt's "verify D.7.2 against the real bus"): a table-driven test, one row per D.7.2 event, asserting event type exists, an emitter exists, a subscriber exists and a downstream effect is recorded. Rows that fail today are listed in an **expected-gap registry** with the owning session (dose events: S53/S54, wearable: S70, PHQ-9: S56/S57, pregnancy: S67, silence: S26 or S10 follow-up). The registry may only shrink; a gap that starts passing must be removed from it.
2. **Shared harness**: seed script (`supabase/seed.sql` does not exist, create it or a test-only equivalent), `is_test` on every created row, local Supabase stack, deterministic clock, a bus drain helper (run `process-events` synchronously instead of waiting for the 15 second cron), a notification capture stub.
3. **Journey 2 first, full depth.** Log 190/120 with a headache offline-capable, assert: guidance appears with the network off; the deterministic grade comes from the approved `bp_care_triage` rule set (read the approved version, do not hard code a grade; see open question below); queue item and page raised; consented Care Circle contact receives a push (S29 exists); no model call recorded (INV-01); audit rows written; follow-up task created. Steps for auto-booked follow-up consult and outcomes snapshot are marked pending until built (S38 is on an unmerged branch).
4. **Journey 1 as a spine test**: phone signup and code, goals, risk questionnaire, screening due, booking and checkout through Paystack test mode, result release with the clinician hold on an abnormal value, daily readings, silence nudge. Health Points and the care-pack offer are pending steps.
5. **Journey 4 as a privacy property test**: enrol a 300 person cohort in fixtures, assert the institution view returns aggregates only, suppresses small cells, and contains no reproductive or mental health rows (C.1, INV for institutions). Redemption by code is pending until S79.
6. **Journey 3 as a typed skeleton**: every step declared, all pending, so S59, S60, S64 and S54 each turn steps on rather than writing a new suite.
7. **Pending-step mechanism**: a step is `pending(owner_session)`, shown in the test report and counted. A journey cannot be reported "passing" while any step is pending. This makes the harness honest about what the platform does not do yet.
8. **Run real**: Playwright on the local stack in CI (the `e2e-browser` job exists) and Maestro on at least one Android and one iOS run before the session closes. The prompt says "Maestro and Playwright". The audit found Maestro flows are written and not run, so running them once is part of the work, not an extra.

## 4. Order, dependencies and effort

| Order | Session | Can start now | Blocked by | Rough size |
|---|---|---|---|---|
| 1 | S87 scan + audit doc | Yes (read-only, plus a scan test and one SQL proof) | S40 gate wording only | Small, one session |
| 2 | S86 dormant framework | Yes if founder accepts "ship nothing" | Founder decision A below | Small to medium |
| 3 | S85 harness, event conformance, journey 2 | Harness and event test yes; journey 2 yes | S40 pass; S12, S16, S19, S29 (merged or live) | Medium |
| 4 | S85 journeys 1 and 4 | Partly | S58, S79 for the pending steps | Medium |
| 5 | S85 journey 3 | Skeleton only | S59, S60, S64, S54 | Skeleton small, full later |

Merge hygiene: the checkout is 136 commits behind `origin/main-dev` and sits on the S38 branch. Do all three sessions from fresh worktrees off `origin/main-dev`, one per session.

## 5. S87 first-pass findings (to verify, then write into the audit doc)

Method note: targeted greps, so CLEAN means no hits, not proven absent.

| Part C item | Status | Evidence | In OPEN-QUESTIONS |
|---|---|---|---|
| Cycle-based contraception | CONFLICT | Fertile window shaded in `patient/cycle/cycle-ring.tsx:84` and `cycle-calendar.tsx:155-242`, no "not contraception" label found | OQ-12 decided 2026-09-30, not yet built |
| Automated dose changes | CLEAN | Drafts signed by a prescriber (`care-plan-changes-panel.tsx:64`) | n/a |
| Ads, sale of data, public feeds, fasting timers, face/voice scores, skin scores, virtual ward, discreet lines, "Helemed" | CLEAN | no hits | none needed |
| AI as therapy | CLEAN | therapy page is a practitioner directory, crisis notice first | none needed |
| Auto-renewing and subscriptions | DORMANT | Paystack webhook still handles `subscription`, `add_on`, `sponsored_subscription`; GBP and USD allowed; `public.subscriptions` table exists; marketing says "Nothing auto-renews" | OQ-97 |
| Wallet and Platform Credit | DORMANT (code only) | Tables dropped; a refund branch remains in `paystack-webhook/handler.ts:756` | Platform Credit removal not logged as an OQ |
| WhatsApp | CLEAN in code, conflict in text | 12 immutable `consent_versions` rows name WhatsApp; `escalation_slas` v8 lists it | OQ-29, OQ-31, OQ-198 |
| SMS beyond codes and paging | CONFLICT | push-failure fallback to sms; `sendPatientLinkSms` ("by SMS") in the virtual review button; broadcast composer SMS channel; emergency-contact SMS; 59 SMS templates | OQ-05, OQ-32, OQ-48, OQ-92 (decision looks open) |
| Pharmacy delivery | DORMANT | delivery attempts, logistics partners, delivery fee, courier screen in `clinician/orders/page.tsx` | OQ-16, OQ-272, OQ-281 |
| Therapist matching | CLEAN with dormant schema | alphabetical directory, no ranking | OQ-16 |
| Subscriptions at launch | DORMANT | no on/off flag found | OQ-97 |
| Patient-facing AI scribe | UNVERIFIED | `scribe.patientSummary` flows into clinician note flow | OQ-210, OQ-211 do not frame it as Part C |
| Salaried clinicians | CONFLICT (spec vs decision) | `employment_type` employed or contracted; "paid by salary" copy in four earnings views | founder decision 2026-09-30; not flagged as Part C |
| Employer visibility of sensitive data | NOT SCANNED | | |

## 6. Decisions needed from the founder

A. **S86 scope.** Recommended: dormant framework plus a test-only stub language, no shipped language, spec D.8 marked superseded. Alternative: skip S86 entirely until a native reviewer exists.
B. **Salaried clinicians.** Record as a spec update (C.2 row reflects the 2026-09-30 decision), or treat as a conflict to remove. Recommended: update the spec row, keep the code.
C. **SMS paths still open** (OQ-32, OQ-48, OQ-92). The S87 scan will fail on them unless allowlisted with an expiry. Recommended: allowlist with a 30 day expiry and decide each.
D. **Journey 2 grade for 190/120 with headache.** The CMO-approved rule set decides it, and the S11c decision asks the emergency-symptom question at 200/130. The journey text says "grades red". Confirm which rule version is approved and what the expected grade and offline guidance are, so the test asserts the signed rule, not an assumption. Agents must not sign or choose it.
E. **Does S85 wait for S40?** Recommended: build the harness and event conformance now (they help close S40), but do not write "journeys pass" in `BUILD-PROGRESS.md` until S40 is done and no step is pending.

## 7. Risks and guardrails

- A journey test that hard-codes a clinical grade or wording can pass while the signed rule differs. Read the approved config.
- Seeding through the service role bypasses RLS. Journey tests must also include at least one real signed-in session per role, or they prove nothing about access.
- The event conformance test must count a subscriber that exists in the migration but is missing from `process-events/handlers.ts` as broken (the audit did not confirm the keys match).
- Do not add `yo`, `ha`, `ig` or `pcm` anywhere, including test fixtures that touch production constraints. The stub locale stays outside production exports.
- Every new table needs RLS tests. This plan proposes no new table.
- Never write "Stage 1 complete" or sign any clinical config as an agent.
