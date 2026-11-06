# Doctor clinical workspace: Phase 0 discovery, gap analysis and plan (2026-11-06)

Status: discovery complete, Phase 1 proposal, one safe slice built (section 9). Source brief: the founder's "Tarragon Health 2.0 Doctors' Dashboard" specification, pasted 2026-11-06 (26 parts, phases 0 to 8). This doc is the spec's required initial output (its section 2: eight deliverables). It builds on, and does not replace, `docs/design/DASHBOARD-PROGRAMME-CLINICIAN-FIRST.md` (2026-10-30) and `docs/research/S35.md`.

Method and limits: a code and migration read of `origin/main-dev` at `aef234472`, by three parallel searches plus direct reads. No signed-in clinician session was run in a browser in this pass and no live data was queried, so everything below about behaviour comes from code, not from looking at it.

Stack confirmed (the spec warns against Django): Next.js 16 App Router (`apps/web`), Supabase Postgres with RLS and SECURITY DEFINER RPCs, Tailwind v4 CSS-first tokens in `packages/ui/src/theme.css`, shared primitives in `packages/ui`, display logic in `packages/shared`, Recharts 3 via `packages/ui/src/components/chart.tsx`, lucide icons, Inter and Sora fonts. Nothing in this plan introduces a new stack.

---

## 1. Current dashboard assessment

The clinician console is functionally deep and structurally scattered.

**Strong already**
- Safety plumbing is real and tested: auto-assignment to a qualifying doctor, availability-aware routing, an acknowledge-gated paging ladder, an in-console red-page alarm on every page (`OnCallAlarm`), an always-visible safety concern button, and about 810 DB proofs.
- "Unknown is not zero": every home count, badge and hero renders a failed read as unknown, never as the all-clear (`packages/shared/src/clinician-home.ts`, `useWorklistCounts`).
- The home already leads with work: `NextActionHero`, then `TodayStrip`, then urgent escalations (PR 2 of the clinician-first programme).
- Clinical authority is enforced in the database per action (`has_prescribing_authority`, `can_handle_emergency_escalation`), not by which page a login can reach.
- Records are append-only where it matters: finalized notes are immutable, amendments are linked rows, `patient_timeline` is append-only, record opens are audited (`staff_record_opens`).

**Weak**
- **Navigation overload.** The doctor sidebar has 140 links in 8 groups (`apps/web/src/lib/navigation.ts`, about lines 405 to 778): Queue 18, Patients and Care 9, Orders and Referrals 4, Quality and Growth 14, My work 34, Clinical governance 44, Operations administration 16. Governance and ops pages sit beside daily clinical work, and the nav is not filtered by tier (CMO-only pages self-gate after the click).
- **No global patient search for doctors.** The command palette (`components/shell/admin-search.tsx`) is built only for admin, the active CMO and patients, and searches pages, not patients. `search_patient_record` exists in the database and is called nowhere in `apps/`.
- **Several queues, no single worklist.** Alerts (`worklist.tsx` on the home page), escalations (`/clinician/escalations`), pull-next tasks (`/clinician/queue`), ten organisation-wide worklist kinds (`/clinician/worklists`), results (`/clinician/results-inbox` and `/clinician/lab-results`), messages, and about 20 specialist review pages each hold part of "what needs me". There is no `/clinician/tasks` index.
- **The patient record header lacks safety information.** Name, number, date of birth and phone are shown. Allergies, age, sex, consent indicators and active alerts are not; allergies appear only inside the decision-support, medication-safety and notes panels. All 12 tabs stay mounted at once (`patient-record-tabs.tsx`).
- **No environment indicator.** Nothing tells a doctor they are on a preview deployment rather than production.
- **Two consultation stacks.** Appointment Engine plus `video_consultations` (Zoom), and S21 `encounters` plus `encounter_rooms`. They overlap on identity confirmation, pre-call review and recording.
- **No clinician personalisation** (no saved views, default filters, density or widget choice) and **no staff notification centre** beyond the shared bell.

## 2. Existing feature inventory

Paths: M = `supabase/migrations/`, P = `apps/web/src/app/(dashboard)/clinician/`.

| Spec area | What exists | Main objects | Pages |
|---|---|---|---|
| Overview and home | Hero, today strip, urgent escalations, notes to complete, three priority buckets, KPI tiles, alert worklist, CMO governance card | `escalations`, `clinician_alerts`, `clinical_worklist`, `my_pending_auto_drafted_notes` | P/page.tsx (624 lines) |
| Escalations and alerts | Two models: `escalations` (open, under_review, resolved, referred) and `clinician_alerts` (5 levels, 5 statuses, severity 0 to 4, category, type_code, owner and backup, dedup, snooze, resolution action and outcome required at severity 2 or above) | `alert_rules`, `escalation_slas` (versioned, CMO-signed), `clinician_alert_ack_escalations` | P/escalations, P/escalations/[id], home worklist, P/on-call |
| Pull-next queue | S16 `clinical_tasks` with versioned `task_types` (priority class 1 to 9), claims, hand-back with reasons, append-only transitions | `queue_next`, `queue_complete`, `queue_handback` | P/queue, P/tasks/[taskId] |
| Patient record | 12 tabs: overview, decision support, medications, care plan, 12-week programme, vitals and chronic care, screening, healthy ageing, notes, women's health, records and investigations, referrals | `patient_timeline`, `log_patient_record_view` | P/patients/[patientId] |
| Patient finding | Name ilike, condition search, filter tabs (everyone, mine, recent, high risk, programme) | `profiles` | P/patients |
| Observations and trends | BP ladder, health trends, vitals chart, AGP, lipids, CV risk; wearable badge | `vitals_readings`, `wearable_readings` | patient record vitals tab |
| Results | Upload with original kept, two AI extraction tables, S27 structured results with release state, CDE `clinical_documents` with trigger-derived status and SHA-256 duplicate refusal, outside-record verification | `lab_result_documents`, `lab_report_extractions`, `lab_results`, `clinical_documents` | P/results-inbox, P/lab-results, P/outside-records |
| Investigation requests | Bundle dropdown with indication and urgency, imaging orders, suggest-a-place by state and LGA, verifiable lab request form with QR | `lab_orders`, `diagnostic_requests`, `search_investigations`, `search_diagnostic_services` | patient record, P/orders |
| Care plans | Versioned plans, goals, interventions with owner and deadline, S24 signed changes, review prompts | `care_plans`, `care_plan_changes` | patient record, P/care-plan-review |
| Medications | List with versions, prescriptions (draft to dispensed), logs, reconciliation, reviews, side-effect notes, pharmacy flags | `medications`, `prescriptions`, `medication_logs` | P/medication-issues, P/medication-reviews, P/adherence, P/prescription-renewals |
| Appointments and video | Appointment lifecycle RPCs, attended and no-show, Zoom with waiting room, identity confirmation, S21 encounters with pre-call summary and recording pinned off | `appointments`, `video_consultations`, `encounters` | P/appointments, P/consultations, P/consultation, P/precall, P/video-visit |
| Referrals | Ten-state pipeline with audited reads and outcome documents | `specialist_referrals` | P/referrals |
| Notes | Draft and finalized, immutable once final, addendum, late entry and correction as linked rows, scribe with consent and omission check | `clinical_encounter_notes`, `scribe_*` | patient record, P/consultation |
| Family update | Doctor writes a 280-character note after a consultation; only the patient can release it | `family_doctor_notes` | P/consultation |
| Messaging | Patient threads with coordinator-first routing (MSG-1 to MSG-5); two-party curbside consults between doctors | `care_messages`, `curbside_consult_*` | P/messages, P/curbside-consults |
| Notifications | Shared bell with display tiers; critical engine and dead-letter path bypass patient preferences | `notifications` | shell |
| Audit | `audit_log` via `record_audit_event`, `staff_record_opens`, access review | | P/access-review |
| Governed rules | About 60 versioned config tables signed only by the CMO | `triage_rule_sets`, `bp_target_config`, `clinical_config_versions` | P/clinical-signoff hub |

## 3. Existing clinical workflow map

The spec's loop, mapped to what runs today. "Connected" means a database link or trigger carries the case forward without a person re-keying it.

| Step | Today | Connected to next step? |
|---|---|---|
| Registration and onboarding | Onboarding answers stored (S41) | **No clinician page reads them** |
| Health assessment | Annual check, risk questionnaire, preventive check reviews | Yes, to doctor review queues |
| Clinical review | Many specialist review pages | Partly; no single worklist |
| Care plan | Versioned plan, S24 signed changes | Yes |
| Investigation request | Lab and imaging orders with indication | Yes, to suggest-a-place and request PDF |
| Diagnostic provider | Directory with branches and eligibility | Advice only (by design) |
| Result upload | Patient, coordinator, partner or API | Yes, to extraction and review |
| Result review | Results inbox, lab results review, release policy | Yes, to release or disclosure |
| Follow-up | Tasks, care plan prompts, alert follow-up tasks | Four task tables, no single view |
| Longitudinal monitoring | Readings, triage rules, alerts, escalations | Yes, governed and paged |

Abnormal result to Priority 1: trigger, `abnormal-result-handler`, clinician alert, page ladder; proved in `events_reach_clinician_queue_end_to_end.sql` and `events_escalation_routing_and_page_ladder.sql`.

## 4. Component and design-system inventory

- `packages/ui/src/components` (31 files): badge, button, card, chart, confirm-dialog, input, select, textarea, sheet, disclosure, skeleton, stepper, list-item, page-header, dashboard-section, empty-state, load-error-card, load-failure, form-error, hero-metric, stat-tile, score-ring, searchable-list, plus `tokens.ts`, `theme.css`, `icons.ts`.
- No Radix dialog, popover or tabs, and no cmdk; tabs and the palette are hand-built.
- Tokens: brand green `#0e7c52`, clinical navy `#12324b`, charcoal ink, sprout gold, soft sage, warm ivory, deep forest. `tokens.test.ts` keeps TS and CSS in step.
- **Clinical priority colours are not tokens.** They are Tailwind red, amber, blue and grey through `Badge` variants, mapped in `lib/worklist/level-badge.ts`. The spec (23.1) asks for separate semantic tokens; this is a real, low-risk gap.
- Sidebar: fixed 256 px, sticky, groups collapse and remember their state; the sidebar itself cannot collapse to an icon rail.
- Staff consoles are light only (dark mode is patient-only by decision, `DARK-MODE.md`).

## 5. Data-model and API assessment

The database is the strongest part of the platform and needs little new schema for this programme. Most gaps are read models and UI.

| Spec ask | Data today | Verdict |
|---|---|---|
| Priority Critical, Urgent, Priority, Routine | `alert_level` (5) plus severity 0 to 4, task class 1 to 9 | **Display mapping only** in `packages/shared`; do not add a fourth vocabulary |
| Ten escalation statuses | Alerts 5, escalations 4 | Needs a decision (Q3); "awaiting info" and "monitoring" would be new states |
| Documented disposition on close | Enforced for alerts at severity 2 and above; escalations enforce identity only, note is UI-required | Small DB gap: require a resolution note on escalations |
| Handover with acknowledgement | Reassignment reason optional, only in `audit_log`; `care_team_handovers` has no acknowledgement | Needs schema (Phase 6) |
| Unified worklist | Five task stores plus two alert stores | **Read model** over existing tables (Phase 3); no new source of truth |
| Result status sequence | CDE `clinical_documents` already derives the spec's sequence; older stores overlap | Converge the UI on CDE; retire nothing yet |
| Per-medication adherence state | Logs plus `is_active`/`stopped_at` | Derive in `packages/shared`; no table |
| Care plan action status | Owner and deadline exist, no status | Small schema add (Phase 4) |
| Doctor approves the whole plan | Only S24 changes are signed | Needs a decision (Q5) |
| Saved views and preferences | None | New small table (Phase 3) |
| Clinician notification centre | Shared bell | UI over `notifications` (Phase 5) |
| Timeline from authoritative records | `patient_timeline` table plus `clinical_encounters` | Exists; extend coverage |
| FHIR R4 | Import and review shipped (2026-09-18) | Export stays gated (PHI guardrail) |
| Thresholds from signed config | Signed in the DB, but display badges use TS mirrors (`lib/rules/bp-classification.ts`, `lib/vitals/glucose-red-flags.ts`) | Known drift risk; Phase 6 reads signed config for display |

## 6. Gaps against the specification

Ranked by safety value, then by how much doctor time they save. "Approval" means a founder or CMO decision is needed before building.

| # | Gap | Spec | Size | Approval |
|---|---|---|---|---|
| G1 | Patient header shows no allergies, age, sex or active alerts | 11.1, 11.2, 28 | S | No |
| G2 | No environment indicator | 6 | XS | No |
| G3 | Web Zoom path leaves recording to the account default | 16.1 | XS | No |
| G4 | No critical-attention banner on the home page | 8.2 | S | No |
| G5 | Clinical priority colours are not semantic tokens | 23.1 | S | No |
| G6 | No global patient search for doctors | 6, 25 | M | **Yes (Q1)** |
| G7 | 140-link sidebar | 5 | M | **Yes (Q2)**, IA below |
| G8 | No unified worklist | 8.4, 9 | L | **Yes (Q1)** |
| G9 | Escalation status set is smaller than the spec's | 10.2 | M | **Yes (Q3)** |
| G10 | Handover has no acknowledgement or structured record | 10.4 | M | No (schema, Phase 6) |
| G11 | Escalation resolve note not enforced in the DB | 10.2 | S | No (DB, needs ultra review) |
| G12 | Order form uses a bundle dropdown, not catalogue search | 13.1 | S | No |
| G13 | Doctor cannot download the lab request or referral letter | 13.1 | S | No |
| G14 | No week or month calendar, no clinician reschedule | 16 | M | No |
| G15 | Two consultation stacks | 16 | L | **Yes (Q4)** |
| G16 | Care plan actions have no status; whole plan not signed | 14 | M | **Yes (Q5)** |
| G17 | Onboarding answers unseen by doctors | 3, scenario 1 | S | No |
| G18 | No clinician preferences or saved views | 8.6, 26 | M | No |
| G19 | Display thresholds are TS mirrors of signed config | 12.4, 29 | M | No (needs care) |
| G20 | No nurse role | 18 | n/a | **Yes (Q6)** |

## 7. Proposed information architecture

Principle: the sidebar holds daily clinical work; governance, operations and configuration move behind one "Governance" entry with its own index, which the command palette also reaches. Nothing is deleted: every existing route keeps its URL.

```
WORK
  Today                 /clinician                 (hero, critical banner, today strip, worklist)
  My worklist           /clinician/worklist        (unified read model, G8)
  Queue                 /clinician/queue           (pull-next, unchanged)
  Messages              /clinician/messages
PATIENTS
  Find a patient        /clinician/patients        (+ header search, G6)
  Appointments          /clinician/appointments    (day, week, list)
CLINICAL
  Escalations           /clinician/escalations
  Results               /clinician/results-inbox   (lab-results merged in as a tab)
  Orders and referrals  /clinician/orders, /referrals
  Medicines             /clinician/medication-issues (+ reviews, renewals, adherence as tabs)
  Care plans            /clinician/care-plan-review
  Reviews               /clinician/reviews         (index of the ~20 specialist review pages)
TEAM
  Team and handover     /clinician/team-caseload, on-call, curbside consults
GOVERNANCE (one entry, index page; CMO sees sign-off count)
  Sign-off hub, quality, safety, rules, AI, operations
ACCOUNT
  Profile, preferences, help, sign out
```

Home page order (keeps the 2026-10-30 programme's decisions, adds the spec's):
1. Greeting, date, Lagos time, "updated at" stamp.
2. **Critical banner** (only when there is something critical; never hideable).
3. Next-action hero.
4. Workload strip (the spec's six indicators; each opens a filtered worklist).
5. "Patients requiring your attention" table (G8, subject to Q1).
6. Secondary panels: today's appointments, recent results, outstanding follow-up.
7. Attestations stay above the work (an expired attestation blocks acting on an alert).
8. Governance and role cards last.

Patient record: a sticky header (name, Tarragon number, age and sex, date of birth, allergies with verified or patient-reported source, active alert count, consent indicator, care team), then tabs regrouped toward the spec's 14 with lazy-mounted panels. The S35 summary order (safety first) stays.

Wireframes and a clickable prototype are the next deliverable (Phase 1), built after Q1 and Q2 are answered, because both change the home page.

## 8. Implementation sequence

Each line is one PR, one worktree, none merged without required CI and `/code-review high` (`ultra` for anything touching RLS or the tier ladder). Production deployment happens on merge to `main-dev`, so the spec's "staging first, approval before production" means: PRs stay open until the founder has looked at the Vercel preview.

| Phase | PR | Depends on |
|---|---|---|
| 0 | This document | none |
| 2/3 | **Slice A (built tonight):** G1 safety header, G2 environment badge, G3 recording off, G4 critical banner | none |
| 2 | G5 priority tokens and one `PriorityBadge` used everywhere | none |
| 1 | Wireframes and clickable prototype of home, worklist, escalation, record, result review | Q1, Q2 |
| 3 | G7 sidebar regroup plus governance index | Q2 |
| 3 | G6 doctor patient search (header) | Q1 |
| 3 | G8 unified worklist read model in `packages/shared` plus page, G18 saved views | Q1 |
| 4 | Record header and lazy tabs, G17 onboarding answers on the overview | Slice A |
| 4 | G16 care plan action status | Q5 |
| 5 | G12 catalogue search in the order form, G13 clinician PDF downloads | none |
| 5 | G14 calendar views and reschedule | Q4 |
| 6 | G10 handover record with acknowledgement, G11 escalation resolve note in DB | ultra review |
| 6 | G19 display reads signed config | CMO sees the diff |
| 7 | Browser E2E for the seven required scenarios; clinician usability sessions | all above |

## 9. Slice A (built 2026-11-06, PR open, not merged)

See the PR description for the exact diff, tests and what was not checked in a browser.

## 10. Open questions for the founder

- **Q1. Names on the home worklist and a patient search.** S35 (2026-10-06) decided the queue shows counts by priority class only and the patient appears after a claim, and listed "browsable all-patients view" under not doing. The new spec asks for a named "Patients requiring your attention" table and a header patient search. `/clinician/patients` already lists patients by name, so the rule applies today to the pull-next queue only. Options: (a) keep pull-next for routine work and show named rows only for work already routed to this doctor (recommended: matches how escalations already work); (b) named rows for everything; (c) keep S35 as is.
- **Q2. Sidebar regroup.** Approve the IA in section 7 (governance behind one entry)?
- **Q3. Escalation states.** Add "awaiting information", "patient contact required" and "monitoring" as real states, or show them as derived labels over the existing five alert states plus tasks?
- **Q4. One consultation stack.** Converge on S21 `encounters` (recording pinned off, pre-call summary) and treat `video_consultations` as legacy?
- **Q5. Whole care plan signed by a doctor.** Today only individual changes are signed (S24). Is a signed whole-plan approval wanted?
- **Q6. Nurses.** The spec assumes nurse-led monitoring. The platform has no nurse role (merged into `clinician`, 2026-07-05) and 0 active care coordinators. Keep "clinician" as the generic role (CLAUDE.md leaves room for NMCN nurses under it), or plan a nurse tier?
