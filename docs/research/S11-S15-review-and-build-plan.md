# S11 to S15: review, competitor comparison and build plan

Date: 2026-10-07. Branch context: `s38/outcome-snapshots-analytics` (local checkout is 172 commits behind `origin/main-dev`; repo facts below were read from `origin/main-dev`, live facts from the production database and edge function list, read only).
Scope: S11 (triage engine), S12 (triage wiring), S13 (notifications framework), S14 (provider adapters), S15 (clinician network and credentialing).

Status: DRAFT for founder decision. Nothing here is approved, signed, applied or started.

Evidence base: the five session prompts, `docs/BUILD-PROGRESS.md` entries, `docs/OPEN-QUESTIONS.md`, existing `docs/research/S11..S15.md`, read-only SQL against project `koiplnmbgnqnbywhpjlf`, the live edge function list, and two web research passes today. **The web passes were 10 and about 8 standard searches, search snippets only, no pages opened.** Competitor facts are therefore vendor claims or secondary summaries unless labelled otherwise, and "not found" means "not searched or not surfaced", not "absent".

---

## 1. Headline findings

1. **S11 to S15 are all built, applied and deployed.** Live: `bp_care_triage` v3 approved (v1, v2 retired), subscribers `triage.grade_observation`, `queue.create_from_triage`, `paging.create_from_triage` active, S13 and S13b migrations applied, `send-pending-notifications` v89, `process-events` v11, `expo-push-receipts`, `resend-webhook` deployed, cron jobs for events, rechecks, push-email fallback and credential expiry all running. The old doc claims "NOT applied" (S13, S15) are out of date.
2. **The pipeline has never graded a real reading in production.** `triage_events` = 0, `clinical_tasks` = 0, `domain_event_deliveries` = 0. The 7 live BP readings are dated 16 to 18 September, before the engine existed, and there are 7 patient accounts. Unit, parity and rolled-back DB proofs are strong, but there is no live end-to-end evidence and no canary that would tell anyone if the chain silently broke. This is the single biggest risk in the set, and it is exactly the "silent disable looks like empty result" failure this project has hit before.
3. **The engine covers blood pressure only.** Glucose red flags, pulse, SpO2 and temperature are still decided by older live triggers and by `apps/mobile/src/lib/glucose-red-flags.ts` with their own bands. Two or three deterministic lists can disagree about the same patient (INV-01 spirit, and OQ-67 / OQ-88 for BP). Tarragon sells a diabetes pathway, so this is a real product gap, not polish.
4. **The legacy BP path and the new engine still run side by side.** Shadow mode ended when the CMO approved v3 (2026-10-07). I did not verify whether the live bands (`private.classify_bp_level`, `vitals_readings_bp_red_flag`) were retired, so a reading may page twice with two grades. The S12b divergence report exists to answer this and nobody has recorded running it on live data (there is almost none).
5. **A deploy-order trap already bit this set once.** v1 was re-approved over v2 on 2026-10-06 and silently retired the CMO's decisions; fixed by v3 plus a "never older" guard (#1012). Two further functions were clobbered the same way (`handle_symptom_red_flag`). The pattern to design against: approval mutations without monotonic guards, and rewriting a many-times-rewritten function from an old copy.
6. **Leftover WhatsApp surface in production.** Edge functions `whatsapp-webhook` (v28) and `send-support-reply` (v25) are still ACTIVE, although WhatsApp was removed (F-02, S01c) and CLAUDE.md says they were deleted. Verify and remove or confirm dormant.
7. **S14 is an interface layer with partial adoption.** Consumers exist (consultation room, commerce tests, notifications). The live Paystack and Zoom code in `apps/web/src/lib` was deliberately not migrated. Nothing has run against a real Paystack, Zoom or Resend sandbox from this layer. What mature payment stacks add on top (event inbox with replay, settlement reconciliation, reversal-after-success handling, failover) is not in S14's scope and needs an owner.
8. **S15 is functionally complete but the roster is tiny and under-evidenced.** 3 `clinical_staff` (2 active), 1 application (offboarded, a test run), no licence or indemnity dates for the two active clinicians (OQ-109), two credential ladders (OQ-100), document purge built but switched off (OQ-108), no external identity verification vendor, no patient-facing verified profile.
9. **Phone-side proof is missing across the set.** Nothing in S11 to S13 has run on Hermes or a real phone. Safety case 1 ("offline red under one second") was proved in Node and Jest-Expo only, and the phone gets the 2026-10-07 signed EMG/TRI wording only after an OTA that has not been published.

---

## 2. Function-by-function status (built vs the spec, then gaps)

Legend: Built / Partial / Missing. "Evidence" is where I confirmed it.

### S11 Triage engine (`packages/clinical`)

| Function | Status | Gap |
|---|---|---|
| Pure deterministic `grade()`, validation, recheck, task keys | Built (180+ tests, 100 percent branch) | None found |
| Rule set as data (`triage_rule_sets`), CMO-only approval, immutable once approved | Built, live v3 | Approval now has a "never older" guard (20261007152136). No dual-control on approval (OQ-107 pattern not applied here) |
| Safety cases 1 to 7, 20, device/server parity | Built (45 shared fixtures) | Parity proven in Node and Jest-Expo, not Hermes |
| Clinical coverage | **Partial: BP only** | Glucose, pulse, SpO2, temperature, symptom-only are outside the engine (finding 3) |
| Pregnancy and children | Partial: routes to clinician (BP-P1, P2) | Check the pregnancy red line against current guidance (see 3a); Pidgin safety strings moot since D-14 |
| Wording | Built: EMG/TRI signed by founder 2026-10-07 (#989) | Founder signed, not CMO; CMO can re-sign by raising version |

### S12 Triage wiring

| Function | Status | Gap |
|---|---|---|
| `triage_events`, `triage.graded`, repeat prompt, 15 minute fallback sweep | Built, live | **Zero live events** (finding 2) |
| On-device red guidance offline, 600 ms budget | Built in tests | No real-device timing |
| Stale guidance warning, cuff type | Built (S12b) | `cuff_type` not shown in observation context |
| Shadow divergence report | Built | No console screen (S37 owns), never run on real data |
| Symptom-only, silence, adherence triggers | **Missing (OQ-89)** | Waits on S26 care packs and S19 |
| Patient closes the loop ("I went / I called") | **Missing** | Not in spec; see 3b |

### S13 Notifications framework

| Function | Status | Gap |
|---|---|---|
| Keyed templates, INV-07 lint (data list + trigger + tests) | Built, applied | Free-text paths unlinted (OQ-94); two PDF attachments name the request (OQ-91) |
| Quiet hours, daily cap, discreet mode, delivery events, Expo receipts, Resend webhook | Built, deployed | 16 delivery events live; no delivery health dashboard for ops |
| Push to email fallback, "not arriving?" diagnostics (Tecno, Infinix, Itel) | Built (S13b), live | Never run on a real Tecno/Infinix/Itel handset |
| Critical delivery | Partial | Patient ladder can still end in SMS (OQ-92). No iOS Critical Alerts entitlement, no verified Android high-importance channel settings |
| Staff-side templates | Partial | Staff copy English only, some admin alert templates not in the registry (OQ-102, S13 not-done 5) |

### S14 Provider adapters

| Function | Status | Gap |
|---|---|---|
| `PaymentProvider`, `VideoProvider`, `SpeechToText`, `EmailProvider`, never-throw, mocks, contract suites | Built (156 tests) | Real-sandbox run still outstanding for all four |
| Audio-only fallback as pure function driven by config | Built | Not measured on Nigerian networks |
| Speech vendor | Interface and mock only (D-08) | No scoring on real Nigerian consult audio (OQ-96) |
| Production adoption | Partial | Legacy `lib/paystack` and `lib/zoom` coexist with the package (two paths to maintain) |
| Operational layer around the providers | **Missing** | Inbox/replay, reconciliation, reversal handling, failover (section 3c) |

### S15 Clinician network and credentialing

| Function | Status | Gap |
|---|---|---|
| Application state machine in DB, documents, checks, training, scored test, competencies | Built, live, CMO content approved and a live run passed | One test applicant only |
| Expiry notices at 90/30/0, audited grace, suspension at expiry, `clinician_is_eligible()` | Built, cron live | Two active clinicians have no dates (OQ-109) so the sweep cannot protect anything yet |
| Maker-checker on approval | Built (OQ-107, two accounts needed) | Sole founder friction |
| Licence verification | Human step with evidence; MDCN primary-source route is via DataFlow, applicant initiated | No re-verification cadence, no external ID check |
| Patient-facing verified clinician profile | **Missing** | Must be null-gated on a stored verification record and date |
| Document purge | Built, **off** until counsel sets periods (OQ-108) | Retention clock running with no deletion |
| Console location | In `apps/web` (OQ-99) | Move at S35 extraction |

---

## 3. Comparison to full competitor products

Source key: **V** vendor claim, **P** peer reviewed, **G** regulator or guideline, **S** secondary summary, **U** unverified, **NF** not found.

### 3a. S11 and S12: home reading triage and escalation

| Product / source | What the full product does | Tarragon today | Verdict |
|---|---|---|---|
| Omada (V) | Reading at or above 180 and/or 120 labelled "hypertensive crisis"; patient told to contact care team or seek care if symptomatic, otherwise re-measure then call if still high. Staff response times, offline behaviour, rule sign-off: NF | Same repeat-then-escalate shape, plus symptom override, signed rule set, offline guidance | Match on shape, ahead on governance and offline. Do not claim response-time parity: Tarragon's real constraint is doctor supply (Free plan consumes no doctor time) |
| Hello Heart (V, S) | FDA-cleared cuff, app described as not diagnostic, real-time alert on extremely high readings, "contact your physician". Human paging: NF | Equivalent patient message plus a task and page path | Match. Copy the posture "guidance, not diagnosis", not the "call your physician" dead end |
| Livongo/Teladoc, Cadence, Heartbeat, Qardio, BeatO, Dozee, Lark | Thresholds, SLAs: NF (existing S12 research found only coaching and nurse escalation exist, response times not public) | n/a | No benchmark available. Publishing Tarragon's own bands and SLAs would be a differentiator, not a catch-up |
| Nigerian and African players (Reliance, Clafiya, mDoc, WellaHealth, Kangpe, Helium) | No triage thresholds, SLAs or regulatory claims found. An Omron-supported pilot used pharmacist-dispensed drugs and remote cardiologist review (336 patients, S) | Engine, tasks, paging | No local competitor to catch up to. Risk is internal consistency, not market gap |
| WHOOP BP Insights (G) | FDA warning letter 2025-07-14 for uncleared BP estimation; closeout 2026-06-17 after the feature was modified | Cuff readings only, deterministic bands, no estimation | Keep it that way. Never grade a wearable-derived BP estimate. Get counsel on NAFDAC posture for "guidance" labelling |
| Clinician alert evidence (P, PMC8760617) | US remote monitoring: clinicians acted on 62.1% of 552 action-needed alerts; 17.4% led to a medication change | Task/queue with acknowledgement and hand-back (S16, S17, S19, S20) | Build the act-rate and time-to-acknowledge measures into the S38 analytics; alert fatigue is a measured, real effect |
| Guidance (G, S) | 2025 AHA/ACC: asymptomatic markedly elevated BP replaces "urgency"; emergency is the same level plus new organ damage. In pregnancy 160/110 or higher is severe. ISH 2020 home diagnostic 135/85. ESH 2023 home bands: NF | BP-R1/R2 symptom-led, BP-P1/P2 route pregnancy to clinician | CMO to confirm the pregnancy line against 160/110 and the wording against the 2025 "asymptomatic markedly elevated" language. Not a code change until signed |

Where Tarragon already leads (evidence is absence of public material, so directional only): on-device offline emergency guidance with a hard time budget; guided repeat with timed fallback grading; shadow mode before a clinician signs; never-older approval guard; neutral notification text; INV-01 (no model in the path).

### 3b. S13: notifications and paging

| Product / source | What the full product does | Tarragon today | Verdict |
|---|---|---|---|
| Android full-screen intent (G, Google Play policy) | Since 2025-01-22 only calling and alarm apps get it by default on Android 14+ targets; others need a user permission and a Play declaration | Not used | Do not plan on it. Use a high-importance channel and the in-app card |
| iOS Critical Alerts (V, Apple docs) | Needs an explicit entitlement request, slow approval, separate user opt-in; granted for health and safety uses | Not requested | Apply early. It is the only way to break through Focus/silent on iPhone for a red |
| OEM battery killers (V, Braze/Batch; U for Tecno/Infinix/Itel) | Mitigation = high-priority FCM, battery-exemption prompts, fallback channels. Expo community reports "ok" tickets that never arrive on Android | Receipts checked, 240 minute email fallback, make-specific steps for Tecno/Infinix/Itel | Close to a mature pattern. Missing: a real handset test and a "red not confirmed received" timer shorter than 240 minutes (routine fallback is not a critical path) |
| Paging tools (PagerDuty, Opsgenie, Spok, TigerConnect, Vocera) | Acknowledge-required, timed re-escalation ladders, on-call rotas, repeat until acked, audit trail (U: not searched, general knowledge) | S19 paging, rota, ack, escalation, S18 swap and fatigue limits | Built to the same shape. Compare after the first real page |
| Medisafe, Mayo/Epic, NHS App, Zocdoc, Babylon, MyTherapy | Discreet wording, quiet hours, fallback: NF | Discreet mode, lint, quiet hours | No claim of parity or lead |
| NDPA 2023 and GAID 2025 (G, S) | GAID issued 2025-03-20, effective 2025-09-19, DPIAs for sensitive processing, privacy by design. Notification-specific rule: NF | Lint plus discreet mode | Treat lock-screen, email subject and SMS as sensitive processing; add the notification channel to the DPIA (OQ-268 family) |

### 3c. S14: provider adapter layer

| Capability | Mature practice (source) | Tarragon today | Verdict |
|---|---|---|---|
| Paystack transfers | `reference` acts as idempotency key; `transfer.success/failed/reversed`, and a reversal can follow a success; transfer OTP can be disabled in the dashboard; webhooks retry every 3 minutes four times then hourly up to 72 hours live (V, S). Nigerian outward transfer delays reported (S) | Adapter covers initialise, verify, refund, transfer, signed webhook parse; duplicate reference maps to conflict | Needs a payout state machine with a reversal state and a decision on OTP and approval limits before any automatic doctor payout (S31 guard is OFF, correct) |
| Event inbox and replay | Store raw body, verify signature, dedupe, replay (inference) | Webhook functions exist per feature | Build one shared provider-event inbox |
| Reconciliation | Daily settlement report vs ledger with a break queue (inference) | `order-reconcile` function exists (S25); payouts S31 | Confirm it compares to the provider's settlement report, not only to verify calls |
| Failover | Secondary provider, circuit breaker (inference). Flutterwave has a resend-transfer-webhook endpoint (V) | Single provider by design | Not now. Interface makes it possible later; do not build a second rail before first revenue |
| Video | Zoom Video SDK and Agora both above 4.0 MOS at 25% loss; Agora used more bandwidth to compensate (V, hosted by Zoom, conflict of interest). Meeting SDK most featured, least customisable. A tested audio fallback across vendors: NF | Zoom Meeting SDK in the room with automatic audio fallback and real presence (S21) | Fine. The gap is measurement on Nigerian mobile networks, not the vendor |
| Speech to text | AfriSpeech-MultiBench (P preprint, Intron-affiliated authors): Intron Sahara V2 medical average WER 15.25% vs Whisper-large-v3 27.19% and Azure 24.12%; Pidgin best published about 30% WER (P) | Interface and mock; scribe consent required (INV-11); AI-017 off | Run an own gold-set evaluation before choosing. English only now (D-14), so Pidgin is moot; accent and drug-name error rates are the live risk |
| Ambient scribe consent | NHS England accepts implied consent with disclosure and right to dissent (G); ACSQHC has a scribe safety scenario (G). Per-vendor design: NF | Explicit scribe consent id required, clinician signs | Keep explicit consent. Do not import the NHS implied-consent position under NDPA |

### 3d. S15: clinician network and credentialing

| Capability | Mature practice (source) | Tarragon today | Verdict |
|---|---|---|---|
| Primary source verification | Nigeria: MDCN does it through the DataFlow portal, applicant initiated, no public register API (G). Wheel/OpenLoop appear to run it partly as staffed operations (U) | Evidence set plus human verification, ops asks MDCN where it matters (OQ-106) | Add DataFlow as a documented route and record its reference. No verified badge without a stored verification record and date |
| Continuous monitoring | US NCQA expects at least 30-day monitoring (V, S). No Nigerian equivalent database | Daily expiry sweep on dates, §29.7 provider credential monitor | Add a periodic re-check task (annual licence plus mid-year spot check) because there is no feed to monitor |
| Identity checks | Dojah wallet pricing, minimum top-up N50,000 plus VAT; Smile ID, Prembly, Youverify prices NF (V) | Manual ID document review, DPO accepts ID storage | Evaluate one vendor for NIN/BVN plus face match; store the result and vendor reference only, not the raw number/image longer than needed |
| Early-case review and ongoing evaluation | FPPE/OPPE-style (S), Teladoc/NCQA | S20 audit sample (all red and titration cases, per-clinician floor, level 1 until count met) | Already ahead of what S15 required. Needs the S35/S36 screens |
| Competency-based privileging | Tier gates per action | `credentialing_level`, competencies, `clinician_is_eligible()` | Built |
| Fatigue and cover | Included in rota practice | S18 fatigue limits, swaps, backup | Built |
| Patient-facing profile | Verified badge, specialty, languages | Missing | Build null-gated (CLAUDE.md "reviewed_by" rule applies) |

---

## 4. Decisions needed from the founder / CMO before building

| ID | Decision | Recommendation |
|---|---|---|
| D1 | Retire the legacy BP triggers now that v3 is approved, or keep both until a divergence report on real data shows parity? | Keep both until the canary (R1) and divergence report have a window of real data, then retire in one count-first migration. Needs CMO |
| D2 | Extend the engine to glucose (and later pulse, SpO2, temperature) as new rule sets | Yes, glucose first. CMO writes and signs the bands. Same shadow-then-sign flow |
| D3 | Pregnancy red line and "asymptomatic markedly elevated" wording vs 2025 AHA/ACC | CMO review only; code change after signing |
| D4 | Patient SMS as the last hop of the critical ladder (OQ-92) | End the patient ladder at email, in-app and push, keep SMS for clinicians. Needs CMO to confirm the ladder |
| D5 | Apply for iOS Critical Alerts entitlement | Yes, now. It has a lead time and no code cost |
| D6 | One identity verification vendor for clinician NIN/BVN | Pilot one on the next 5 applicants, store result only. DPO and counsel first |
| D7 | Doctor payout: keep Paystack transfer OTP on with maker-checker, or disable | Keep on. Revisit after reconciliation and reversal handling exist (R8) |
| D8 | Speech-to-text vendor | None yet. Fund a gold-set evaluation (R9) before any choice |
| D9 | Remove `whatsapp-webhook` and `send-support-reply` edge functions | Yes after a quick grep for callers |
| D10 | Fold the two credential ladders (OQ-100) | Do with the CMO, after R10, since the older policy is CMO-signed |

---

## 5. Build plan

Principle: the five sessions are built, so this wave is **prove, close gaps, retire duplicates**. Order is by safety risk, then dependency. Everything still sits behind the S40 Stage 1 gate (not yet written as passed) and the release blockers checklist. Each work package follows the usual session shape (reconcile, research, design note, build, prove, progress entry). Names are working labels, not extracted session ids.

### Wave 0: do first (small PRs, no new features)

| # | Item | Why | Proof |
|---|---|---|---|
| R0a | Read-only verification of live state: are the legacy BP bands still firing; do any live rows of `vitals_readings` after 2026-10-07 create `triage_events` | Finding 2 and 4 | Recorded in BUILD-PROGRESS with queries |
| R0b | Remove or confirm dormant `whatsapp-webhook`, `send-support-reply` | Finding 6, F-02 | Grep for callers, deploy list shows them gone |
| R0c | Request iOS Critical Alerts entitlement; document Android channel settings used for red | D5 | Entitlement request filed; channel importance asserted in a test |
| R0d | Update stale lines in BUILD-PROGRESS and OPEN-QUESTIONS (S13, S15 "not applied") | Docs mislead the next session | Doc diff |

### R1: Live canary for the clinical chain (S11 + S12 + S16 + S19 end to end)

1. A scheduled synthetic check: an `is_test` patient, a fixture red reading and a fixture amber reading entered through the real insert path every N hours; assert `triage_events` row, `clinical_tasks` row, delivery to a test clinician, and auto-clean. Alert ops and CMO on any miss.
2. A health view: time from reading to `triage.graded` to task to page, and counts of events stuck in `domain_event_deliveries`. Thresholds PROPOSED in config.
3. One manual real-phone run (the only way to prove case 1 on Hermes): offline red under one second on an Android floor phone and an iPhone, recorded.
Acceptance: canary fails when the processor is stopped (sabotage); first real production red has a recorded timeline. Size small to medium.

### R2: One source of clinical truth (D1, D2)

1. Run the S12b divergence report on a window of real data; decide D1.
2. Glucose rule set v1 in `packages/clinical` (hypo, severe hypo, DKA-suspect, hyper, symptom overrides), same engine, same fixtures format, shadow until CMO sign. Absorb `glucose-red-flags.ts` and the SQL glucose classifier behind it.
3. Drift tests: a scan that fails if any new triage band exists outside a rule set.
4. Retire legacy BP triggers with the count-first pattern, end the migration with assertion blocks.
Acceptance: the same glucose reading gets the same grade on phone, server and legacy replacement; INV-01 (no model). Needs CMO for bands. Size medium to large.

### R3: Triage coverage gaps

1. Wire symptom-only reports (S19 dependency) and silence/adherence with S26 (OQ-89).
2. Patient closure loop: an optional "I have sought care" / "I could not" response on a red, stored as an event, visible to the on-call and used to stop re-paging only when clinician-acknowledged (never auto-closes a page).
3. Show `cuff_type` in observation context and in the clinician summary.
4. CMO review of pregnancy line and wording (D3).
Size medium.

### R4: Critical notification path

1. Resolve OQ-92 per D4.
2. Red-specific delivery timer: if a critical push is not opened or receipt-confirmed within a short window (PROPOSED, minutes not hours), escalate to the next hop (email, in-app banner on next open, clinician-side outreach note). Routine 240 minute fallback unchanged.
3. Real handset matrix: Tecno, Infinix, Itel, Samsung, iPhone, with results written into the diagnostics copy.
4. Close OQ-91 (PDF attachments to signed links) and OQ-94 (lint broadcast and LLM free text at write time).
5. Notification channel added to the DPIA.
Acceptance: red delivery timeline test, lint blocks a broadcast naming a condition. Size medium.

### R5: Provider event inbox (S14 hardening)

1. One `provider_events` table (raw body, signature result, idempotency key, received/processed/failed, replay) used by Paystack, Zoom and Resend webhooks; replay admin function with audit.
2. Migrate `paystack-webhook`, `zoom-webhook`, `resend-webhook` to it behind a flag, one at a time.
3. Delete the duplicate legacy adapter paths once the package has a live sandbox run (Paystack test key, Zoom paid plan: both still with the founder).
Acceptance: duplicate delivery processed once, out of order handled, replay idempotent. Size medium.

### R6: Money rails hygiene (feeds S25, S26, S31)

1. Confirm `order-reconcile` compares against Paystack's settlement report; add a break queue with ageing.
2. Payout state machine with `reversed` after `success` (ledger entry reverses, clinician statement shows it).
3. Maker-checker on payout batches with limits (D7). No automatic doctor payout until this passes and a real test transfer has been done.
Acceptance: simulated late reversal flips the ledger; sabotage test. Size medium. Blocks: Paystack account items (OQ-97).

### R7: Video and speech evidence (S14 / S21 / S23)

1. Measure audio-fallback thresholds on real mobile networks (3G, throttled, power loss) and set the PROPOSED `video.audio_fallback` values from data.
2. Speech gold-set: 20 to 30 real, consented Nigerian consult clips, clinician-corrected, WER overall and on drug names for 2 or 3 candidates (D8). No vendor chosen by the agent.
Size small to medium, mostly founder/CMO effort for audio.

### R8: Credentialing: from built to trusted (S15)

1. Ops enters licence and indemnity dates for the two active clinicians (OQ-109); sweep then protects them.
2. MDCN DataFlow route documented as a check type, with the reference stored; annual re-verification task and a mid-year spot check.
3. Identity vendor pilot (D6), result and vendor reference only.
4. Patient-facing verified clinician profile, null-gated on a stored verification record and date; nothing shown that is not held.
5. Turn on the document purge once counsel sets periods (OQ-108).
6. Fold the two credential ladders (D10); move screens to `apps/console` at S35 extraction (OQ-99).
Acceptance: badge hidden when no record (test), sweep suspends a seeded expired clinician in a rolled-back run. Size medium.

### R9: Measurement

Add to the S38 analytics: time reading to graded, graded to task, task to acknowledgement; act rate; page-to-ack; push open rate by phone make; credential expiry coverage. These are the figures competitors do not publish and the only evidence for any later claim.

### Sequencing

1. Wave 0 immediately, in parallel. R0a decides how urgent R2 is.
2. R1 next (cheap, highest information). R4 and R5 can run in parallel with it in separate worktrees.
3. R2 after R1 has data and after D1 to D3 are answered. R3 after R2 and S19/S26 state is confirmed.
4. R6 after R5. R7 any time, depends on founder and CMO time. R8 any time; item 4 before any public clinician page.
5. All of it remains subject to the S40 gate, the release blockers (PITR, tied staff reads, erasure, DPAs, pharmacy partner) and the CMO sign-off hub.

Rough relative sizing (engineering only): R1 small to medium, R2 large, R3 medium, R4 medium, R5 medium, R6 medium, R7 small, R8 medium, R9 small.
Items needing humans, not code: CMO bands and wording (D2, D3), iOS entitlement, Paystack and Zoom account items, real handsets, consented audio, counsel on retention, DPO on ID vendor.

---

## 6. Items to log in `docs/OPEN-QUESTIONS.md` (not yet recorded)

- Zero live `triage_events`; no canary (finding 2).
- BP-only engine vs glucose and other vitals on legacy paths (finding 3, D2).
- Whether legacy BP bands still page alongside v3 (D1).
- Pregnancy line and "asymptomatic markedly elevated" wording against 2025 guidance (D3).
- `whatsapp-webhook` and `send-support-reply` still deployed (D9).
- Red-specific delivery timer (R4) and iOS Critical Alerts entitlement.
- Provider event inbox, reconciliation break queue, payout reversal state (R5, R6).
- Verified clinician badge rule and ID vendor (R8, D6).

## 7. Limits of this review

- Competitor evidence is search-snippet level from 18 or so queries; no primary page was opened. Omada and Hello Heart behaviour came from help-centre snippets. Cadence, Heartbeat, Qardio, BeatO, Dozee, Wellue, Lark, Medisafe, Zocdoc, Babylon, Epic, NHS App and the paging vendors were not surfaced. Nigerian competitors' triage was not found. The ASR benchmark is from the vendor's own authors. The video benchmark is hosted by Zoom.
- Live checks were read only and narrow (migration names, rule set status, counts, cron names, edge function list). I did not read function bodies, grants or policies, did not run the S12b divergence report, and did not check `order-reconcile` or the Paystack webhook internals.
- Repo facts come from `origin/main-dev` file listings and docs, not from running tests. The local branch is 172 commits behind.
- Nothing was run on a real phone, and no thresholds here are clinical advice. All bands and wording are for the CMO.
