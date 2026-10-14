# S16-S20 hardening: the task layer

Branch `s16-s20/task-layer`. Covers plan section 6 Stage 0 (W0.1) and Stage 2 (W2.1 to W2.7), defects D1 to D10, and CMO decisions 1 to 3
(`docs/plans/S16-S20-review-and-build-plan.md`, section 5). English only (D-14). Nothing here signs, activates or approves a configuration.

## What changed, by defect

| Id | Change | Where | Proof |
|---|---|---|---|
| D3 | Cancelling (or completing, by any path) a task ends its live claim; `queue_next` ignores and clears a claim on a task that is not `claimed`; `expire_task_claims` ends such a claim quietly (no transition, no sev1). Recovery statement frees every clinician already stuck. | `20261014221545_s16_s20_d3_cancel_ends_live_claim.sql` | `s16_s20_d3_cancel_live_claim.sql` (fails on the old code at the second check: the clinician is handed the cancelled task) |
| D1 | Offer window = `least(type window, 0.5 x the task's own due time)`; under a minute is no window. A lapsed offer returns to open first; only then, if also past due, it is escalated. Escalated non-red tasks are claimable by any eligible clinician; red (class 1) keeps the `on_call` rule (INV-05). Running offers are shortened by a data step. | `20261014222123_s16_s20_task_layer.sql` sections 2, 3, 4 | `s16_s20_task_layer.sql` section 1; shared eligibility table (`eligibility-cases.json`) now has red and non-red escalated cases, run in Jest and in `s17_queue_next.sql` |
| D9 | A dedup merge that tightens `due_at` tightens a running offer window by the same share of the task's life. | same, section 2 | section 1 |
| D2 | Escalation tells the CMO from the database, in the same transaction (trigger on `clinical_task_transitions`): classes 1 and 2 by in-app + push + email at critical priority; 3 to 9 an in-app notice; a daily digest at 07:00 Lagos. No SMS, no WhatsApp. Fixed neutral wording (INV-07 lint passes). A failure to notify is logged and raises a sev1 incident and never undoes the escalation; no CMO to tell raises a sev1 incident. `queue_escalated_overview()` lists escalated tasks with age for the CMO. | same, section 7; `templates.ts`; `describe-in-app.ts` | section 2; `packages/notifications/src/s16-s20-templates.test.ts` |
| D4 | `queue_complete` needs a code the task type lists, system-checked where a record exists: critical result (released result, or 3 dated contact attempts by a listed method), titration (a change signed or rejected by the caller after the claim), symptom review (a finalized note by the caller), written question (a consult), red event (an acknowledged page). Other types: a coded disposition. Free text is a note only. | same, section 6 | section 3 |
| D10 | `queue_complete` refuses a lapsed claim (`queue_claim_expired`). | same | section 3 |
| D7 | `needs_information` and `technical_problem` hand-backs bar the same clinician from the same task; if nobody else could take it the task escalates (audited) instead of sitting open. The hand-back reason on the screen is no longer pre-selected. | same, section 4; `forms.tsx` | section 4; `actions.test.ts` |
| D8 | `queue_next(p_types)` keeps working for the S22b membership filter but is intersected with the caller's declared competencies and tier. | same, section 5 | section 4 |
| D5 | A dead-lettered, non-shadow `triage.graded` delivery for `queue.create_from_triage` raises a sev2 incident (a shadow grade loses no work, so none). | same, section 8 | section 5 |
| D6 | `queue_job_heartbeats`; the sweep and expiry cron commands write a heartbeat only after a finished run; `queue_watchdog()` every 5 minutes raises a sev1 incident for a stale job and a sev2 incident for a class whose oldest open task passed its warning threshold; `queue_health()` (now readable by the CMO as well as admins) carries `breaches` and `stale_jobs`. | same, section 9 | section 5 |
| W2.7 | `titration_signoff` producer: every engine-proposed medication change creates a task requiring `prescribing`; signing or rejecting the change closes it (completed for the holder, cancelled as "decided elsewhere" otherwise). A failure never blocks the proposal. | same, section 11 | section 6 |
| W2.6 | `/clinician/queue`: why the queue is closed (and until when for a cooling-off), offered tasks with window end, escalated work I can take, my reliability score, and for the CMO the escalated list with age. `/clinician/tasks/[id]`: coded completion form (contact attempts for a critical result), links for tasks that finish by themselves. | `apps/web` | `queue/page.test.tsx`, `actions.test.ts`, `tasks/[taskId]/page.test.tsx`, `queue-console.test.ts` |

## Configuration (PROPOSED, owner CMO)

New table `queue_task_layer_config` (v1, seeded active like S16/S17's first seeds) and registry key `queue.task_layer` v1 (status
`proposed`); a Jest test fails if the two drift. `queue_config` v1 and `queue_claim_config` v1 are untouched, so "new version, never edit v1"
holds. The CMO signs a v2 of the pack in the console (decision 16, Stage 6): that is a new row plus a registry entry, not an edit. Nothing in
this branch signs or confirms anything.

## Decisions I made that the lead may want to overrule

1. **No bus subscriber for `clinical_task.escalated`.** The plan says "subscriber". I used a transaction-time trigger instead: the review
   found the page path failing through two asynchronous hops and a deploy-order dependency (a subscriber row whose handler is not yet
   deployed dead-letters). The event is still emitted, so a subscriber can be added later without changing this.
2. **Digest** goes by in-app and email, once a day at 06:00 UTC (07:00 Lagos). Changing the hour means a new cron schedule, not config.
3. **`queue-next` and `queue-handback` edge functions were KEPT and now tested** (`packages/queue/src/edge-forwarders.test.ts`). Both are
   deployed live (version 13, `verify_jwt` true). Deleting the source would leave a deployed function with no owner and trip the edge-drift
   job; nothing in the repo calls them, so if the lead wants them gone, undeploy first, then delete the folders and this test.
4. **`queue_health()` is now readable by the CMO** (`task_staff_reader`), not only admins, because decision 2 makes the CMO the recipient.
5. **Contact attempts**: at least 3, each dated after the task was created, by phone call, video call, in-app message or emergency contact.
   PROPOSED numbers, the CMO should confirm. The NPSG.02.03.01 reading is "organisation sets the timeframe and measures it".

## Review findings applied (`/code-review high`, run before the PR)

Fixed: a test task escalating with no test CMO no longer raises a real sev1; an `async_question` outcome must name the consult made for
that task; `system_checked` is true only where a record was actually read; finalizing a clinician's note now completes the symptom review
they hold (the screen already said so); the D5 incident no longer duplicates S10's for urgent events; contact attempts must be distinct,
ISO-dated and in the past; `queue_candidates` reads its settings once per call instead of once per row; `queue_escalated_overview` is
limited to the caller's own organisation.
Kept, with reasons: the `queue_next` competency intersection (D8) is redundant with `queue_candidates` by design, as the plan asked for
literal binding; `queue_health` still counts all organisations (unchanged from S16, and the ops wall reads it as a platform-wide figure).
Known limit: contact attempts are the clinician's own record (a typed list), checked for shape, dates, methods and distinctness, not
against the call or message logs; `in_app_message` attempts could be verified against `care_messages` later.

## Skipped, with reason

- **`symptom_review` producer.** `docs/design/S55-S60-build-plan.md` plans a `symptom_reviews` table with its own SLA row for the symptom
  engine; the existing symptom triage already raises a `clinician_alerts` review alert, so a task now would put the same review in two
  queues (the P5 parallel-paging problem). Needs a founder/CMO decision on which queue wins. The completion check for it (a finalized note
  by the caller) is ready, and the screen points to Consultations.
- **`p_extra_competencies` for other prescription tasks.** `pharmacy_flag_review` is created by two functions in other sessions' files
  (`20261006220538`, `20261007141623`); `admin_clinical` has no producer. Only the titration producer passes `prescribing`. Whether a
  pharmacy-flag task should also require `prescribing` is a clinical call (it changes who may take it), so it is not decided here.
- **A "nobody online" escalation trigger** (plan section 2, S16 escalation row) is not part of W2.1 to W2.7.

## Things found on the way

- `create_clinical_task` offers a task to the patient's lead without checking the lead holds the task's required competencies (the lead then
  cannot claim it and the offer simply lapses, now after at most half the due time). Fixing it changes who is offered what; left for a decision.
- SR2d rewrote `sweep_clinical_tasks` in place after S16; the restated body keeps SR2d's sargable condition (a first draft of this branch
  restated the S16 text and `sr2d_overdue_sweep_sargable_and_hot_indexes.sql` caught it). Every other restated function was checked by md5
  of its source against the live project before and by the same script (`bodymd5`) against the migration text.
- D10 makes a lapsed claim un-completable. The written-question answer flow calls `queue_complete` as its last step, so a clinician whose
  30-minute hold ran out loses the submit (the form keeps their text). The screen already shows time left and one extension; if this bites,
  lengthen the type's `claim_timeout_minutes` in a new `task_types` version rather than weakening the check.

## Open questions (for `docs/OPEN-QUESTIONS.md`, which this branch does not edit)

1. Which queue wins for a symptom review needing a doctor: the new `symptom_review` task or the existing review alert?
2. Should `pharmacy_flag_review` and `admin_clinical` require `prescribing`?
3. Is 50% the right offer-window fraction, and are the class warning thresholds (60 to 2160 minutes) and the 5 minute job allowance right?
4. Should a lead who lacks a task's required competency be skipped at offer time (see "found on the way")?
5. An external dead-man check on `queue_job_heartbeats` (the watchdog itself runs under pg_cron, so a dead pg_cron kills it too): wire it
   into the SR5 ops wall alert rules.
6. Email delivery for the CMO's alert depends on W1.1 (page and notice email address resolution). This branch writes `to_email` into the
   payload itself, from the CMO's own sign-in address, so it does not wait for that fix.

## What was not run

- Edge functions were not deployed. `send-pending-notifications` (new templates `task_escalation_alert` and `queue_backlog_digest`) must be
  redeployed after merge for the email and push text; the in-app text needs only the web deploy. Until then an email row fails with "template
  has no email rendering" and is retried or marked failed, never dropped silently, and the in-app notice and the incident paths still work.
- `database.types.ts` was not regenerated (production types would import other branches' schema); the web code reads the new RPCs through the
  existing untyped `loose` client.
