# Tarragon v5 build: session index

Each file in this folder is one self-contained prompt. Open it, paste everything under the line into a **fresh** Claude Code session, let it finish, then move on. Sessions hand off through `docs/BUILD-PROGRESS.md` in the repo, so no session needs the previous one's chat.

## How to use

1. Put `TARRAGON-BUILD-SPEC-v5.md` in the repo at `docs/BUILD-SPEC-v5.md` (the prompts use that path; global search-and-replace if yours differs). Line numbers in every prompt refer to this exact file version. If you edit the spec, regenerate or the ranges will drift.
2. Run **S01 first**. It reconciles v5 with the code that already exists (see 'Read before S01' below).
3. Follow the order. Part A (S01 to S40) builds Stage 1. **S40 is a gate**: Part B (S41 onward) refuses to start until S40 has written 'Stage 1 complete'.
4. Inside Part B, run modules in release order below (or any order you like once S40 is done, except where 'Depends on' says otherwise).
5. One session = one section. Each ends by logging to `docs/BUILD-PROGRESS.md` and stopping.

## Read before S01: founder decisions

See [00-FOUNDER-DECISIONS.md](00-FOUNDER-DECISIONS.md). Platform Credit and WhatsApp are removed (sessions S01b and S01c, run right after S01); the clinician model is hybrid (freelance plus employed); the staff console is extracted into `apps/console` (S01d).

## Original collisions list (now resolved by the decisions above)

The v5 spec and the live platform (apps/web, ~800 migrations) disagree on several things. S01 will list them in `docs/OPEN-QUESTIONS.md`; you need to decide them, Claude should not. Examples: v5 INV-09 and Part C.2 ban any stored balance, but the current platform has Platform Credit; v5 removes WhatsApp and SMS reminders, current platform has a WhatsApp channel; v5 uses freelance clinicians and a Next-task queue, current platform has employed doctors and auto-assignment; v5 lays out `apps/patient` + `apps/console`, current repo has `apps/web` + `apps/mobile`; v5 has roles `patient/supporter/clinician/clinical_lead/ops/admin/partner_*`, current uses a different role model. Decide per item: v5 wins, current wins, or both.

## Part A: Stage 1 (blood pressure journey and clinician network)

| ID | Section | Milestone | Depends on |
|---|---|---|---|
| [S01](S01-reconcile-with-the-existing-platform-docs-scaffold.md) | Reconcile with the existing platform, docs scaffold, foundations | M0 | - |
| [S01b](S01b-remove-platform-credit.md) | Remove Platform Credit | M0 follow-up | S01 |
| [S01c](S01c-remove-whatsapp.md) | Remove WhatsApp | M0 follow-up | S01 |
| [S01d](S01d-extract-staff-console-app.md) | Extract staff console into apps/console | M0 follow-up | S01, S01b, S01c |
| [S02](S02-identity-access-and-consent-data-model-with-rls-ba.md) | Identity, access and consent data model with RLS baseline | M1 | S01 |
| [S03](S03-sign-up-verification-password-biometric-unlock-rec.md) | Sign-up, verification, password, biometric unlock, recovery | M1 | S02 |
| [S04](S04-consent-dependants-and-set-up-for-my-parent-proxy.md) | Consent, dependants and Set up for my parent (proxy) | M1 | S03 |
| [S05](S05-health-record-data-model-observations-symptoms-med.md) | Health record data model: observations, symptoms, medications | M2 | S02 |
| [S06](S06-offline-store-and-outbox-sync.md) | Offline store and outbox sync | M2 | S05 |
| [S07](S07-today-screen-bp-logging-trends-and-reminders.md) | Today screen, BP logging, trends and reminders | M2 | S06 |
| [S08](S08-medications-schedules-dose-events-adherence-refill.md) | Medications, schedules, dose events, adherence, refill reminders | M2 | S05, S06 |
| [S09](S09-my-health-tab-timeline-emergency-card-share-link.md) | My Health tab: timeline, emergency card, share link | M2 | S05 |
| [S10](S10-event-bus-and-outbox-processor.md) | Event bus and outbox processor | M3 | S05 |
| [S11](S11-triage-engine-packages-clinical-with-100-percent-b.md) | Triage engine (packages/clinical) with 100 percent branch coverage | M3 | S10 |
| [S12](S12-triage-wiring-events-patient-tasks-on-device-red-d.md) | Triage wiring: events, patient tasks, on-device red detection, emergency guidance | M3 | S11, S07 |
| [S13](S13-notifications-framework-with-inv-07-lint.md) | Notifications framework with INV-07 lint | M3 | S10 |
| [S14](S14-provider-adapters-paystack-skeleton-videoprovider-.md) | Provider adapters: Paystack skeleton, VideoProvider and SpeechToText interfaces with mocks | M3 | S13 |
| [S15](S15-clinician-network-data-model-and-credentialing-wor.md) | Clinician network data model and credentialing workflow | M4 | S02 |
| [S16](S16-clinical-tasks-table-state-machine-task-types-and-.md) | clinical_tasks table, state machine, task types and priority classes | M4 | S15, S10 |
| [S17](S17-next-task-eligibility-priority-atomic-claim-hand-b.md) | Next task: eligibility, priority, atomic claim, hand-back, timeouts | M4 | S16 |
| [S18](S18-lead-clinician-assignment-availability-and-rota.md) | Lead clinician assignment, availability and rota | M4 | S16 |
| [S19](S19-red-event-paging-and-escalation.md) | Red event paging and escalation | M4 | S18, S12 |
| [S20](S20-quality-and-safety-audits-reliability-hand-back-re.md) | Quality and safety: audits, reliability, hand-back review, speak-up, licence expiry job | M4 | S17 |
| [S21](S21-encounters-booking-and-consultation-video-with-aud.md) | Encounters, booking and consultation video with audio fallback | M5 | S14, S18 |
| [S22](S22-written-questions-and-clinical-notes.md) | Written questions and clinical notes | M5 | S21 |
| [S23](S23-ai-scribe-consent-speech-to-text-claude-draft-sign.md) | AI scribe: consent, speech to text, Claude draft, sign | M5 | S22 |
| [S24](S24-prescriptions-referrals-care-plan-changes-and-titr.md) | Prescriptions, referrals, care plan changes and titration proposals | M5 | S22, S11 |
| [S25](S25-catalogue-prices-orders-paystack-checkout-and-webh.md) | Catalogue, prices, orders, Paystack checkout and webhooks | M6 | S14 |
| [S26](S26-entitlements-care-pack-lifecycle-and-refunds.md) | Entitlements, care pack lifecycle and refunds | M6 | S25 |
| [S27](S27-partner-portal-lab-orders-result-entry-release-rul.md) | Partner portal: lab orders, result entry, release rules | M7 | S25, S13 |
| [S28](S28-pharmacy-partner-prescriptions-to-pharmacy-dispens.md) | Pharmacy partner: prescriptions to pharmacy, dispensing | M7 | S24, S27 |
| [S29](S29-care-circle-invites-permissions-supporter-views-pa.md) | Care Circle: invites, permissions, supporter views, pay for a loved one | M8 | S26, S13 |
| [S30](S30-fee-schedules-and-the-earnings-ledger.md) | Fee schedules and the earnings ledger | M9 | S17 |
| [S31](S31-weekly-payouts-drafts-approval-paystack-transfers-.md) | Weekly payouts: drafts, approval, Paystack transfers, statements, bank verification | M9 | S30 |
| [S32](S32-audio-manifest-bundling-and-number-stitching.md) | Audio manifest, bundling and number stitching | M10 | S12 |
| [S33](S33-bp-care-course-lessons-breathing-exercise-and-en-p.md) | BP care course lessons, breathing exercise and en/pcm content | M10 | S32 |
| [S34](S34-low-data-mode-accessibility-performance-and-app-si.md) | Low-data mode, accessibility, performance and app size | M10 | S32, S33 |
| [S35](S35-console-clinician-area-and-patient-summary.md) | Console: clinician area and patient summary | M4-M5 | S17, S23 |
| [S36](S36-console-operations-clinical-lead-and-admin-areas.md) | Console: operations, clinical lead and admin areas | M9-M10 | S35 |
| [S37](S37-go-live-guards-dashboard-and-proposed-config-sign-.md) | Go-live guards dashboard and PROPOSED-config sign-off screen | M10 | S36 |
| [S38](S38-outcome-snapshots-and-analytics-schema.md) | Outcome snapshots and analytics schema | M10 | S26, S12 |
| [S39](S39-security-privacy-and-compliance-hardening.md) | Security, privacy and compliance hardening | M10 | S38 |
| [S40](S40-stage-1-completion-gate.md) | Stage 1 completion gate | M10 | S39 |

## Part B: every module (start only after S40)

Suggested release order: Release 1 completion (M7, M12, M13 diabetes half, M1 cohort codes, M23 later task types), Release 2 (M2, M3, M4, M5, M6, M8, M9, M10, M11, M15, M17, M18, M19, M20, M21, M25), Release 3 (M13 rest, M14, M16), Release 4 (M22, M24, M26). Column 'Release' is the module's first later release.

| ID | Section | Release | Depends on |
|---|---|---|---|
| [S41](S41-module-1-account-sign-in-and-consent-1-of-2-sign-u.md) | Module 1: Account, sign-in and consent (1 of 2: sign-up, profile and onboarding) | R1c | S40 |
| [S42](S42-module-1-account-sign-in-and-consent-2-of-2-consen.md) | Module 1: Account, sign-in and consent (2 of 2: consent, privacy and dependants) | R1c | S41 |
| [S43](S43-module-2-health-passport-and-interoperability-1-of.md) | Module 2: Health Passport and interoperability (1 of 2: record, vaccination, emergency card) | R2 | S40 |
| [S44](S44-module-2-health-passport-and-interoperability-2-of.md) | Module 2: Health Passport and interoperability (2 of 2: interoperability) | R2 | S43 |
| [S45](S45-module-3-risk-screening-and-health-reports-1-of-2-.md) | Module 3: Risk, screening and health reports (1 of 2: risk, calendar, packages) | R2 | S40 |
| [S46](S46-module-3-risk-screening-and-health-reports-2-of-2-.md) | Module 3: Risk, screening and health reports (2 of 2: engine logic, results and Health Report) | R2 | S45 |
| [S47](S47-module-4-today-screen-and-daily-log.md) | Module 4: Today screen and daily log | R2 | S40 |
| [S48](S48-module-5-activity-fitness-and-movement.md) | Module 5: Activity, fitness and movement | R2 | S40 |
| [S49](S49-module-6-food-and-nutrition-1-of-2-logging.md) | Module 6: Food and nutrition (1 of 2: logging) | R2 | S40 |
| [S50](S50-module-6-food-and-nutrition-2-of-2-guidance.md) | Module 6: Food and nutrition (2 of 2: guidance) | R2 | S49 |
| [S51](S51-module-7-ai-health-assistant-1-of-2-conversation-e.md) | Module 7: AI health assistant (1 of 2: conversation, explanations and hand-offs) | R1c | S40 |
| [S52](S52-module-7-ai-health-assistant-2-of-2-safety-transpa.md) | Module 7: AI health assistant (2 of 2: safety, transparency, memory and clinician review) | R1c | S51 |
| [S53](S53-module-8-medicines-and-pharmacy-1-of-2-schedule-an.md) | Module 8: Medicines and pharmacy (1 of 2: schedule and adherence) | R2 | S40 |
| [S54](S54-module-8-medicines-and-pharmacy-2-of-2-pharmacy-an.md) | Module 8: Medicines and pharmacy (2 of 2: pharmacy and further detail) | R2 | S53 |
| [S55](S55-module-9-health-learning-centre.md) | Module 9: Health Learning Centre | R2 | S40 |
| [S56](S56-module-10-mental-wellbeing-sleep-and-meditation-1-.md) | Module 10: Mental wellbeing, sleep and meditation (1 of 2: check-ins, screening and human care) | R2 | S40 |
| [S57](S57-module-10-mental-wellbeing-sleep-and-meditation-2-.md) | Module 10: Mental wellbeing, sleep and meditation (2 of 2: meditation and sleep library) | R2 | S56 |
| [S58](S58-module-11-rewards-and-engagement.md) | Module 11: Rewards and engagement | R2 | S40 |
| [S59](S59-module-12-symptom-checker-and-health-assessment-1-.md) | Module 12: Symptom checker and health assessment (1 of 2: assessment) | R1c | S40 |
| [S60](S60-module-12-symptom-checker-and-health-assessment-2-.md) | Module 12: Symptom checker and health assessment (2 of 2: safety) | R1c | S59 |
| [S61](S61-module-13-condition-pathways-1-of-2-pathways.md) | Module 13: Condition pathways (1 of 2: pathways) | R1c/R3 | S40 |
| [S62](S62-module-13-condition-pathways-2-of-2-engine-and-fur.md) | Module 13: Condition pathways (2 of 2: engine and further detail) | R1c/R3 | S61 |
| [S63](S63-module-14-digital-therapy-programmes.md) | Module 14: Digital therapy programmes | R3 | S40 |
| [S64](S64-module-15-consultations-and-care-access-1-of-2-con.md) | Module 15: Consultations and care access (1 of 2: consultations) | R2 | S40 |
| [S65](S65-module-15-consultations-and-care-access-2-of-2-dir.md) | Module 15: Consultations and care access (2 of 2: directory, emergencies, further detail) | R2 | S64 |
| [S66](S66-module-16-women-s-maternal-and-child-health-1-of-3.md) | Module 16: Women's, maternal and child health (1 of 3: menstrual and reproductive) | R3 | S40 |
| [S67](S67-module-16-women-s-maternal-and-child-health-2-of-3.md) | Module 16: Women's, maternal and child health (2 of 3: pregnancy) | R3 | S66 |
| [S68](S68-module-16-women-s-maternal-and-child-health-3-of-3.md) | Module 16: Women's, maternal and child health (3 of 3: postnatal and child) | R3 | S67 |
| [S69](S69-module-17-care-circle-and-community.md) | Module 17: Care Circle and community | R2 | S40 |
| [S70](S70-module-18-devices-wearables-and-data-connections.md) | Module 18: Devices, wearables and data connections | R2 | S40 |
| [S71](S71-module-19-checkout-and-payments-1-of-2-core-checko.md) | Module 19: Checkout and payments (1 of 2: core checkout, sponsor and HMO payment) | R2 | S40 |
| [S72](S72-module-19-checkout-and-payments-2-of-2-receipts-po.md) | Module 19: Checkout and payments (2 of 2: receipts, points, instalments, entitlements, payment requests) | R2 | S71 |
| [S73](S73-module-20-pricing-engine.md) | Module 20: Pricing engine | R2 | S40 |
| [S74](S74-module-21-partner-network-and-commerce.md) | Module 21: Partner network and commerce | R2 | S40 |
| [S75](S75-module-22-outcomes-and-population-health-analytics.md) | Module 22: Outcomes and population health analytics | R4 | S40 |
| [S76](S76-module-23-clinician-console-1-of-3-sign-in-queue-p.md) | Module 23: Clinician console (1 of 3: sign-in, queue, patient summary, proposals, scribe) | R1c+ | S40 |
| [S77](S77-module-23-clinician-console-2-of-3-orders-rota-cre.md) | Module 23: Clinician console (2 of 3: orders, rota, credentialing, tiers, Next task, lead clinician) | R1c+ | S76 |
| [S78](S78-module-23-clinician-console-3-of-3-paging-response.md) | Module 23: Clinician console (3 of 3: paging, response times, earnings, speak-up, audit) | R1c+ | S77 |
| [S79](S79-module-24-institution-console.md) | Module 24: Institution console | R4 | S40 |
| [S80](S80-module-25-operations-and-admin-console.md) | Module 25: Operations and admin console | R2 | S40 |
| [S81](S81-module-26-research-and-evidence-governance.md) | Module 26: Research and evidence governance | R4 | S40 |

## Cross-cutting audits (Part D and Part C)

| ID | Section | Depends on |
|---|---|---|
| [S82](S82-cross-cutting-audit-connectivity-devices-language-.md) | Cross-cutting audit: connectivity, devices, language and accessibility (D.1, D.2) | S40 |
| [S83](S83-cross-cutting-audit-privacy-security-and-regulator.md) | Cross-cutting audit: privacy, security and regulatory map (D.3, D.6) | S40 |
| [S84](S84-cross-cutting-audit-clinical-and-ai-governance-d-4.md) | Cross-cutting audit: clinical and AI governance (D.4, D.5, D.10) | S40 |
| [S85](S85-cross-cutting-end-to-end-journeys-d-7.md) | Cross-cutting: end-to-end journeys (D.7) | S40 |
| [S86](S86-cross-cutting-adding-languages-framework-d-8.md) | Cross-cutting: adding languages framework (D.8) | S40 |
| [S87](S87-cross-cutting-part-c-conformance-scan-do-not-build.md) | Cross-cutting: Part C conformance scan (do not build list) | S40 |

Total sessions: 90.