# S76 to S80: built state vs competitors, and what to build next

Date: 2026-10-22. Read-only analysis. Nothing was changed, committed or applied.

## Status update, 2026-10-28 (read this first)

This analysis was written on 2026-10-22 and the build it recommended has since shipped. Six PRs closed the gaps that code can close:
#1338 (clinician app), #1339 (clinician database), #1340 (scribe), #1341 (institution console), #1342 (support, symptom-KB change control, AI
monitoring) and #1343 (content review, directory freshness, settlement tie-out). All merged to main-dev on 2026-10-27 and 2026-10-28, every
new feature behind a guard or module switch that is OFF. The sections below are kept as the record of the analysis; they describe the state
before the build, not now.

Two corrections to the text below:
- **The S-3 "safety check" was a false alarm.** CMO decision S-3 (remove mental health, reproductive and pregnancy data from every sponsor
  surface) was superseded in part by DECISIONS S75-9 (2026-10-14): the sponsor pack carries PHQ-9 and GAD-7 only as suppressed group figures
  through `private.outcome_measure_cohort`, never a person or an item answer. Reproductive and pregnancy data stay out of sponsor surfaces.
  Do not treat S-3 as an open gap.
- The audit's other findings held. Items still open after the build: a re-offered task can still be claimed by the previous holder; the
  re-offer ignores the lead-clinician window; a folded "other services" usage amount can still identify one person (needs a finance and DPO
  decision, OQ-S79-4); the stale-partner hide guard is not honoured by lab order resolution. Human-owned items (CMO signatures, AI-017
  evaluation, a speech-to-text vendor, fee schedule and withholding tax, device testing) are unchanged.

The competitor research behind this file was thin (7 to 11 standard searches per stream, few pages opened); treat unsourced competitor
claims as leads to confirm in a demo.

## How much to trust this

- Code audits read `origin/main-dev` (BUILD-PROGRESS, design notes, migrations, routes). Nothing was run, no live database was queried, no screen was clicked through.
- Competitor research was thin: 7 to 11 standard searches per stream, few pages opened. Sourced items are marked. Everything else is a lead to confirm in a demo or a second research pass.
- Not verified at all: Omada, Hinge, Sword, Teladoc, Doximity, Doctolib, Helium Health, Nigerian HMOs, Healthily, Ada, Practo, Vezeeta, Medplum, Retool. Reddit and KLAS review text was not reached.

## Headline

1. S76 to S78 (clinician console) are mostly built as code, but almost nothing is live or proven. They have no BUILD-PROGRESS entries, the last proof run was incomplete, and many CMO configs are unsigned so features sit inert.
2. S79 (institution console) is mostly already built under other names (employer platform, sponsor cohorts, NGO cohort, payer module). It has no design note. Do not build a new sponsors layer.
3. S80 (ops console) is partly built (a prior partial build, S80a to c). Its four migrations were not applied to production as of 2026-10-07, which needs checking.
4. Against competitors the breadth is already ahead of most. The gaps are depth, reachability and verification, not missing modules.

## Safety check before any new feature (superseded: see the status update above, S-3 was a false alarm)

- Sponsor surfaces: CMO decision S-3 says mental health, reproductive and pregnancy data must be removed from every sponsor surface, with a scan test on sponsor loaders. The audit found no evidence it was done, and campaign topics still include "Mental wellbeing". Verify first.
- 23.7 live red-flag prompts: the component is mounted nowhere and the guard is off. Do not describe it as a feature.

## S76 to S78: Module 23 clinician console (21 functions)

Status key: BUILT = code and proofs exist (not live-proven). PARTIAL = part missing. OFF = built, guard off.

| id | status | main gap |
|---|---|---|
| 23.1 sign-in, MDCN | PARTIAL | Staff-run register check, no API. MFA opt-in only. 12-month recheck config unsigned; 2 clinicians lack a licence date. |
| 23.2 unified queue | PARTIAL | No producer for symptom-review tasks (OQ-432). Device, therapy, mental-health producers unconfirmed. Old queues not retired. |
| 23.3 SLA timers, second clinician | PARTIAL | Second-clinician re-offer is design only. Escalation is priority promotion plus a CMO alert. |
| 23.4 patient summary | BUILT (code) | Assistant interactions not confirmed. Not in the consultation room (OQ-210). Not browser-tested. |
| 23.5 titration proposals | PARTIAL | Engine exists, nothing seeded. CMO has not approved the hypertension step table (OQ-171). |
| 23.6 AI scribe | PARTIAL | Note and summary drafts only. No letters, prescription drafts, follow-up tasks or stored edit diff. No speech-to-text (OQ-96). AI-017 off, unevaluated. Never run in a browser. |
| 23.7 live red-flag prompts | PARTIAL, OFF | Engine and browser matcher only. No edge function, no audio, component unmounted, four attestations unmet. |
| 23.8 e-prescribing, referrals, labs, follow-ups | PARTIAL | Follow-up closure built, overdue times unsigned so the sweep is inert. Lab-request object unconfirmed. |
| 23.9 rota, on-call | BUILT | Readiness v2 awaits CMO sign-off and test pages. |
| 23.10 credentialing | PARTIAL | CMO has not written scenario or training content (OQ-105), so nobody can pass. |
| 23.11 tiers, competencies | PARTIAL | Uses `doctor_tier` (F-05), not literal tier 1 and 2. Competency scenarios unwritten. |
| 23.12 declared availability | BUILT, dormant | No fee schedule, pilot minimum empty, nothing ever paid. |
| 23.13 Next task | BUILT | Real 50-session race on a real database not confirmed. |
| 23.14 lead clinician | BUILT | Depends on `order.paid` being emitted by checkout (OQ-126). |
| 23.15 red-event paging | BUILT, partly off | Re-page and watchdog config v2 unsigned. No real-device test. No SMS by decision. |
| 23.16 published response times | PARTIAL | Numbers deliberately not published (S-9). A stale "Reply within N hours" string conflicts. |
| 23.17 earnings, payouts | BUILT, OFF | Guard off. 0 fee schedules, 0 ledger lines, 0 payouts. Paystack transfer never run, even in test mode. Withholding tax unresolved (OQ-193). |
| 23.18 group indemnity | PARTIAL | By design an ops and legal attestation, not a feature. |
| 23.19 speak-up | BUILT | No global "raise from any screen" button found. `safety_concern.raised` event deliberately not emitted. Independent reader not appointed. |
| 23.20 reliability, audits | BUILT / PARTIAL | Advisory and own-view only by decision. Configs unsigned. |
| 23.21 audit, incidents, dashboards | PARTIAL | Workload page never opened in a browser. No dedicated incident-reporting flow. |

Spec items overtaken by later decisions: 23.16 numbers (S-9), 23.7 edge function (shipped as browser matcher), 23.11 tiers (F-05), 23.17 founder-only approval (CMO may also approve), 23.15 SMS and voice paging (S-8), 23.19 event name.

## S79: Module 24 institution console

| id | status | note |
|---|---|---|
| 24.1 cohorts, codes, bulk upload | BUILT (as employer platform and sponsor cohorts) | Two parallel code systems (employer join code, sponsor cohort code). HMO and community-group upload unchecked. |
| 24.2 programme configuration | PARTIAL | No single screen for pathways, challenges, rewards, sponsored services. Employer-funded reward pools unbuilt (OQ-S58-06). |
| 24.3 aggregate reporting | BUILT | Minimum group size and held-back months exist. S-3 later found superseded by S75-9, see the status update. |
| 24.4 invoices, contracts, usage billing | PARTIAL | No `usage_records`, no usage billing. |
| 24.5 wellbeing campaigns | BUILT | Rewards not configurable from an institution screen. |
| 24.6 procurement and renewal reports | PARTIAL | CSV of programme figures only. No renewal pack. Reports page has no export. |

Rules that stand: no capitation (I8), sponsors see aggregates only (I9). Sponsor staff read frozen monthly snapshots, they cannot run reports themselves.

## S80: Module 25 operations and admin console

| id | status | note |
|---|---|---|
| 25.1 content CMS | PARTIAL | 213 published items never clinician-reviewed (CMO decision pending). Two review-date columns unmerged. Translation gate not wired (English only). |
| 25.2 symptom KB change control | PARTIAL | CMO-only signing exists. No diff view or regression run. |
| 25.3 directory and partners | BUILT | Branch coverage unclear. |
| 25.4 support inbox | PARTIAL | App tickets and phone intake. No email intake, no SLA clock, no red-flag scan on inbound messages. |
| 25.5 config, flags, guards | BUILT | `on_call_cover_ok` and `public_signup_enabled` not enforced. |
| 25.6 finance | BUILT | About 20 pages. S80 finance landing and partner statement not built. |
| 25.7 safety, privacy, DSR | PARTIAL | Data-rights screen exists. DSR request centre status unclear. |
| 25.8 automation | BUILT (registry) | Owners unassigned. Partner chasing not evidenced. |
| 25.9 freshness alerts | BUILT | In-app only. No email, no patient-facing "last checked". |
| 25.10 AI monitoring | PARTIAL | No sample scheduler, no model prices loaded, CMO has not signed the sample rate. |

## Competitor findings worth acting on

Sourced unless marked (lead).

Clinician console (S76 to S78)
- Glooko: risk tiers, missing data as its own tier, severity order inside each tier.
- Epic In Basket: claim and release from a pool, rotating coverage; inbox load is the top burnout driver.
- CommCare: offline-first, priority task list, supervisor view of overdue follow-ups.
- Current Health: per-patient alert thresholds. A 2025 JMIR single-site study found raising BP alert thresholds 5 to 10 mmHg cut alerts about half.
- Scribes (Abridge, Heidi, Corti, Epic AI Charting): sentence-to-transcript linking, unsupported-claim flagging, orders as proposals, a hallucination report button, specialty templates. Doctors report invented content; review time often cancels savings (lead on exact rates). No scribe found with Nigerian-language clinical accuracy.

Institution console (S79; mostly leads)
- Wellhub (verified): eligibility file via portal, SFTP or API, add/remove/replace modes, payroll-deduction file, invoices.
- Public small-cell rules: suppress under 5 to 11. Recommended here: 10 for any tile, 20 for outcome or risk bands, 30 when cut a second way, plus complementary suppression and rate-limiting repeated filters. This is a recommendation, needs CMO and DPO sign-off.

Ops console (S80)
- Contentful: role-owned stages, publish blocked while review tasks are open.
- Crowdin: editing source text resets translations to needs-review.
- Infermedica: public changelog, semantic versions, gradual rollout.
- LaunchDarkly: named approver, diff, scheduled apply, history, rollback.
- Langfuse: one-at-a-time reviewer queue with scoring and corrected answers.
- Paystack: transactions are gross, settlements net; reconcile into matched, missing here, missing there.
- Zocdoc: pre-listing checks then periodic reconfirm and stale signals.

## What to build in this session, in order

Safety and truth first
1. ~~Verify and enforce S-3 on sponsor surfaces~~ (not needed: superseded by DECISIONS S75-9). (S79)
2. Check which S75 to S80 migrations are applied to production; re-run the S76 to S78 proof suite on a clean replay; write the missing BUILD-PROGRESS entries and an S79 design note. Check that `20261007160301_s75_80_review_fixes.sql` landed. (S76 to S78 debt)
3. Remove the stale "Reply within N hours" string that conflicts with S-9. (23.16)

Closing real gaps (no new product risk)
4. Mount the live red-flag component in the consultation room (resolve OQ-210) and build the typed-text path end to end, still behind its guard. (23.7, 23.4)
5. Scribe: stored edit diff between draft and signed text, then letter and follow-up drafts under a governed prompt. (23.6)
6. Second-clinician re-offer on SLA breach. (23.3)
7. Global "raise a concern" entry on every clinician screen. (23.19)
8. Producers for symptom-review, device-alert and mental-health tasks. (23.2)
9. S79: single programme-configuration screen; procurement and renewal pack; `usage_records` for usage statements; unify the two cohort code systems.
10. S80: support email intake and SLA clock with inbound red-flag scan (INV-01, INV-05); KB version diff and regression run; AI sample scheduler; enforce the two remaining go-live guards; email notice for stale listings.

Differentiators from the research (new)
11. "Why this task, why now" reason string on every queue item, with the SLA clock. Queue stays unbrowsable.
12. Silence-as-signal tier: no readings for N days raises a flag.
13. Threshold "blast radius" preview: replay 30 days of readings before the CMO signs a threshold change. (Raised independently by two research streams.)
14. Deterministic live prompts from the rule engine, not a model, as the stated differentiator versus Corti.
15. Private Nigerian-accent speech test set with per-language error rates, each language behind a flag until it passes.
16. Partner freshness score that decays and hides a stale partner from routing.
17. Sponsor-visible privacy ledger listing suppressed cells and why.
18. Dual-key sign-off enforced in the database: author of safety content cannot be its clinical approver.
19. Risk-weighted AI sampling: always review emergencies, cost spikes and reported wrong answers, plus a small random sample.
20. Daily automated settlement tie-out posting exceptions to the finance queue.

## Founder or CMO decisions this depends on

- Sign the pending configs (paging v2, readiness v2, response times, follow-up overdue times, credentialing v4, quality v3, AI sample rate). Until then these stay inert.
- Author the scenario test and training content (OQ-105) and approve the hypertension step table (OQ-171).
- Decide on a fee schedule and withholding tax (OQ-193) before any payout is tried.
- A basic-phone fallback (USSD or SMS) was suggested by research. It conflicts with the app and web only rule, so it is a founder call, not a build.
- Do not switch on payer, provider-org or NGO modules, or any off guard, without founder approval.
