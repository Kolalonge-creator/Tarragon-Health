# Messaging 2: clinically governed, tiered care coordination

Founder brief, 2026-11-04: messaging becomes a care-coordination service, not an open doctor chat. Free members get support and the
safety path; Members (100,000 naira a year) get clinical messaging, a monthly doctor meeting, result and vitals oversight and follow-up.
Decisions MSG-1 to MSG-4 are in `docs/DECISIONS.md`. This file records what already existed, what each step adds, and what is still open.
It is a build order, kept short; the running code is the source of truth.

## What the audit found (2026-11-04, origin/main-dev and the live database)

Live: 3 active doctors (CMO + 2 Senior Medical Officers), **0 Care Coordinators**, 2 active memberships (both test), 1 thread ever.

| Brief asks for | Already there | Gap |
|---|---|---|
| Free members cannot message doctors, enforced in the API | Nothing in the database; only the dashboard card was gated (`doctor_checkin`) | **Closed by MSG-1** |
| Safety for every plan | Danger-phrase screen on every patient/sponsor message (`private.screen_care_message_for_emergency`), Free red-event path, one result engine (T2-07) | none |
| Support queue (A) | `navigation_requests` ("I need help") with a coordinator worklist | messages are not routed anywhere by topic |
| Clinical queue (B), coordinator first | one inbox shared by doctors and coordinators; a thread owner already exists (`care_thread_owners`: owner, assigned_by, handover note) | no queue or lifecycle (MSG-3); owner assignment is manual |
| Safety queue (C) | `clinician_alerts`: safety flags, unread-clinical sweep (240 min ack), abnormal results | a dashboard tile only |
| Monthly meeting | `member_followup_entitlements` (12 a year, no stockpile), doctor-offered slots, coordinator booking, 5,000 naira extra meeting | none |
| Pre-meeting summary | S89 deterministic pre-visit brief with source links, sensitive rows fail closed | an AI-written version would be a new governed AI system |
| AI draft reply | manual "Draft reply" only | context widening, summaries and classification need `ai_systems` registration + CMO approval |
| Reply target | `care_messages.reply_target` 24 h, calendar hours, opening a thread does not clear it | staffed hours vs calendar hours undecided |
| Sponsor permissions, confidential threads, bereavement stop | 8 access categories incl. `messaging`, confidential threads, W-21 stop, access log | none |
| No clinical detail in notifications | push/email/SMS templates say only that a message is waiting | none |

## Build order

1. **MSG-1 (this PR).** Database refuses a Free member's clinical or medication thread through the RPC, a direct insert or a category
   change; the danger-phrase exception keeps the safety path open; the composer explains Membership. Laboratory stays open (directory
   and upload help) and is routed by MSG-3.
2. **MSG-3 routing and lifecycle.** On `care_message_threads`: `queue` (support / clinical) and `state` (received, assigned,
   doctor_review_needed, responded, closed) with timestamps for each step, all set server-side. The assignee is the existing
   `care_thread_owners` row, filled automatically instead of by hand; no second assignee column. A Free member's thread is always support,
   including a clinical thread a doctor opened to them or one opened while they were a Member (MSG-1 checks Membership only when a
   thread is opened, so later messages in such a thread must route by the patient's current Membership).
   Assignment: support to the least-loaded active coordinator, else a doctor; clinical to a coordinator for triage, else straight to the
   least-loaded doctor (MSG-2 fallback), reusing the availability rules of `private.auto_assign_escalation()`. A coordinator can mark
   "doctor review needed", never close a thread that is marked so. Reply target counts from received to responded, not to opened.
   Existing threads are backfilled from their category and the patient's Membership at the time of the migration.
3. **Operations dashboard.** Tiles from the lifecycle above plus existing sources: new support messages, awaiting coordinator, awaiting
   doctor, open critical alerts, past reply target, results awaiting review, monthly meetings due/done, unread clinical; workload by
   person; filters by Membership, queue, category, age, assignee.
4. **AI assistance (governed).** Message classification suggestions and a short thread summary for doctors, each registered in
   `ai_systems`, routed through `runGovernedAi()`, suggestion only (never routes a safety signal, sends advice or closes anything).

## Still open

- Reply target in staffed hours or calendar hours, and the published operating hours (founder).
- The `doctor_checkin` UpgradePrompt copy still describes the retired 12-week programme; Phase 4 (#1686) owns Membership copy.
- Mobile has no category picker today, so its threads are always general; it gains the clinical topics with MSG-3.
