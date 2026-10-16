# S11 to S15 gap analysis: what is built now vs local and international competitors, and what to add

Date: 2026-10-16. Branch `docs/s11-s15-gap-analysis` off `origin/main-dev`. Docs only. Nothing here is clinical advice, nothing is signed, applied or switched on by this document.
Supersedes for status purposes: `docs/research/S11-S15-review-and-build-plan.md` (2026-10-07), whose "BP only, nothing built, zero canary" findings are now largely overtaken by the P1 to P6 packages (merged as #1123) and FU-notify (#1164).

## 0. How to read this, and the limits of the evidence

Tags: **[V]** vendor claim, **[P]** peer reviewed, **[G]** guideline or regulator, **[NV]** not verified (secondary source, search snippet only, or my own general knowledge). "NF" means not found by me, not "absent".

Honest limits:
1. **Live database not verified.** I tried four read-only queries against project `koiplnmbgnqnbywhpjlf`; every one failed with "Connection terminated due to connection timeout" (the project's connection budget is documented as tight). So every statement about live state below comes from repo docs dated 2026-10-07 to 2026-10-16 and the migration files on `origin/main-dev`. Treat live counts (triage_events, tasks, canary runs, roster) as **[NV-live]** and re-check before quoting. The closeouts themselves say the 12 migrations were replayed in a rolled-back transaction on live, not applied; the merge of #1123 auto-applies migrations, but I could not confirm that happened or that `process-events` was redeployed first.
2. **Repo facts** were read in the worktree at `origin/main-dev` (migration files, closeouts, BUILD-PROGRESS, DECISIONS, OPEN-QUESTIONS, `packages/clinical`). I did not run tests.
3. **Web research** was about 20 standard searches plus the earlier review's 18. Mostly snippets; I did not open primary PDFs. Competitor response times, thresholds and SLAs are generally not public, so "ahead" claims on those rows rest on absence of public material and are directional only.
4. **Local competitors are thinly documented.** Almost no Nigerian vendor publishes triage thresholds, paging design, credentialing process or evaluation data. Where the "best local" cell says "NF", read it as "no evidence either way".

## 1. Executive summary

Between 2026-10-07 and 2026-10-16 the S11 to S15 set went from "built, never proven" to "built, instrumented, and extended": a 30-minute synthetic chain canary and chain health page, a glucose triage engine in shadow, a critical-alert ladder with an unconfirmed-red outreach task, a provider event inbox and settlement reconciliation, a primary-source credentialing gate, and a silence/adherence sweep. The engineering discipline (rule sets as data, signed by a human, sabotage-proven DB tests, no model in the path) is ahead of anything publicly documented by a Nigerian competitor and matches or exceeds what international vendors publish.

But almost all of it is still **unsigned, switched off, or never run outside a test**. The system has not graded a documented real patient reading end to end (by the docs), no red alert has reached a real handset in a recorded test, glucose rules are a draft, legacy and new paths still both page, and the clinician side has only push and email to wake a doctor.

**Five biggest gaps**
1. No real-world proof: no handset matrix row run, no live end-to-end timeline of a real red, canary first ticks unconfirmed.
2. Clinician paging is thin: after OQ-332 (no SMS or voice) a sleeping or offline doctor can only be reached by push and email, with one on-call and no phone-call hop. PagerDuty's own guidance is multi-channel.
3. Clinical coverage is two vitals wide and one of them is unsigned: BP (v3 signed, v4 to v6 drafts) and glucose (v1 draft, shadow). Pulse, SpO2, temperature and cross-vital deterioration remain on legacy bands; a third BP band list sits in `cds/engine.ts`.
4. Credentialing is a gate with almost no data behind it: two grandfathered clinicians (ends 2027-01-13), no identity vendor, DataFlow is applicant-initiated and slow, no continuous source of truth to monitor in Nigeria.
5. The provider layer has never touched a real Paystack, Zoom or Resend sandbox from the new code; four flags are OFF; payout GL posting is OFF; no speech vendor; fallback thresholds are not measured on handsets.

**Five best new ideas**
1. A permanent real-handset canary (a cheap Tecno or Infinix on a charger that receives a daily test red and reports receipt).
2. Shift-start test page plus acknowledge-or-escalate for every on-call clinician (proves reachability before it matters).
3. Per-patient, clinician-set, signed threshold overrides (deterministic, with `clinician_override`), to cut alert load; NEWS2 explicitly allows documented individualisation.
4. A DCB0129-style clinical safety case and hazard log per rule set plus a NAFDAC SaMD pre-submission query, because classification risk is unaddressed.
5. Assisted entry by a caregiver or partner pharmacy (attributed, consented) for patients who cannot log readings themselves, replacing the SMS/USSD route competitors use but Tarragon may not.

## 2. What is actually built now (verified in repo)

| Area | Built (file or migration evidence) | State |
|---|---|---|
| BP engine | `packages/clinical/src/engine.ts`; `bp_care_triage` v3 approved (CMO, 2026-10-07); `bp-care-v5-pregnancy`, `bp-care-v6` test files imply v4 to v6 drafts | v3 signed; later versions unsigned (BUILD-PROGRESS, hub) |
| Glucose engine | `glucose-engine.ts` + Deno twin; `glucose_care_triage` v1, 15 rules; migrations `20261013223643`, `20261014162443`, `20261014162445` | DRAFT, shadow, unsigned. CGM and wearable grading decided yes by OQ-320, status of that build not verified |
| Parity and drift | `triage_engine_parity()`, glucose divergence report, scan test for bands outside rule sets (14 allowlisted legacy files) | Built; never run over real readings |
| Chain canary and health | `20261013223401_p1_chain_canary.sql`, `20261013223824_...`, `/admin/ops/chain-health`, `/clinician/chain-health`, `canary_heartbeat()` + `GET /api/status/canary` (FU-notify) | Built; cron only ticks once a real non-test patient exists; first live tick not confirmed [NV-live]; external monitor registration is a founder step |
| Critical ladder | `20261013223633_s13r4...`: patient ladder push, email, in-app; `red_alert_watch`, 30 minute unconfirmed sweep, `red_patient_outreach` task type awaiting CMO confirmation; receipts fail the row on error; "I have sought care" answer never stops paging | Built, deployed state unverified; **no handset run** |
| SMS | FU-notify (OQ-332/333): no hop is ever sms or voice; emergency-contact SMS removed; INV-08 trigger untouched | Decided and built |
| Paging, tasks | S16 tasks, S18 rota/fatigue/swaps, S19 paging with ack and escalation, S20 audit sample | Built earlier; one real-world on-call shape untested |
| Coverage sweeps | P6 `triage-coverage-daily` (silence BP-A5 at 7 days, adherence BP-A4 at 80%), symptom-only shadow bridge | Cron born OFF |
| Provider layer | `provider_events` inbox, `settlement-reconcile`, payout reversal + GL (flag), maker-checker batches (flag), circuit breaker (flag), `/admin/ops/providers`, ASR gold-set harness, drug and number highlight, scribe consent enforced in DB | 4 flags OFF; no real sandbox run; `provider-event-drain` and `settlement-reconcile` not scheduled |
| Scribe | S23 + S23x: explicit consent per encounter in DB, clinician signs, AI-017 off | No speech vendor (Q19, 95% pass mark on drug names and numbers once a gold set exists) |
| Credentialing | P5: `primary_source` check kind, append-only verification table, `clinician_is_eligible` gate with off-only grandfathering to 2027-01-13, six-month spot re-check (never suspends), "Licence verified on <date>" badge (no folio), identity vendor interface (mock only) | Built; ops evidence for the two active clinicians not recorded; ID vendor none |
| Handset runbook | `docs/runbooks/red-alert-handset-matrix.md` | Every row "NOT RUN" |
| iOS Critical Alerts | request text in #1162; `IOS_CRITICAL_ALERTS_ENABLED` off | Not granted [NV-live] |

## 3. Capability matrix

Rating key: **Ahead** (Tarragon design is stronger than the public best), **Parity**, **Behind**, **Unproven** (design may be ahead, evidence absent), **n/c** (no comparable public evidence).
"Now" means the state of `origin/main-dev` on 2026-10-16.

### 3.1 BP and glucose deterministic triage

| | Tarragon now | Best international | Best local | Rating and evidence |
|---|---|---|---|---|
| BP | Pure `grade()` over signed rule set; symptom-led red, repeat-then-urgent for asymptomatic severe; pregnancy routes red at 160/110 (Q3); offline on-device grade; cuff-type advice; never-older approval guard | Omada: crisis wording at 180/120, patient told to contact team or seek care [V, earlier review]. Cadence: protocol-driven outreach, urgent escalation to a provider, 99% of interactions resolved without partner-physician escalation [V] (businesswire, cadence.care). Hello Heart: real-time high alert, "contact your physician" [V] | NF. No Nigerian vendor publishes thresholds. mDoc claims 84% improved management, unverified [V] | **Ahead on governance and offline behaviour, Unproven on outcomes.** No vendor publishes a signed, versioned, parity-tested rule set. Tarragon has no outcome data at all yet |
| Glucose | Draft v1: ADA three hypoglycaemia levels, DKA-suspect with ketones, hyper at 20.0+, sign overrides, pregnancy and under-18 to clinician; shadow only | Dexcom Urgent Low fixed at 55 mg/dL, cannot be silenced, plus predictive Urgent Low Soon up to 20 minutes ahead [V]. Libre: urgent low fixed 55 mg/dL, silenceable up to 6 hours in Silent Mode, signal loss alarm at 20 minutes [V]. Livongo: out-of-range alert, automated message then coach call or text; defaults 50 and 400 mg/dL [V]; observational 18.4% fewer hypo days [P, JMIR 2017, associational] | NF. WellaHealth and Reliance: no glucose triage published | **Parity on content, Behind on state.** Tarragon's bands are more conservative and richer (ketones, signs) than device-alarm vendors, but they are unsigned and not live. Device vendors have fixed, regulator-cleared alarms in market; Tarragon has none live. Also: CGM is rare in Nigeria, so fingerstick-entered values dominate, which makes the manual-entry path (and the sign tick-boxes) the real product |
| Other vitals (pulse, SpO2, temp) | Legacy SQL triggers only; third BP band list in `apps/web/src/lib/cds/engine.ts` | NEWS2 aggregates RR, SpO2, BP, pulse, consciousness, temperature; single parameter score 3 or total 5 to 6 = urgent, 7+ = emergency [G, RCP charts] | NF | **Behind** international clinical practice; no aggregate or cross-vital logic. Deliberately narrower than NEWS2, and that is defensible for home use, but it is a gap |

### 3.2 Shadow and parity tooling

| | Tarragon now | Best international | Best local | Rating |
|---|---|---|---|---|
| Shadow-then-sign, divergence report, parity table, band-scan test | Built for BP and glucose; none run on real data | No public equivalent for consumer RPM; regulated SaMD vendors do pre-market validation privately [NV] | NF | **Ahead in design, Unproven.** The risk is the opposite of the earlier review: the tooling is complete but the data it needs does not exist yet (the glucose closeout says both pipelines page after signing until parity is shown, and the legacy BP path also still pages every clinician in the org, which the engine's on-call paging does not, a behavioural difference not just a grade difference) |

### 3.3 Red alert unconfirmed ladder and critical push

| | Tarragon now | Best international | Best local | Rating |
|---|---|---|---|---|
| Patient reach | Push on `urgent` channel, email, in-app, fixed generic wording; push receipt error moves the ladder; delivered receipt does not count as confirmed (OQ-329); 30 minute unconfirmed wait then call task; "I could not get care" does not call immediately (OQ-330); no SMS, no voice | iOS Critical Alerts bypass DND and mute but need an Apple entitlement, per app ID, health use allowed, user must still opt in [G/V, Apple docs + dev forum, secondary]. Dexcom and Libre run alarms on the phone with sound that survives silent mode [V]. Android full-screen intent is restricted to calling and alarm apps [G, Play policy, earlier review] | Cadence-like SMS/USSD reach is the local norm for non-smartphone users (mDoc USSD [V]) | **Behind on reach, Ahead on rigor.** On a patient whose phone is silenced, off, or on a battery-killing OEM skin, Tarragon's red can fail with no phone call hop. Device vendors have a local alarm that does not depend on the network at all; Tarragon's equivalent is the on-device guidance at entry time, which only helps if the patient is looking at the app. The 30 minute patient wait is the CMO's choice (recommendation was 10) |
| Evidence | 75-check DB proof with 4 sabotages; Jest 524 tests | None public | None | **Unproven on devices.** Handset runbook rows all NOT RUN. Expo field names for `interruptionLevel`/`ttl`/`channelId` taken from docs, not a live send; the Deno sender was not type-checked |

### 3.4 On-call paging, fatigue and cover

| | Tarragon now | Best international | Best local | Rating |
|---|---|---|---|---|
| Paging | S19: page, recipient, ack, timed escalation, root page; S18 rota with fatigue limits, swaps, backup; clinician ladder now push then email only after OQ-332 | PagerDuty: escalation timeout (default 30 minutes), repeat up to 9 times, per-user notification rules mixing push, SMS, phone call, with delay minutes; ack-timeout to re-notify acknowledged but unresolved incidents; push has the highest reliability but PagerDuty advises several channels [V, support.pagerduty.com] | NF | **Parity on shape, Behind on channels.** Tarragon matches the escalation and ack model but removed the two channels (SMS, voice) that wake a person whose phone is on silent. There is no "acknowledged but unresolved" re-notify equivalent that I could confirm |
| Fatigue and cover | Hard limits, swap approval, backup-only shifts | General on-call practice; NEWS2-style hospitals have rotas, not public tooling | NF | **Ahead (design)**, but one proof (`s18` backup-only shifts) fails at baseline, and the real constraint is doctor supply (founder: 8 hour days, 5 days, two active clinicians) |

### 3.5 Tasks and queue

| | Tarragon now | Best international | Best local | Rating |
|---|---|---|---|---|
| Clinical task queue | S16 tasks with dedupe, class, due times, confirmed task types, explainer "why this task" (P6), tie to patient access | Cadence/Omada: nurse or coach worklists driven by alert [V]. Alert evidence: clinicians acted on 62.1% of 552 action-needed alerts, 17.4% led to a medication change [P, PMC8760617, earlier review]; hypertension providers respond to about 60% of off-target BP alerts [P, JMIR Med Inform 2025 framework paper, citing] | NF | **Parity-plus on explainability, Unproven on load.** No act-rate or time-to-acknowledge measure is live; those are what the literature says to watch |

### 3.6 Provider adapters (video, payouts, webhooks)

| | Tarragon now | Best international | Best local | Rating |
|---|---|---|---|---|
| Webhooks | Inbox with signature check, dedupe, replay, retention config (purge OFF), circuit breaker (flag OFF) | Mature payment stacks do inbox, replay, reconciliation, reversal handling [NV, inference] | Paystack itself retries 3 minutes x4 then hourly to 72 hours [V, earlier review]; local vendors NF | **Parity on design, Unproven.** Never run against a real sandbox; Paystack settlement endpoint paths and fields are from third-party pages [NV]; inbox status is not a success signal while the old path swallows failures (accepted in P4) |
| Payouts | State machine with reversal after success, GL posting and reversal (flag OFF), maker-checker batches (flag OFF), CMO second approver | Paystack transfers can be reversed after success [V] | NF | **Parity on design; Behind on readiness.** `payouts_enabled` and GL posting off, accountant sign-off pending (OQ-340), no UI to propose or release batches |
| Video | Zoom Meeting SDK, audio fallback table, tool to measure | Zoom and Agora both above 4.0 MOS at 25% loss [V, hosted by Zoom]; Doxy.me and Twilio also exist [NV, not searched] | NF | **Unproven.** Fallback values are PROPOSED; no Nigerian-network measurement. Nigeria context: 4G about 49%, 2G about 40% of mobile subscribers (NCC via Intelpoint, April 2025) [G/NV secondary] so a large minority cannot hold video |

### 3.7 Scribe

| | Tarragon now | Best international | Best local | Rating |
|---|---|---|---|---|
| Ambient scribe | Interface, mock, explicit consent each encounter (DB-enforced), drug and number highlight, clinician signs, AI-017 off, no vendor | Abridge and Nuance DAX are deployed in US systems; independent accuracy data is sparse: one study found hallucinations in 31% of ambient notes vs 20% of gold notes [P, Frontiers AI 2025, product unidentified]; no study found measuring accents [search result]. Vendor "confabulation elimination" claims unreviewed [V]. Best published African medical ASR: Intron Sahara V2 medical WER 15.25% vs Whisper-large-v3 27.19% [P preprint, vendor-affiliated, earlier review] | NF | **Behind on capability (nothing runs), Ahead on consent and review controls.** NHS accepts implied consent with a right to dissent [G]; Tarragon deliberately requires explicit consent (keep it, NDPA) |

### 3.8 Credentialing and primary-source verification

| | Tarragon now | Best international | Best local | Rating |
|---|---|---|---|---|
| Primary source | Check kind `primary_source` with stored reference, three accepted routes (DataFlow, written MDCN confirmation, in-person register check), gate on first independent contact, maker-checker approval, six-month spot re-check, 20-case 100% review for new clinicians, badge only when a record exists | Medallion: PSV with continuous sanctions and licence monitoring (SAM, OIG, NPDB, state, DEA), alerts on source change; claims 78% faster and up to 80% less time [V]. NCQA expects at least 30-day monitoring [V/S, earlier review] | MDCN designates DataFlow for primary-source verification, applicant-initiated through the DataFlow portal; HEFAMAA wants written confirmation from the professional body on file [G, mdcn.gov.ng, HEFAMAA via search] | **Parity with the best available Nigerian practice, Behind US automation, which does not exist here.** There is no sanctions feed to monitor in Nigeria, so a periodic human re-check is the honest equivalent |
| Data | Roster of two active clinicians, grandfathered | n/c | n/c | **Unproven.** Gate protects nothing until ops records evidence; `clinical_staff_directory.credential_number` still readable by org members (OQ-358 build pending) |

### 3.9 Chain canary and health

| | Tarragon now | Best international | Best local | Rating |
|---|---|---|---|---|
| Synthetic end-to-end check | 30-minute canary through real insert path to grade, task, page, notice, ack; health view with reading-to-graded timings; external heartbeat endpoint | Standard SRE practice (synthetic monitoring, dead-man's switch) [NV, general knowledge]; no clinical-triage competitor documents one | NF | **Ahead of the clinical field, equal to normal SRE.** Gated until a real patient exists; has not demonstrably run |

### 3.10 Coverage and silence sweeps

| | Tarragon now | Best international | Best local | Rating |
|---|---|---|---|---|
| Silence, adherence | Daily sweep for Members, one task per patient, Free gets none; born OFF | Omada/Livongo/Cadence nudge on missed readings with coaches [V]; Cadence: 9 in 10 patients repeat a high reading within 24 hours [V, 2025 report] | mDoc: coaches and USSD nudges [V] | **Behind on live state (OFF), Parity on design.** Also overlaps the older `medicine-adherence-signals-daily` alert (OQ-P6-2) |

### 3.11 Patient-facing safety messaging

| | Tarragon now | Best international | Best local | Rating |
|---|---|---|---|---|
| Messaging | Signed EMG/TRI wording (founder, not yet CMO); generic lock-screen and email text; discreet mode; INV-07 lint plus broadcast text check (OQ-94); on-device offline red guidance; glucose treatment wording separate sign-off | Device alarms are fixed and cannot be disabled (Dexcom, Libre urgent low) [V]; Omada and Hello Heart use "contact your care team" language [V] | NF | **Ahead on privacy discipline, Behind on actionable local detail.** The English-only decision (D-14) removes translation risk but also excludes patients who read only Pidgin, Yoruba, Hausa or Igbo in a crisis; that tradeoff is deliberate and needs reviewers, not engineering |

## 4. What is NOT truly done or unproven (specific)

Process and sign-off
1. **Glucose rules unsigned.** `glucose_care_triage` v1 DRAFT; two task types (`red_patient_outreach`, `amber_glucose_review`) await CMO confirmation, and until both are confirmed `approve_triage_rule_set` refuses for ANY rule set (OQ-R4-6, answered OQ-334 as "check only task types the rule set uses", build status not verified). Glucose wording needs its own signature. FMoH diabetes guideline: only the 2020 draft was read (4 mmol/L low, 13.3 with ketones); the 2021 text is unchecked (OQ-325 says sign on ADA first).
2. **BP v4 to v6 unsigned** (pregnancy, swelling sign, fit or loss of consciousness). v3 is the only live signed set. `notifications.rules` v5 and `chain.canary_and_health` are PROPOSED values, CMO-owned.
3. **Legacy and new paths both page.** Q1: legacy BP alerts stay until parity over real readings (OQ-317). Legacy glucose backstop (`handle_glucose_emergency_backstop`) stays too. Duplicate paging is intentional but unmeasured.
4. **MDCN and tier ladder compliance** is still an open founder item (CLAUDE.md); the 20-case early review and 6-month re-check are design choices, "not a guideline figure" (Q16).

Never run in the real world
5. **No handset evidence.** Every row in the red-alert handset matrix is NOT RUN (Tecno, Infinix, Itel, Samsung, Xiaomi, iPhone). Whether `urgent_channel_ready`, the Android channel importance, TTL or the iOS `time-sensitive` level work is unknown. Hermes offline-red under one second has been proven in Node and Jest-Expo only.
6. **iOS Critical Alerts entitlement** is a request, not a grant [NV-live]. Without it the iPhone red can be silenced by Focus.
7. **No real Paystack, Zoom or Resend sandbox run** from the S14 layer; legacy `lib/paystack` and `lib/zoom` coexist. Paystack settlement paths are [NV]. Four P4 flags OFF; the maker-checker flag can be flipped by an admin so it is a configuration control, not a guard.
8. **Triage coverage cron OFF**; symptom-only reports are permanent-shadow with no rule (OQ-P6-3); live had 0 Members with BP at the time.
9. **Canary** gated until a real non-test patient exists; first two ticks not confirmed [NV-live]; the synthetic org lives in production (OQ-315 accepted).
10. **Document purge OFF** (credentialing evidence 6 years after employment, OQ-346; provider raw-body redaction purge OFF, OQ-341). Retention clocks run with no deletion, which is also a NDPA exposure if left.
11. **Roster and volume:** two active clinicians, one of whom is the CMO, one test applicant. Any load, fatigue or SLA claim is untested; "doctors work 8 hours a day, 5 days" means nights and weekends have no human by default, so the red path ends at the on-call rota, which is thin. Do not cite any doctor ratio (CLAUDE.md).
12. **Known defects accepted or deferred:** clinician SMS paging dead and now removed; glucose signs not all stored on the server (OQ-319 says fixed in #1145, not verified); caregiver acting for a patient gets 42501 on the red-care answer; `private.lead_ineligibility_reason` mislabels gate failures; `cuff_type` handling and `validateInput` latent null issues fixed in P6; `clinical_staff_directory.credential_number` exposure; INV-07 lint does not cover all free-text paths; the Deno sender was not type-checked; a signed document link lands a signed-out user at home (fixed by OQ-336 `next=`, unverified).
13. **Speech:** no vendor, no gold set, no Nigerian accent evidence; AI-017 off.
14. **Regulatory classification not addressed:** nothing in the repo records a NAFDAC SaMD classification or pre-submission query. A secondary source describes NAFDAC SaMD guidance DR&R-GDL-036-00 effective 2024-07-01 with a four-tier risk grid by function and seriousness [NV, meddeviceguide.com] and notes draft 2025 device regulations and AI-device gaps [NV]. Triage software that tells a patient to go to hospital in a critical situation could sit in a high category.
15. **Pidgin and local languages removed (D-14).** Clinically safe but narrows reach; reintroduction needs a native-reviewer process not yet staffed.

## 5. Prioritised new ideas

Constraints applied to everything below: no WhatsApp; no SMS to patients; no AI in the triage decision (INV-01); no doctor-ratio claims; Free tier consumes no doctor time; deterministic rules signed by a human; INV-07 neutral wording; NDPA and INV-08 (no sms or voice rows are sendable); never promise a response time we cannot staff.

Effort: S under 1 week, M 1 to 4 weeks, L over 4 weeks (engineering only; human time listed separately).

### P0: prove what exists (cheap, highest information)

**N1. Real-handset canary (S).**
- What: one low-cost Android phone (Tecno, Infinix or Itel, whatever the target base actually uses) and one iPhone, on chargers, signed into a synthetic `is_test` Member account. A daily scheduled test red goes through the real ladder; the device app reports receipt time via the existing `send_my_test_alert` path; the chain health page shows device-delivery latency and flags a miss.
- Why: the handset matrix is 100% NOT RUN; OEM battery managers are the dominant silent failure on these skins (dontkillmyapp-type guidance [NV]); PagerDuty notes mobile OS DND settings mute alerts unless explicitly allowed [V]. A permanent device catches regressions and OS updates that a one-off matrix run will not.
- Nigeria fit: very high. Tecno and Infinix are common in Nigeria (KPMG and Orange study headlines Android and Tecno dominance [NV, exact share not retrieved]).
- Safety and regulatory: uses only synthetic data; no PHI. Extends the P1 canary and the P3 runbook.

**N2. Shift-start reachability test page (S).**
- What: at the start of each on-call shift the system pages the clinician with a labelled test; the shift is not "covered" until acknowledged, and a miss alerts the CMO and backup. Reuse S19 paging and S18 rota.
- Why: PagerDuty-style notification rules and escalation only work if the device is reachable; with SMS and voice gone from the clinician ladder, push is a single point of failure.
- Safety: clinician-facing only; no patient data in the text.
- Constraint: OQ-332 decided no SMS for clinician paging; this adds no channel.

**N3. Alert-quality measures (S to M).**
- What: median reading-to-graded, graded-to-task, task-to-acknowledgement, page-to-ack, act rate (task led to action), override rate, and push open rate by phone make, in the S38 analytics. Publish internally weekly.
- Why: literature shows clinicians act on about 60% to 62% of RPM alerts and 17% change treatment [P]; this is the only evidence base for later tuning or claims. Competitors publish outcomes but not response times (Cadence: no measured response time found).
- Constraint: do not publish a response-time promise; report observed times only.

### P1: close clinical-safety gaps

**N4. Clinical safety case and hazard log per rule set (S to M, mostly CMO time).**
- What: a DCB0129/DCB0160-style safety case file (hazards, controls, residual risk, owner) per signed rule set and for the ladder, stored beside the sign-off. The P1 closeout already notes the hazard log is the CMO's document.
- Why: NHS DCB standards [G, not retrieved, from general knowledge, NV] are the common benchmark; NAFDAC SaMD classification is unaddressed (section 4, item 14); it also answers what a future insurer, NGO or regulator will ask.
- Nigeria fit: pairs with a NAFDAC pre-submission query on intended use ("guidance and escalation, not diagnosis").
- Regulatory: counsel to confirm NAFDAC class before any public "triage" claim; never describe the engine as regulator-approved.

**N5. Per-patient signed threshold overrides (M).**
- What: the clinician can set a patient-specific BP or glucose band (for example a patient with chronic stage 3 hypertension or hypoglycaemia unawareness), stored with reason, expiry and CMO-visible audit; the engine reads it as data, and `clinician_override` is recorded on the result (v3 spec already has the field). Overrides can only make a threshold stricter for red, or looser for amber with a second approver.
- Why: NEWS2 explicitly allows individualised thresholds after clinical assessment, with documentation [G, RCP]; the RPM literature points to per-patient baselines as the way to cut alert burden [NV vendor claim: override rates 50 to 70% down to under 10%, unverified]. Reduces load on a two-doctor roster.
- Safety: deterministic, no model; parity tests must cover the override path; sabotage test required.
- Constraint: Free tier gets no doctor-set overrides (no doctor time).

**N6. Pulse, SpO2, temperature on the same rule-set pattern, then an optional NEWS2-style aggregate (M each, aggregate L).**
- What: move the three legacy vitals onto signed rule sets (already listed as follow-up in the glucose closeout). Only then consider a patient-entered aggregate score.
- Why: removes the remaining legacy band lists and the `cds/engine.ts` duplicate; NEWS2 shows single-parameter and aggregate triggers [G].
- Constraint: **do not** build wearable-derived trend or "digital biomarker" detection without an explicit founder ask (CLAUDE.md wearables section); the aggregate would only use values the patient enters or a validated cuff or meter sends. SpO2 from consumer devices needs a CMO decision on reliability.

**N7. Fasting-aware glucose context (M).**
- What: a patient-declared "fasting today" context (religious or medical) that adds signed variants of hypo guidance and a pre-break check, tied to the S50 fasting module which is built with guards OFF.
- Why: fasting is common in the Nigerian context and changes hypoglycaemia risk; international diabetes-and-fasting guidance exists (IDF-DAR) [NV, not searched]. No international vendor in the set built this for it.
- Safety: CMO writes bands; any medicine change stays clinician signed (INV-02). Hold until the S50 protocol is signed.

### P2: widen reach without breaking the SMS and WhatsApp bans

**N8. Assisted entry by a caregiver or partner pharmacy (M to L).**
- What: let a consented caregiver (Care Circle) or an onboarded partner pharmacy enter a reading on behalf of a patient, attributed through `recorded_by` and a source tag, graded by the same engine. Fix the known caregiver 42501 gap on the red-care answer as part of it.
- Why: Cadence reaches non-smartphone patients with two-way SMS and phone calls [V]; mDoc reaches basic phones via USSD [V]. Tarragon cannot use SMS for patients, so the equivalent must be human-assisted entry. A cohort study of 482 patients in rural northern Nigeria with home cuffs and weekly SMS saw systolic BP fall 12.8 mmHg at 6 months, single-arm [P-ish, ISPOR 2026 poster, uncontrolled]; community health extension worker telephone and home coaching reported over 50% control in 21,000 registered patients [NV, programme data]. Both show assisted models work locally.
- Nigeria fit: very high (family-led care, WellaHealth reports about 2,000 pharmacies on its network [V]).
- Safety and regulatory: category-scoped consent per CLAUDE.md access model; never default reproductive categories; a pharmacy reading carries cuff and device provenance; NDPA lawful basis and DPA with each pharmacy.
- Constraint: no SMS or WhatsApp confirmation to the patient; confirmation is in-app or by the caregiver.

**N9. Emergency destination directory (L, mostly ops).**
- What: for a red, show the nearest facilities that are verified (by Tarragon ops, with a date) to take emergencies 24 hours, with an honest "last verified" stamp, never an unverified guess.
- Why: "go to the nearest hospital" is the signed instruction; in many Nigerian areas the nearest hospital may not take that case. WellaHealth and Reliance run partner networks [V]; none documented an emergency-capability directory [NF].
- Safety: wrong information is itself a hazard; null-gate on a stored verification record and date (same rule as `ReviewedByDoctor`). Do not claim ambulance or transport.
- Constraint: no partner payment or ranking logic (specialist-matching guardrail).

**N10. Cuff and meter provenance prompts (S).**
- What: ask once which device and cuff size, store it, and show "validated device?" guidance; the engine already carries `cuff_type`. Add meter brand for glucose.
- Why: wrist cuff advice already exists; device error is a leading source of false reds; supports the clinician explainer.
- Constraint: Tarragon does not sell or import devices (founder decision 2026-08-02), so only guidance, no store.

### P3: operations and trust

**N11. Structured handover for open reds (S to M).** SBAR or I-PASS-style note on the page and task at shift change. I-PASS reduced medical errors in a multicentre study [P, Starmer NEJM 2014, from memory, NV]. Fits the S18 rota. Free-text content must pass INV-07 lint if it ever reaches a patient channel.

**N12. Clinician "licence verified" freshness and public-notice check (S).** Add a quarterly checklist item to look for MDCN notices (suspensions, disciplinary outcomes) for each active clinician, recorded like the six-month re-check. Reason: no Nigerian sanctions feed exists to monitor automatically (US vendors use SAM/OIG/NPDB [V]). Honest manual substitute.

**N13. Scribe edit-distance quality signal (S, after any vendor is trialled).** Track how much the signing clinician edits each draft plus a miss-rate on drug names and numbers (the Q19 95% pass mark). It is a measure of the draft, not of the clinician; do not use it for performance management. Evidence of hallucination in ambient notes (31% vs 20%) [P] argues for it.

**N14. Retention clocks (S).** Turn the purges on with counsel-set periods and a dry-run report each month (credentialing evidence, provider raw bodies, canary events, `red_care_responses` class `review`). NDPA data minimisation; risk of leaving it off is as real as deleting early.

**N15. Second independent heartbeat (S).** In addition to the external monitor on `/api/status/canary`, a deadman from a different provider and a different network path (the endpoint is on the same Vercel project). The canary itself is the only watcher of the chain; if Vercel or Supabase is the failing layer, the heartbeat endpoint fails with it, which is the correct 503 but depends on the monitor existing.

## 6. What competitors do that we should deliberately NOT copy

1. **"Coach or nurse calls within minutes, 24/7" (Livongo-style) [V].** Tarragon's real constraint is doctor supply and the Free-tier rule. A promised response time we cannot staff is a safety and reputational hazard. Report measured times, never promise them. Evidence that the call timing itself helps is weak (observational only [P]).
2. **Predictive alerts and signal-loss alarms (Dexcom Urgent Low Soon, Libre signal loss) [V].** They depend on continuous CGM streams that few Nigerian patients have, and they are a known source of alarm fatigue (users disable the signal-loss alarm [V]). Our manual-entry base does not support prediction, and no model may be in the decision.
3. **Fixed, non-silenceable alarms as a design goal.** Suits a regulator-cleared device; for a consumer app it drives uninstall and permission revocation. Keep the acknowledge-gated guidance and a visible, honest channel status instead.
4. **SMS or USSD two-way channels to patients (Cadence, mDoc) [V].** Barred by our rules (no SMS to patients), PHI over SMS is weak under NDPA, and INV-08 enforces it in the database.
5. **WhatsApp as a clinical channel (WellaHealth Teleclinic [V]).** Removed on purpose (F-02); reintroducing it breaks the "no feature depends on a send succeeding" rule.
6. **AI symptom checkers as triage (Ada, Babylon).** Independent ED testing found Ada's sensitivity 70% against final diagnosis with over-caution the more common safety issue, on 40 participants [P, JMIR mHealth 2022]; Babylon's NHS triage deals ended early and a public safety dispute with a consultant played out in the press [NV, TechCrunch and Pulse via search]. Our no-AI-in-triage rule is a feature, not a lag.
7. **Wearable BP estimation (WHOOP) [G, FDA warning letter 2025-07-14, from earlier review].** Never grade an estimated BP.
8. **Opaque composite analytics (Biofourmis-style baseline deviation engines) [V].** Not explainable to a CMO signing a rule; conflicts with deterministic, versioned rules.
9. **US-style continuous credential monitoring vendors (Medallion) [V].** The sources they watch (SAM, OIG, NPDB, DEA) are US; buying one would verify nothing about an MDCN licence. Use DataFlow plus human re-checks.
10. **NHS implied consent for ambient scribes [G].** NDPA consent expectations and our INV-11 argue for explicit consent each encounter; keep as is.
11. **Full-screen intent for alerts.** Google Play restricts it to calling and alarm apps on Android 14+ [G]; using it risks store action.
12. **Vendor outcome headlines as our own claims** (mDoc 84% improved, Cadence 2x BP control, Livongo 18.4%). They are unverified or associational; do not benchmark marketing against them. Publish our own measured data first.
13. **Free-text chat as the escalation record.** Keep structured tasks and pages with owner and due time, not message threads, as the source of truth.

## 7. Sequencing suggestion (for the founder and CMO to accept or change)

1. This week (S): N1, N2, N15; founder registers the external heartbeat monitor; ops records MDCN/DataFlow evidence for the two clinicians; start the handset matrix on three real phones.
2. Next (S to M): N3 measures; N4 safety case for BP v3 and the ladder; confirm both task types on the sign-off hub; run the parity and divergence reports once real readings exist; decide the pulse/SpO2/temp migration (N6).
3. After first real reds: N5 overrides, revisit `deliveredCountsAsConfirmed`, the 30-minute wait and clinician call-hop question with data.
4. Later and partner-dependent: N8, N9, N7.
Nothing here overrides the S40 Stage 1 gate or the release-blockers checklist.

## 8. Sources

International and regulators
- Dexcom urgent low behaviour (FAQ, Levels FAQ): https://www.dexcom.com/en-us/faqs/cannot-hear-dexcom-g6-alerts-alarm , https://support.levels.com/article/196-i-got-a-critical-alarm-overnight-what-should-i-do [V, secondary]
- Abbott Libre alarm FAQ and LibreLinkUp notifications: https://www.freestyle.abbott/us-en/libre-living/common-libre-alarm-questions.html , https://www.librelinkup.com/articles/notifications [V]
- RCP NEWS2 charts: https://www.rcp.ac.uk/media/mrllczrj/news2-chart-4_clinical-response-to-news-trigger-thresholds_0.pdf , https://www.rcp.ac.uk/media/2acdezkd/news2-chart-2_news-thresholds-and-triggers_0.pdf [G]
- PagerDuty escalation and notification rules: https://support.pagerduty.com/docs/escalation-policies , https://support.pagerduty.com/docs/notification-rules [V]
- Apple critical alerts: https://developer.apple.com/tutorials/data/documentation/usernotifications/unnotificationsettings/criticalalertsetting.md , forum thread https://developer.apple.com/forums/thread/794822 [G/V, dev forum secondary]
- Cadence outcomes and workflow: https://www.heart.org/en/professional/aha-connected-care-powered-by-cadence/hospitals , https://www.cadence.care/outcomes-report-2025 , https://businesswire.com/news/home/20231214429924/en/ [V]
- Livongo: https://jmir.org/2017/7/e234/PDF [P, associational]; Teladoc material via https://contactform.boston.gov/sites/default/files/file/2022/04/Livongo%20PEC%20Presentation_0.pdf [V]
- Biofourmis: https://venturebeat.com/ai/biofourmis-raises-100-million-for-ai-remote-medical-tools [V]
- Medallion monitoring: https://try.medallion.co/hubfs/Marketing%20%2B%20Sales%20Content%20Library/Product%20Overviews/New%20-%201-pagers/Medallion_VerificationMonitoring.pdf [V]
- Ambient scribe hallucination comparison: https://public-pages-files-2025.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2025.1691499/text [P]; scribe interpreter-error study https://medinform.jmir.org/2026/1/e85580 [P, methods only seen]
- Ada ED evaluation: https://mhealth.jmir.org/2022/9/e38364 [P]; Babylon coverage: https://techcrunch.com/2020/02/25/first-do-no-harm/amp/ , https://www.pulsetoday.co.uk/news/technology/digital-gp-provider-babylon-ends-long-term-acute-trust-partnerships/ [NV press]
- RPM alert response rates: https://medinform.jmir.org/2025/1/e66066 [P]

Nigeria and Africa
- MDCN primary source verification: https://mdcn.gov.ng/page/services/primary-source-verification [G]; DataFlow Africa outreach: https://dataflowgroup.com/blog-post/issuing-authorities-africa [V]
- NAFDAC SaMD comparison and draft regulations: https://meddeviceguide.com/blog/software-as-medical-device-samd-regulation-compared-global-guide , https://businessday.ng/news/legal-business/article/from-draft-to-implementation-compliance-obligations-under-nafdacs-medical-devices-and-ivds-draft-regulations-2025/ , https://journals.unizik.edu.ng/naujppl/article/view/8056 [NV secondary; confirm with NAFDAC]
- Network mix: https://intelpoint.co/?p=5277 , https://intelpoint.co/insights/despite-a-steady-decline-over-40-of-nigerias-mobile-users-still-rely-on-2g/ [NV, NCC data relayed]; KPMG and Orange smartphone study https://assets.kpmg.com/content/dam/kpmgsites/ng/pdf/2026/09/Nigeria%20Smartphone%20Study%20-%20Orange%20Group%20and%20KPMG.pdf.coredownload.inline.pdf [NV]
- mDoc: https://aiworld.eu/story/mdoc-provides-ai-driven-disease-support-across-nigeria [V]; CHW task-sharing study https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9909193/ [P]
- WellaHealth: https://guardian.ng/news/revolutionizing-healthcare-access-wellahealths-innovative-telemedicine-solutions/ , https://www.swissre.com/foundation/e4ra-21-wellahealth.html [V]
- Helium Health, Reliance Health: https://techeconomy.ng/helium-health-vs-reliance-hmo-nigeria-healthtech , https://getreliancehealth.com/clinical-services [V]
- Ghana and Nigeria app-message hypertension trial https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10543310/ [P, results not read]; northern Nigeria digital hypertension study https://www.ispor.org/heor-resources/presentations-database/presentation-cti/ispor-2026/poster-session-3-3/digital-health-for-hypertension-in-rural-northern-nigeria-real-world-patient-centered-and-economic-outcomes-from-a-mixed-methods-study [P poster, single arm]

Not found despite searching: Clafiya, Carepoint, Ubenwa, Lifestores, Zuri, Mydawa, M-TIBA, eHealth Africa specifics (not searched or not surfaced); any Nigerian competitor's triage thresholds, SLAs, paging design, or credentialing process.

Repo
- `docs/research/S11-S15-review-and-build-plan.md`, `docs/design/S11-S15-*-closeout.md`, `docs/design/FU-notify-closeout.md`, `docs/runbooks/S11-S15-go-live-order.md`, `docs/runbooks/red-alert-handset-matrix.md`, `docs/DECISIONS.md` (CMO pack Q1 to Q19; answers to OQ-314 to OQ-358), `docs/BUILD-PROGRESS.md` (S11 to S15 integration entry), `docs/OPEN-QUESTIONS.md`, `packages/clinical/src/`, `supabase/migrations/20261013223014` through `20261014162445`.
