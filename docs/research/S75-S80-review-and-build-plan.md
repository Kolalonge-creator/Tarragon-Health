# S75 to S80: review, competitor comparison and build plan

Date: 2026-10-07. Branch context: `s38/outcome-snapshots-analytics` (136 commits behind `origin/main-dev`; audits of Modules 23 and 25 were read from `origin/main-dev`).
Scope: S75 (Module 22, outcomes and population health), S76, S77, S78 (Module 23, clinician console, 1 to 3 of 3), S79 (Module 24, institution console), S80 (Module 25, operations and admin console).

Evidence base: the six session prompts, `docs/BUILD-SPEC-v5.md` B.22 to B.25 and invariants, `docs/design/S38.md`, five read-only agent passes (three code audits, two web research passes), `docs/DECISIONS.md`, project memory. Nothing was run and no live database was queried, so "applied live" statements come from BUILD-PROGRESS and memory and must be re-checked.

Evidence quality: the competitor research was a quick pass (about 20 searches, few page-level reads). Claims are labelled **[V]** vendor claim, **[I]** independent source, **[U]** could not verify. Many Module 22 to 25 reference products (Innovaccer, Health Catalyst, H2O.ai, Personify, Headspace for Work, Practo, Vezeeta, Commure, Healthily, Lark, OpenLoop, most Nigerian players) could not be checked and are treated as leads only.

---

## 1. Headline findings

1. **None of these six sessions is greenfield.** Module 23 is mostly built (queue, rota, paging, earnings, payouts, speak-up). Module 25 is mostly built (go-live guards, directory freshness, finance console, DSR screens). Module 22 has S38's snapshot layer plus a lot of older analytics. Module 24 exists as legacy employer, HMO, payer and NGO dashboards. The work is gaps, safety fixes and reconciliation.
2. **One live safety problem sits in S79 territory and should be fixed before anything is built.** `apps/web/src/lib/corporate/load-wellbeing-cohort-metric.ts` and `corporate/wellbeing-cohort-summary.tsx` show PHQ-9 and GAD-7 distributions to employers, through a service-role client with no module gate. This contradicts spec 24.3 (reproductive and mental health data never shown to sponsors) and the spec's own "sponsor dashboard never includes mental health data" rule.
3. **INV-13 (`is_test`) is missing from every metric surface except S38's.** Corporate, HMO, payer, NGO, employer invoicing, `risk_predictions`, the nightly risk run and the three `*_quality_metrics` views do not filter it. The corporate suppression count also includes test accounts. OQ-39 records this with a blank decision.
4. **Small-cell rules are inconsistent.** At least four floors in play: `organisations.min_cohort_size` (default 10, minimum 5), insurer and provider-org equivalents, the payer measure-spec denominator, S38's fixed `min_cell` of 10 with complementary suppression. `funding_programme_stats` returns exact counts. NGO admins see invitee names, phones and emails. Only S38 does complementary suppression.
5. **A spec acceptance test collides with a founder decision.** S80's "Unreviewed Pidgin clinical string blocks the release build" is moot: D-14 (2026-10-06) made the product English only, `pcm.ts` is gone from `origin/main-dev`, and the spec `translations` table does not exist. The S80 prompt still says "(en, pcm)".
6. **Clinical content can be published without a clinical reviewer.** `public.set_health_education_content_status` checks only `private.is_admin()`, allows `draft` to `published`, and on `approved` sets `clinician_reviewed = true` with no reviewer identity check. The spec's S80 rule says the opposite. No role called "clinical reviewer" exists; only Clinical Director and CMO helpers do.
7. **INV-05 has a single asynchronous dependency.** Red pages are created from `triage.graded` through the outbox and `process-events`. If that function is down, no page and no queue task are created. The 5 and 10 minute ladder is proven in SQL only, and the S19 race script is flaky on `main-dev`.
8. **A lot of what is "built" is switched off or unsigned, and that is a human task, not an engineering one.** AI-017 scribe off, `payouts_enabled` off with zero payouts, no fee schedule seeded, no approved titration step table (OQ-171), credentialing test content not authored (OQ-105), four of seven go-live guards recorded but enforced nowhere (OQ-184), CMO has not signed `quality.audit` or `queue.claims`.
9. **The Stage 1 gate is not closed.** Every one of the six prompts stops unless `docs/BUILD-PROGRESS.md` starts with "Stage 1 complete". It does not. Eleven PRs block it (975, 967, 990, 989, 988, 986, 968, 982, 980, 973, 971), and the S39b/c/d/e migrations are applied live while their PRs are unmerged.
10. **Staff screens live in `apps/web`, not `apps/console`.** The spec and F-04 say console; OQ-99 and OQ-209 chose `apps/web` for clinician and admin areas, and `apps/console` has only the NGO area. Follow the precedent unless the founder reverses it.

---

## 2. Function-by-function status

Legend: Built / Partial / Missing. Paths are shorthand (`M/` = `supabase/migrations/`).

### Module 22 (S75)

| # | Status | What exists | Gap |
|---|---|---|---|
| 22.1 baseline and follow-up | Partial | S38 (uncommitted on this branch): `outcome_snapshots` days 0/30/90/180, `analytics.outcome_config`, `analytics_bp_control_90d`, `v_outcome_facts` | BP only. No HbA1c, weight, PHQ-9, GAD-7. Report is day 90 only (spec wants 180). No screen or typed client. Live: 0 enrolments |
| 22.2 adherence and engagement, separate from outcomes | Partial | Adherence stored beside, never inside, `controlled`. Older `analytics_care_engagement_summary` | No retention or programme-completion measure; no dashboard on snapshot data |
| 22.3 risk stratification | Partial, dormant | `risk_models`, `risk_predictions`, governance RPCs, drift and subgroup views, `high_risk_patient_ids()`, one heuristic `missed_follow_up` model seeded as draft | No `risk_scores` table (live is `risk_predictions`), no `risk-model` batch function, no dropout or deterioration model, worklist is a filter not an ordering, monitoring views have no UI |
| 22.4 triage accuracy dashboard | Partial | `triage_safety_monitoring` view, S38e `/admin/triage-accuracy` (agreement with automatic grade) | No vignette-suite accuracy measure, no clinician-outcome comparison |
| 22.5 monthly personal report, shareable | Missing | Related: `patient_quarterly_reports` and a PDF route | No monthly report, no Care Circle sharing of it |
| 22.6 aggregate sponsor dashboards | Partial, unsafe | Corporate, HMO, payer, NGO dashboards on the legacy path | Not on S38 facts, inconsistent floors, mental health shown, modelled "cost avoided" figure on HMO and corporate, no causal-claims gate |
| 22.7 escalation, follow-up, response times | Partial | `paging_overview()`, `analytics_alert_quality`, `analytics_doctor_performance` | No single view over S16 to S19 tasks and pages |
| 22.8 data quality and missing data | Partial | `data_quality_findings`, scan cron; S38 `insufficient_data` | No analytics-side missing-data report |
| 22.9 exportable pilot and renewal reports | Partial | `payer_board_reports` (frozen, hashed, attestable, print only), `outcome_reports` | No sponsor-facing PDF or CSV for corporate, HMO, NGO |

### Module 23 (S76 to S78)

| # | Status | What exists | Gap |
|---|---|---|---|
| 23.1 sign-in, MDCN, roles | Partial | S15 applications, checks, unique MDCN folio, role RLS; TOTP only in `apps/console` | MDCN check is a reviewer looking at documents; no register lookup, no re-check cadence |
| 23.2 unified queue | Partial | `clinical_tasks`, `/clinician/queue`, triage-to-task handler (shadow lifted 2026-10-06) | Device alerts, therapy flags, mental health follow-ups not confirmed as sources; old queues still exist beside it |
| 23.3 SLA timers, second clinician | Partial | `due_at`, claim expiry, promotion sweep, `clinical_task.escalated` | Escalation is priority promotion, not an explicit re-offer to a second clinician |
| 23.4 patient summary | Partial | S35 `clinician_patient_summary(p_patient, p_reason)`, audited | No symptom checks, assistant interactions, documents, trend view (14-day row list only) |
| 23.5 titration sign, amend, reject | Partial | S24 `care_plan_changes` propose/sign/reject/expiry; S24b screen | No approved step table (OQ-171); no amend path for engine proposals (OQ-172); S24b apply status unverified |
| 23.6 AI scribe | Partial | `scribe_consents`, encrypted transcripts, `scribe-draft`, sign-before-record enforced, `/clinician/scribe-quality` | Typed or pasted input only (speech-to-text skipped, OQ-96); note and patient summary only, no letters, prescription drafts or follow-up tasks; AI-017 off; two consent tables reconciled late (OQ-161) |
| 23.7 live red-flag prompts | Missing | Nothing | `live_prompts`, `live-redflag`, a transcript-segment source |
| 23.8 e-prescribing, referrals, labs, follow-ups with closure | Partial | S24 prescribing, `referrals`, `lab_orders`, `alert_follow_up_tasks` | No unified order object with closure tracking; no lab-request object |
| 23.9 rota, on-call | Built | S18/S19/S19b `on_call_rota`, swaps, gaps, readiness | Not verified: patient-side urgent guidance outside staffed hours |
| 23.10 freelance credentialing and scenario test | Partial | S15 applications, references, training modules, `credential_test_cases` with `is_red` | CMO test content not authored (OQ-105); "every red scenario correct" enforcement not checked |
| 23.11 tiers and competencies | Partial | Seven competencies, `credentialing_level`, S20 audits first 20 tasks | `maternal`, `mental_health`, `paediatrics` rows missing; tier 1 task limits not enforced (queue gates on `doctor_tier`, F-05) |
| 23.12 declared availability, pilot minimum | Built | S17 blocks, S30 `pilot_minimum_per_declared_hour_kobo` | Minimum empty until a fee schedule is approved; inactivity check is a listed follow-up |
| 23.13 Next task, nine classes | Built | `queue_next()` atomic claim, hand-back, nine classes | 50-session race not confirmed on a real DB; no create-a-task-type screen or configuration test (acceptance test) |
| 23.14 lead clinician | Built | `lead_assignments`, `lead_window_minutes` | Nothing emits `order.paid` (OQ-126) |
| 23.15 red paging 5 and 10 minutes | Built, dormant | S19 `pages`, `paging_config`, sweep every 15 s | Creation depends on outbox; `page.unacknowledged` and `clinician.task_completed` registered, never emitted |
| 23.16 published response times | Mostly missing | `wq.window` copy, `/accountability` | No configured table shown to patients |
| 23.17 earnings and payouts | Built, off | S30 ledger, S31 approval and Paystack transfer, applied | `payouts_enabled` off, zero payouts, no fee schedule, OQ-193/196/197 open, never run against Paystack |
| 23.18 group indemnity | Partial | Individual indemnity tracking and expiry | No group indemnity or clinical-support feature |
| 23.19 speak-up | Built | S20 `safety_concerns`, protected from ops | `safety_concern.raised` event missing; backup reader unnamed (OQ-137) |
| 23.20 reliability, audit sample, suspension | Partial | `recompute_reliability` (tie-break only), monthly audit sample, licence-expiry suspension | No stated score shown; audit scoring needs signed `quality.audit` |
| 23.21 audit, incidents, workload and quality dashboards | Partial | `audit_log`, `reliability_dashboard`, `/clinician/quality`, `ops_incidents` | No clinician workload dashboard |

### Module 24 (S79)

| # | Status | What exists | Gap |
|---|---|---|---|
| 24.1 cohorts, codes, bulk upload | Partial | Employer `join_code`, `employer_bulk_upsert_roster`, NGO invitations and roster parser | No `cohort_codes` (capped, expiring, per cohort); no HMO or community equivalent; no `cohort.enrolled` event |
| 24.2 programme configuration | Partial | Employer benefit packages, allowances, purchases | No generic pathway, challenge, reward configuration |
| 24.3 aggregate reporting, no reproductive or mental health | Partial, unsafe | Corporate and HMO pages use aggregate-access and suppression helpers | Shows PHQ-9 and GAD-7 (finding 2); `sponsor_reporting` consent exists but is never checked |
| 24.4 invoices, contracts, usage billing | Partial | `employer_invoices`, contracts for corporate, HMO, outcomes; kobo throughout | No `usage_records`; nothing for NGO or community sponsors beyond funding programmes |
| 24.5 workplace campaigns | Partial | `employer_campaigns`, templates | Challenges and rewards are per-patient, not sponsor-configured |
| 24.6 procurement and renewal exports | Partial | Payer board report (print only) | None for corporate, HMO, NGO |

### Module 25 (S80)

| # | Status | What exists | Gap |
|---|---|---|---|
| 25.1 content CMS with review, versions, translation status | Partial | `health_education_content` with versions and history, review-due sweep, `sign_lpe_content_block` (Clinical Director), S33 lesson review gate | No reviewer gate on health education (finding 6); no unified CMS; no `content.published` event; translation status moot (D-14) |
| 25.2 symptom KB change control | Partial | `triage_protocols` versions, `sign_triage_protocol` (Clinical Director), triage rule sets, `/clinician/clinical-signoff` | No diff or impact view; no UI rollback or retire |
| 25.3 directory and partner verification | Built | S36g `directory_verifications`, six listing tables, `/admin/ops/directory-freshness` | Cadence unsigned (OQ-235); branches not covered; no patient-facing "last checked" |
| 25.4 support inbox | Partial | `support_tickets`, comments, clinical escalation, `/clinician/support-tickets` | No phone or email intake; `whatsapp` still a channel value despite F-02; policies org-staff wide (S39b re-tie unverified) |
| 25.5 protocol config, sign-off, flags, guards | Built (mostly) | S37 `go_live_guards` (7, seeded off), attestations, `proposed_config_signoffs`, `platform_modules` | Four guards unenforced (OQ-184); no generic non-clinical config editor |
| 25.6 finance | Partial | `/finance/*`, `/admin/refund-requests`, S26 refunds, S31 payouts | Refunds and tax deferred (OQ-184), OQ-133 open, INV-15 lint conformance not audited |
| 25.7 safety, privacy, DSR | Partial | Data rights, breach incidents, S36a admin patient search, S39c audited open-record, S39d registry, purge, export | S39c/d unmerged; OQ-262/263/264 need counsel; export route wiring (OQ-285) |
| 25.8 automation | Partial | About 53 `pg_cron` jobs, outbox edge functions | No `automations` registry, no owner or pause screen, partner chasing is referral chasing only |
| 25.9 directory freshness alerts | Built | Nightly sweep, neutral in-app notice | In-app only; not run on production data |
| 25.10 AI monitoring | Partial | `ai_systems`, `ai_interaction_log`, incidents, evals, drift, scribe quality, triage accuracy | No model cost view, no general conversation sampling, no patient report-an-answer path (S52 owns it) |

---

## 3. Comparison to full competitor products

Evidence labels as above. Where the research could not verify a product, the row says so and Tarragon's design comes from its own requirement.

### Module 22: outcomes and population health

| Product | What the full product does | Tarragon today | Verdict |
|---|---|---|---|
| Omada Health | Reports 12-month results against a comparison group (HbA1c -0.23% vs -0.15%, weight -5.4% vs -2.0%) [V]; a study in low-income prediabetes found weight loss but little HbA1c change [V]. No criticism of its causal claims was found [U] | S38 reports a cohort with usable, controlled and insufficient counts together, no comparator, descriptive text | Adopt: state the comparator (or say there is none) and use all-enrolled denominators. Avoid: headline numbers on engaged members only. Tarragon's "three counts together" is already the right instinct |
| Ada Health | BMJ Open 2020 vignette study: top-3 accuracy 70.5% vs GPs 82.1%, authors include Ada staff [V, semi-independent]; publishes its own testing approach [V] | Deterministic triage, agreement view only | Adopt a standing vignette suite and report **safe-urgency rate**, never a diagnostic accuracy number. Babylon is the anti-pattern (see the S51 plan) |
| NHSBSA, HES, PHW disclosure rules | Suppress counts of 1 to 7 (threshold moved from 10 to 5), round to 5, secondary suppression so totals cannot reveal hidden cells [I] | S38 has complementary suppression; legacy surfaces do not | Adopt S38's rule everywhere through one shared function. 5 is the NHS floor, 10 is more cautious; Tarragon default stays 10 |
| DHIS2 and WHO DQA | Completeness, timeliness, internal consistency, denominator consistency; reporting rate is received over expected [I] | `data_quality_findings`, `insufficient_data` | Adopt a data-quality strip on every institutional report |
| Innovaccer, Health Catalyst, H2O.ai | Registries and explainable risk lists [U, background knowledge] | Dormant `risk_models`, filter-only worklist | Adopt only the principle: show reasons, clinician outreach only, hard-coded "never used to deny care". No claims about these products are made |
| Medisafe, Glooko | Adherence as doses logged against scheduled; standard glucose report [U] | Same adherence definition via `weekly_adherence` | No gap identified. Keep engagement (opens, streaks) out of the outcomes view |
| mDoc, Clafiya, Reliance Health | No public outcomes methodology found [U] | n/a | State as a gap; no benchmark available |

Where Tarragon already leads: append-only snapshots with a config version, insufficient data stored as such, adherence kept out of `controlled`, no causal wording, small-cell with complementary suppression, audited analyst reads.

### Module 23: clinician console

| Product | What the full product does | Tarragon today | Verdict |
|---|---|---|---|
| Glooko clinic dashboard | Ranks patients by risk category then by severity of the triggering metric [V] | Nine classes, claim queue, no severity key | Adopt a **two-key order**: class, then severity of the trigger. Risk score is a tiebreak inside a class, never a gate |
| Manchester Triage System | Five classes with target times: 0, 10, 60, 120, 240 minutes [I]. Targets are for ED waits, not asynchronous chronic care | Nine classes, `due_at` per task type | Keep target times as versioned data (already so). Calibrate Tarragon's own times; do not borrow MTS numbers |
| Ambient scribes (Abridge, Suki, Nabla, Ambience) | Review gate before sign, edit capture, verbal consent logged, declined consents tracked [I]; accuracy drops in multilingual, multi-party consultations [I]; Nabla claims no audio stored [V] | Consent gate and sign-before-record enforced, scribe-quality edit rates | Adopt: store the **edit diff with the signed note**. Avoid auto-signing. Test on Nigerian English before enabling |
| Corti | Live Guidance on the clinician screen, clinician adjusts intervention level [V]. No independent evidence found [U] | Missing | Adopt visual, dismissible prompts; never audio interruption. Rules stay deterministic (INV-01), unlike Corti's AI guidance |
| Wheel | Contractors choose workload; credentialing and licensure run by the platform [V] | Hybrid model, S15 credentialing, availability blocks | Adopt: activation gated on checks. Avoid: pure contractor pool for continuity. Clinician complaint data not found [U] |
| Hims & Hers | Contractors through affiliated medical groups, malpractice with tail cover [V]; critics cite corporate-practice-of-medicine risk [adversarial short-seller report] | Individual indemnity only | Adopt: bundle indemnity and tail cover into the engagement. Needs Nigerian counsel, not code |
| Clafiya | Per-visit pay for community health workers, USSD booking [V] | S30 per-task fees | Per-task pay has a Nigerian precedent. USSD is out of scope (S40) |
| Doctolib | E-prescribing, referrals and video in one consult context [V] | Separate screens for each | Adopt: prescribe, refer and order inside the consult. Referral workflow itself not verified [U] |
| PagerDuty-style ladders | 5 to 15 minutes per tier, P1 often 2 to 3 [independent summaries] | 5 and 10 minutes, push, in-app, email | Reasonable. Acknowledge stops escalation; re-page if acknowledged but unresolved |
| Alert fatigue evidence | Override rates around 90 to 96% in clinical decision support studies [I, not individually checked] | Red pages only for red events | Count and review every page, every prompt, every dismissal |
| OpenLoop, Helium Health, Reliance, 54gene, mDoc, Doctoora, Hello Doctor, Mediacs | Nothing usable found [U], except Helium's offline-first EHR [press] | n/a | Not cited. MDCN has no public API found; DataFlow is a paid manual primary-source service [U] |

Where Tarragon already leads: deterministic triage with no model in the path, atomic claim with hand-back reasons, paging with backup and lead escalation, protected speak-up route invisible to operations, audited summary reads, signed-before-record scribe.

### Module 24: institution console

| Product | What the full product does | Tarragon today | Verdict |
|---|---|---|---|
| Omada, Personify Health, Virgin Pulse, Headspace for Work, Calm Business, Wellable | Employer dashboards of enrolment, engagement and activation, eligibility files, renewal decks [U, background knowledge only] | Legacy employer and HMO dashboards | Adopt aggregate-only engagement and a member-facing "what your employer sees" notice. Avoid any individual risk or biometric view and any challenge that rewards disclosure |
| Reliance Health | Corporate staff enrolled through HMO staff data entry [V] | Employer roster upload | No public detail on employer portals, bulk upload or report formats for any Nigerian HMO [U]. Do not assume any exist |
| NHIA, BHCPF | No public report templates found [U] | NGO and funding programme stats | Confirm the return format with NHIA directly before building |
| Omada fee-at-risk | Outcome-contingent fees [background knowledge, [U]] | `outcomes_contracts` with fee-at-risk still live | Tension with I8 spirit and with "no causal claims". Needs a founder decision, see D-A5 |

Where Tarragon already leads: I9 aggregate-only enforcement, frozen hashed attestable payer reports, kobo everywhere.

### Module 25: operations and admin console

| Product | What the full product does | Tarragon today | Verdict |
|---|---|---|---|
| Infermedica | Five-step content change: scope, expert elicitation, test criteria, manual and automated acceptance tests, deployment [V] | `triage_protocols` versions and CMO sign-off, no diff, no vignette gate | Adopt: change request, run the vignette suite, then CMO sign-off before release |
| Paystack | Dashboard refunds full or partial; fees non-refundable; daily settlement net of fees, refunds and chargebacks; disputes auto-accepted if unhandled in 16 hours [V] | Refunds, settlements, reconciliation flags | Adopt a dispute queue with its deadline shown, and settlement-to-ledger reconciliation. Never promise refunds of fees you cannot recover |
| NDPA 2023 | Rights of access, rectification, erasure (sections 34 to 38). One secondary source says no response time in the Act; another says GAID 2025 expects 30 days [secondary, not confirmed against primary text] | `data_deletion_requests`, `data_export_requests`, S39d | Design a visible 30 day timer. Counsel to confirm before hard-coding |
| Intercom, Zendesk | SLA timers, macros, internal notes [U] | Basic tickets | Adopt SLA timer and canned replies; never auto-close a clinical message |
| Practo, Vezeeta | Listing verification and freshness [U] | Built (S36g) | Add the patient-facing "last verified" line |
| Commure | Automates ops tasks [U] | 53 cron jobs, no registry | Automate reversible tasks only, log each, show owner and pause |
| Langfuse, Arize | Trace sampling, cost dashboards [U] | Governance registry, no cost view | Adopt sampling and cost per feature **in house**. Do not send PHI to a third-party SaaS without a DPA and residency review |
| NHS DCB0129, WHO AI guidance | Clinical safety case and hazard log [U] | `ai_safety_incidents`, eval suites | Adopt a hazard log tied to each registered AI system |
| Lokalise, Crowdin | Translation review states [U] | n/a | Moot under D-14 |

Where Tarragon already leads: Clinical Director-only protocol signing, append-only go-live attestations, directory verification as append-only history, audited admin open-record.

### Things unsafe or unsuitable for Nigeria (from the research)

Employer-visible individual or mental health data; fee-at-risk or capitation; opaque or LLM-based risk and triage; offshore PHI in observability tools; ambient scribe on Nigerian English and code-switching before testing; audio-heavy flows on low bandwidth (capture on device, upload later, signing never depends on upload); heavy live-chart dashboards (use server-rendered tables and CSV); US constructs (HIPAA wording, CMS cell size as law).

---

## 4. Derived best build

The build that falls out of the comparison and the audit, in one paragraph per module.

- **Module 22: one analytics spine, many views.** Everything reads `analytics.v_outcome_facts` and the S38 `min_cell` plus complementary-suppression function. Add outcome measures as data (HbA1c, weight, PHQ-9, GAD-7 snapshots, with the two mental health measures visible only to the patient and the treating clinician), report every outcome with its comparator statement and all-enrolled denominator, and retire the legacy per-dashboard floors. Risk is rule-based and explainable first (missed readings, adherence drop, overdue follow-up), in shadow mode, used only as a tiebreak inside a priority class. No trained model until there are outcomes to train on (zero enrolments live today).
- **Module 23: finish and harden, do not rebuild.** The queue gets a second sort key (trigger severity). Paging gets a direct-call watchdog so INV-05 does not depend only on the outbox. Live red-flag prompts are built as a deterministic phrase engine over consented transcript segments, visual and dismissible, every show and dismissal logged, behind its own go-live guard, with speech input deferred until OQ-96 and OQ-161 are settled. The scribe gains letters, prescription drafts and follow-up tasks as unsigned drafts, with the edit diff stored. Order, referral, lab request and follow-up become one closure-tracked object inside the consult context.
- **Module 24: fix, then unify.** Remove the mental health view from sponsor surfaces first. Then a single `cohort_codes` model (capped, expiring), dry-run bulk upload, one frozen hashed report generator reused from the payer board report (print and CSV), a member-facing notice of what the sponsor sees, `is_test` and the shared suppression everywhere, and an audit entry on every institutional aggregate read.
- **Module 25: enforce, do not add.** Highest value is enforcing what is already recorded: the four unenforced guards, a clinical-reviewer gate on every content publish path, the `automations` registry over existing cron jobs, and an AI cost and sampling view built on `ai_interaction_log`. Translation work is dropped under D-14 and replaced by a copy-review release gate.

---

## 5. Decisions needed from the founder (and CMO) before building

| ID | Decision | Recommendation |
|---|---|---|
| D-A1 | Stage 1 gate. All six prompts stop until S40 passes. Do the small safety fixes (P1 to P3 below) ahead of the gate as their own PRs? | Yes for P1 to P3. They fix live exposure and remove no gate. Everything else waits |
| D-A2 | OQ-39: apply `is_test` filtering to every legacy metric surface? | Yes. One migration per surface family, ratchet extended to all analytics views |
| D-A3 | One minimum cohort size, and 5 or 10? | 10 default, org override allowed upward only, one shared function. Record as OQ-214 (currently referenced in the S38 design note but missing from `OPEN-QUESTIONS.md`, along with OQ-213) |
| D-A4 | Mental health data on sponsor surfaces. | Remove entirely, not just suppress small cells. Same for reproductive and pregnancy data |
| D-A5 | `outcomes_contracts` fee-at-risk and the modelled "cost avoided" figure. | Freeze new fee-at-risk contracts and hide the modelled figure until a founder decision, because both conflict with "no causal claims" and the spirit of I8 |
| D-B1 | What is a "clinical reviewer"? No such role exists. | Use the existing Clinical Director and CMO helpers as the only publishers of clinical content. A separate reviewer role is optional and later |
| D-B2 | S80 acceptance test about Pidgin. | Replace with "unreviewed clinical copy change blocks the release build", using existing review states. Drop the `translations` table and update the S80 prompt wording |
| D-B3 | Agent signing. Memory contains two conflicting rules: `feedback_never_sign_clinical_protocols_as_agent` (never press Sign or Promote) and `feedback_cmo_signing_from_chat` (the CMO reviews in chat and the agent runs the signing path). | Needs a one-line founder ruling. Until then this plan builds gates and screens only and signs nothing |
| D-C1 | Paging channel. D-12 says push, in-console alarm and email only. OQ-05's wording ("clinician paging") could be read as allowing SMS, and the research suggests a third channel at the second step because of shared phones and power cuts. | Keep D-12. If a third channel is wanted, make it a founder amendment of INV-08, not an inferred reading of OQ-05 |
| D-C2 | Tier 1 task limits (23.11) versus F-05 (single doctor tier). | Keep `doctor_tier` as the queue gate. Add the three missing competencies as data and use `credentialing_level` for audit sampling only. Record as superseded in the spec reconciliation |
| D-C3 | Group indemnity and clinical support (23.18). | Operations and legal task, not code. Track as a checklist item with counsel |
| D-C4 | Live red-flag prompts (23.7) before speech-to-text exists. | Build the engine, schema, log and guard now; test on typed and pasted segments; turn on only after OQ-96 and OQ-161 close |
| D-C5 | MDCN verification. | Staff-run register check with stored date, verifier and a re-check cadence. No API found; do not promise one |
| D-D1 | Support inbox email and phone intake. | Staff form to log a phone call as a ticket first. Inbound email only if the founder wants it, and never via WhatsApp (F-02). Remove the `whatsapp` channel value with the count-first pattern |
| D-D2 | NHIA and BHCPF return format. | Ask NHIA directly. Nothing to build until the format is known |
| D-D3 | Counsel items: DSR response deadline, erasure and retention (OQ-262 to 264), cross-border rules for any observability vendor. | Counsel before hard-coding any number |

---

## 6. Build plan

Each session still follows its own prompt (research file, design note, build, prove, progress entry). This section adds concrete scope and pre-work. Registered DB proofs go in `packages/db/tests/` and `ci.manifest`, each with a sabotage step. Check `list_migrations` on the live project before applying any migration and never hand-type a timestamp.

### Pre-work (small independent PRs; need D-A1)

| # | Item | Why now | Proof |
|---|---|---|---|
| P1 | Remove `wellbeing-cohort-summary` and `load-wellbeing-cohort-metric` from employer and HMO pages. Add a lint or test that no sponsor-facing loader reads `mental_health_screens` or any reproductive table. | Live exposure of mental health data to employers (finding 2) | Jest: employer and HMO pages render without it; scan test fails if a sponsor loader imports it |
| P2 | Rebase this branch on `origin/main-dev`, commit S38 (migration, DB test, design and research notes, manifest, registry, mirror test). | S38 is untracked; S75 builds directly on it; the branch is 136 commits stale | Existing S38 proofs plus the sabotage steps already written |
| P3 | Verify live state read-only: S36k, S24b, S35c, S39b to f apply status; `platform_modules` rows; live row counts for `risk_predictions`, `support_tickets`, `payouts`. | The audits did not query the database | Read-only SQL |
| P4 | Add `is_test` filters and the shared suppression function to `analytics_*` RPCs, payer, corporate, HMO, NGO surfaces in family-sized migrations. | INV-13 and consistency (needs D-A2, D-A3) | DB test with a test patient absent from every view; ratchet widened |
| P5 | Fix `set_health_education_content_status`: publish and approve require Clinical Director or CMO, reviewer identity recorded. Update tests. | Spec safety rule for S80 (needs D-B1) | Admin-only caller refused; sabotage reverts the check |
| P6 | Log OQ-213, OQ-214 and the other items in section 8 in `docs/OPEN-QUESTIONS.md`. | Several are referenced but absent | n/a |

### S75: outcomes and population health (22.1 to 22.9)

1. **Measures as data (22.1).** Extend `outcome_config` and snapshots to HbA1c change, weight change, and PHQ-9 and GAD-7 change, only for pathways whose `monitoring_vitals` or screens include them. Add day 180 to the report. PHQ-9 and GAD-7 results are readable only by the patient and an audited treating clinician, never by `v_outcome_facts` consumers outside an admin analyst role, and never by sponsors.
2. **Honest reporting (22.1, 22.6).** Every figure shows enrolled, usable, insufficient and the comparator statement ("no comparison group"). Retire the modelled "cost avoided" figure from HMO and corporate pages until D-A5.
3. **Engagement family (22.2).** Retention and programme completion as a separate view; never inside outcomes. Uses S26 entitlements.
4. **Risk (22.3).** Map onto `risk_predictions` (no new `risk_scores` table, consistent with the D1 pattern in the S51 plan). Add a rule-based dropout and deterioration signal set in shadow, with reasons stored per score. A `risk-model` batch function writes scores nightly. The clinician worklist adds risk as a tiebreak inside a priority class. A DB test proves risk can never exclude a task from the queue or change eligibility. No ML model until outcome history exists.
5. **Accuracy (22.4).** Standing vignette suite in the triage package; a CMO and admin screen showing safe-urgency rate, over-triage rate, and S38e agreement. No diagnostic accuracy number is shown anywhere.
6. **Monthly report (22.5).** Server-rendered, deterministic, low bandwidth (HTML plus PDF reusing the quarterly report path). Shareable to Care Circle only for supporters with the matching permission; reproductive categories excluded unless the patient adds them. Emits `outcome.report_generated` through the outbox. Notification text is generic (INV-07).
7. **Operational views (22.7, 22.8).** One response-time and follow-up view over `clinical_tasks` and `pages`. A data-quality strip (completeness, timeliness, consistency, denominators) on every report.
8. **Exports (22.9).** Delivered with S79's report generator.

Acceptance: aggregate view below the minimum cohort returns suppressed values (spec); complementary suppression; test patient absent (INV-13); risk cannot deny care; PHQ and GAD never reachable from a sponsor role (sabotage test).

### S76: sign-in, queue, patient summary, titration, scribe, live prompts (23.1 to 23.7)

1. **23.1.** MDCN check record: checked date, verifier, outcome, re-check cadence in PROPOSED config; sweep marks stale checks for re-verification. Staff-run, no API claim.
2. **23.2.** Add device-alert, therapy-flag and mental health follow-up task types by configuration. Retire the old queues behind the unified one once parity is shown. Severity of trigger added as a second sort key.
3. **23.3.** Explicit second-clinician re-offer step in the ladder (priority promotion stays).
4. **23.4.** Patient summary adds symptom checks, assistant interactions (read through the audited function, narrow), documents and a trend view. Stays audited and tied (INV-10, INV-12).
5. **23.5.** Amend path for engine proposals and the review task (OQ-172). No step table is invented; it stays blocked on CMO content (OQ-171).
6. **23.6.** Draft letters, prescription drafts and follow-up tasks from the scribe, all unsigned and clearly marked (INV-11, INV-02). Store the edit diff with the signed note. Settle the two consent tables first (OQ-161).
7. **23.7.** `live_prompts` table and a deterministic `live-redflag` function over consented transcript segments using the shared red-flag rules from `@tarragon/clinical` (INV-01). Visual, dismissible, clinician only, every show and dismissal logged, own go-live guard, off by default. Speech source deferred (D-C4).

Tests: no prompt without a `scribe_consent`; prompt text never reaches the patient; dismissal logged; no model in the rule path; draft prescriptions cannot reach `prescriptions` unsigned.

### S77: orders, rota, credentialing, tiers, availability, Next task, lead (23.8 to 23.14)

1. **23.8.** One `clinical_follow_ups` closure object across prescription, referral, lab request and follow-up task: opened, acknowledged by the receiving party, closed with reason, overdue sweep. Inside the consult context.
2. **23.9.** Verify the patient-side urgent guidance route outside staffed hours; add a test.
3. **23.10.** Confirm "every red scenario answered correctly" in SQL with a test; the CMO authors scenario content (human task, OQ-105).
4. **23.11.** Add `maternal`, `mental_health`, `paediatrics` as competency data. Keep `doctor_tier` as the queue gate (D-C2).
5. **23.12.** Inactivity check for the pilot minimum; still dormant until a fee schedule is approved.
6. **23.13.** Task type creation screen for the CMO (create, version, confirm) plus the spec acceptance test: a type added by configuration appears in the queue with its class without a code change. Run the 50-session race on a real database.
7. **23.14.** Emit `order.paid` (OQ-126) so lead assignment follows purchase.

### S78: paging, response times, earnings, indemnity, speak-up, reliability, dashboards (23.15 to 23.21)

1. **23.15.** INV-05 watchdog: a scheduled check that any `triage.graded` red event with no page after a short threshold creates the page directly, independent of `process-events`. Emit `page.unacknowledged` and `clinician.task_completed`. Re-page when acknowledged but unresolved. No SMS (D-C1). Count and report every page and override.
2. **23.16.** `published_response_times` versioned config (written question by type 1 to 24 hours, live consultation 5 to 60 minutes, amber review 24 hours), a patient screen, and a nightly check of actual versus published. Needs CMO sign-off of the numbers (PROPOSED).
3. **23.17.** Verify the four blockers (OQ-193, 196, 197, test payout) and leave `payouts_enabled` off. Build nothing that turns it on.
4. **23.18.** Checklist item in the go-live guard dashboard for indemnity cover; not code (D-C3).
5. **23.19.** Emit `safety_concern.raised` to the protected path only; prove ops staff cannot see it.
6. **23.20.** Reliability used for rota fairness only; displayed to the clinician; never as a clinical-quality rank.
7. **23.21.** Clinician workload dashboard (open, claimed, handed back, ageing, on-call hours) and quality dashboard linked to S20 audits.

Close-out: confirm the module acceptance test; confirm all Stage 1 invariants for every new task type.

### S79: institution console (24.1 to 24.6)

1. **P1 first** (remove mental health from sponsor surfaces).
2. **Model.** Map spec "sponsors" onto the existing organisation roles (`corporate_admin`, `hmo_admin`, `payer_admin`, `ngo_admin`) per the reconciliation, and add only what has no live equivalent: `cohort_codes` (max uses, validity window, per cohort) and `usage_records`. Emit `cohort.enrolled`.
3. **Bulk upload.** Dry-run validation report (row errors, duplicates) before commit; approval step; no individual health data in the file.
4. **Programme configuration (24.2, 24.5).** One screen over pathways, therapy programmes, challenges, rewards and sponsored services. Challenge rewards never depend on disclosing health data.
5. **Reporting (24.3).** Rebuild on the S38 facts and shared suppression, enrolment and engagement plus cardiometabolic outcomes only. A data-quality strip. Check the `sponsor_reporting` consent. Audit-log every institutional aggregate read. NGO invitee list reduced to counts and status for the sponsor view; names visible only to the invited member's own flow (D-A4).
6. **Billing (24.4).** Invoices by active enrolled seat reconciled to the ledger; extend contracts and invoices to HMO, NGO and community sponsors. No capitation.
7. **Exports (24.6, 22.9).** One generator modelled on `payer_board_reports`: frozen, hashed, attestable, print and CSV, `sponsor.report_generated` event. Server-rendered only.
8. **Member notice.** In-app screen showing what the sponsor sees (counts only) and never sees (reproductive, pregnancy, mental health, individual records).

Acceptance: a sponsor user cannot query any individual record through any API (spec), including through the NGO invitee RPC; reproductive and mental health data absent from every sponsor path (sabotage); small cohort returns suppressed values.

### S80: operations and admin console (25.1 to 25.10)

1. **Content (25.1).** P5 gate on every content publish path; a single content review queue across health education, LPE blocks and course lessons; `content.published` event; published content shows reviewer, date and next review. Translation work dropped; the Pidgin test is replaced by the copy-review release gate (D-B2).
2. **KB change control (25.2).** Diff and impact view between protocol versions; run the vignette suite on a proposed change; retire and rollback flow. Signing stays with the CMO (D-B3).
3. **Directory (25.3, 25.9).** Add branch tables and `network_partner_organisations`; patient-facing "last verified" line; email in addition to in-app alerts only if the founder asks.
4. **Support inbox (25.4).** Staff form for phone intake, SLA timers and macros, no auto-close of clinical messages, remove `whatsapp` channel value (count-first), confirm S39b tying for `support_tickets`.
5. **Guards (25.5).** Enforce the four unenforced guards (`on_call_cover_ok`, `lab_booking_enabled`, `prescribing_enabled`, `payouts_enabled`; and `public_signup_enabled`) server-side and client-side, with a test per guard that the feature refuses while the guard is off (INV-14). This is the highest-value item in the module.
6. **Finance (25.6).** INV-15 lint audit of finance pages, dispute queue with deadline, settlement-to-ledger reconciliation view. Refund and tax scope waits on counsel and OQ-133.
7. **DSR (25.7).** Visible 30 day timer (counsel to confirm), audited export and erasure with retention exceptions, wire the export route (OQ-285) after S39d merges.
8. **Automation (25.8).** `automations` registry over the existing `pg_cron` jobs: owner, purpose, schedule, last run, pause (superadmin only, logged). Partner chasing generalised from referral chasing. Only reversible, low-risk tasks.
9. **AI monitoring (25.10).** Model cost table (token counts times a price config, kobo-equivalent in integer minor units), cost per feature, general conversation sampling queue with a purpose-built audited RPC (not a widened read policy), reported-answer view fed by S52, hazard log per registered AI system. No PHI to third-party tooling.

Acceptance: clinical content cannot publish without the clinical-reviewer path; unreviewed clinical copy blocks the release build; each guard refuses its feature while off.

---

## 7. Sequencing and parallelism

1. P1 to P6 (small, independent; P1, P2, P5 first). D-A1, D-A2, D-A3, D-A4, D-B1, D-B3 answered.
2. Close the Stage 1 gate (S40). Nothing below starts before it.
3. S75 and S79 share the suppression function, the report generator and the facts view: build the shared pieces in S75, consume them in S79. S75 before S79.
4. S76, S77, S78 are a strict chain (each depends on the previous per its prompt). S78's watchdog and S76's severity key can be reviewed together because both touch the queue and page paths.
5. S80 is independent of Module 23 and can run in parallel with S76 in a separate worktree, except the guard enforcement (item 5), which should be coordinated with the owners of each guarded feature.
6. Use fresh worktrees off `origin/main-dev` for every session (this branch is 136 commits behind), and work only on files under the repo path, not `.claude/worktrees` copies.

Relative sizing (engineering only): S75 medium to large, S76 large (live prompts, scribe drafts, summary), S77 medium, S78 medium, S79 large, S80 medium to large. Items needing humans, not code: CMO scenario test and titration step content, quality and queue config sign-off, fee schedule approval, Paystack test payout, counsel on DSR, erasure, contractor status, indemnity and cross-border rules, NHIA return format, pharmacy and DPA items from the release blocker list.

## 8. Items to log in `docs/OPEN-QUESTIONS.md` (not yet recorded)

- OQ-213 and OQ-214 (home versus clinic BP threshold; minimum cell size), referenced in the S38 design but absent.
- Mental health data shown to employers (PHQ-9 and GAD-7).
- `is_test` missing from institutional, payer, NGO, invoicing and risk surfaces (extends OQ-39).
- Inconsistent small-cell floors; `funding_programme_stats` unsuppressed; NGO invitee identity exposure.
- No audit log on institutional aggregate reads; `sponsor_reporting` consent unchecked.
- `outcomes_contracts` fee-at-risk and the modelled "cost avoided" figure versus no causal claims.
- Health education publish path without a clinical reviewer; no "clinical reviewer" role defined.
- S80 Pidgin acceptance test versus D-14; `translations` table not built.
- Conflicting memory rules on agent signing (D-B3).
- INV-05 single dependency on the outbox; `page.unacknowledged`, `clinician.task_completed`, `safety_concern.raised`, `content.published`, `cohort.enrolled`, `sponsor.report_generated` events not emitted.
- D-12 versus OQ-05 wording on SMS paging.
- Spec tier 1 and tier 2 versus F-05.
- `whatsapp` still a `support_tickets` channel value.
- No model cost table; no general conversation sampling.
- No OQ numbered 543 exists; the S51 plan cites it as "OQ-543". Use OQ-99 and OQ-209 for the console boundary.

## 9. Limits of this review

- Code and migrations only. No live database state, no screens opened in a browser, nothing run. The Module 23 and 25 audits read `origin/main-dev`; the Module 22 and 24 audit read this stale branch, so anything merged since may already exist.
- Competitor research was a quick pass. Roughly half the named products could not be checked and are marked [U]. No clinician complaint data was found for any product. Vendor outcome figures are marketing claims, and Omada and Ada study authors include company staff.
- NDPA response deadlines and the MDCN verification mechanism were not confirmed against primary sources.
- Apply statuses (S24b, S36k, S35c, S39f) are inferred from progress notes and memory and may be stale.
