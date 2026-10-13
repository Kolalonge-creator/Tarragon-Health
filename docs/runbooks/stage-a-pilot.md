# Stage A pilot runbook (500 Members, one region, two weeks)

*Operational runbook for SR6 of `docs/plans/SCALE-READINESS-PLAN.md`. Status: DRAFT, 2026-10-12. **The pilot has not run. Nothing in this file records a result.** Every threshold below is PROPOSED until the CMO and founder sign it (plan section 6, decisions 1 and 2). The report template at the end is empty on purpose.*

Why a pilot at all: the platform has 12 real accounts, so none of its limits have been seen under real use. The local load results in `docs/design/load-results/` were produced on a laptop against synthetic data and say nothing about production capacity. Stage A is the first time real people, real phones, real networks, real lab and real Zoom meet the system. It is deliberately small enough that every problem can be handled by hand.

## 1. Roles

| Role | Who | Does |
|---|---|---|
| Pilot owner | Founder | Decides go, stop and resume. Reads the daily review. Signs the report. |
| Clinical lead | CMO | Owns the clinical stop rule (section 4) and the sign-off on the safety targets. |
| Operations on call | Named person plus a named backup (plan decision 3) | Watches the operations wall (`/admin/ops/wall`), receives alerts from the contact list, writes the daily review. |
| Engineer on call | Founder or a named contractor | Fixes platform faults, runs the rollback switches in section 5. |

Nobody is "assumed" to be watching. If a role has no name against it on the entry checklist, the pilot does not start.

## 2. Entry checklist (every box ticked by a named person with a date; any unticked box means no start)

Foundations (plan phases 0 to 3):
- [ ] SR1 facts recorded: Supabase plan, compute size, connection limit, backup type and retention. Point-in-time recovery is ON and a restore has been rehearsed once. (Launch blocker, release-blockers checklist.)
- [ ] Sentry is switched on for web, edge functions and the mobile app, and uptime checks cover the web app, `process-events`, the Paystack webhook and the Zoom webhook. Alerts reach a phone.
- [ ] Upstash is configured, so rate limits hold across web instances.
- [ ] SR2 applied: job-history clean-up running, server code on the pooler, advisor findings on the hot tables fixed.
- [ ] SR3 applied: growth and retention plan for the unbounded tables agreed with the DPO.
- [ ] SR5 applied: the alert rules migration is live, the on-call contact list has at least two people, each has received a test alert on push and on email, and the operations wall loads with real numbers.
- [ ] The alert rules for edge functions and cost are either fed by a real signal or are marked off with a written reason (a rule with no feed is off, never "green").

Load evidence:
- [ ] Stage A load results exist in `docs/design/load-results/` and both safety assertions passed (no task claimed twice; no Member red event unpaged). Read the caveats at the top of that file: laptop numbers, synthetic data, database layer only.
- [ ] The first-load numbers have been compared with the service targets in plan section 2 and the gaps are written down.

Clinical and operational readiness:
- [ ] The CMO has signed the service targets (60 second page, 5 second save, 2 second next task, 3 second chart summary) and the stop rule below. Signatures are recorded by the CMO in the normal sign-off hub, not by an agent.
- [ ] A 24 hour on-call rota exists for the whole pilot with a primary and a backup for every hour, no gaps (the `rota_gap_12h` alert is quiet).
- [ ] The doctors who will take pilot work are credentialed and have done a test claim, a test hand-back and a test page acknowledgement on a real phone.
- [ ] The lab partner is live for the panel with a tested result flow, and a held result has been reviewed end to end once.
- [ ] Zoom plan limits are known and cover the busiest hour of the pilot. The audio and phone fallback has been tried once on a real handset.
- [ ] The pilot allow-list of 500 people exists (who they are, which region, which employer or channel).
- [ ] The incident runbooks (`docs/runbooks/`) have been read by the pilot owner and the operations on call.
- [ ] Rollback (section 5) has been rehearsed: each switch used once on a non-production copy, and the gaps listed in section 5 are either closed or accepted in writing.

## 3. Daily review (ten minutes, same time every working day, written down)

Open `/admin/ops/wall`, then the incident register. Copy this block into the pilot log and fill it in. A blank field is a finding.

```
Date:            Reviewer:
Pilot day (1-14): Members active today:        New sign-ups today:
-- Safety (any "yes" here is a stop-rule check, section 4)
Pages sent in the last 24h:      Acknowledged on time (5 min):      Unacknowledged past step 1:
Red events for Members that did not page anyone:          (must be 0)
Tasks claimed twice / lost / duplicated:                   (must be 0)
Lab results held unreviewed past target:
-- Service
Oldest open task by class (min):  C1 __ C2 __ C3 __ C4+ __
Doctors online now / calls in progress:
Notification failures (last 24h, percent) push __ email __ in-app __
Payments in the last 24h: taken __ unprocessed webhooks __ amount mismatches __
Zoom: joins __ fallbacks to audio/phone __ failed joins __
Database: connections peak __ of limit __ ; disk __ ; slowest query __
-- Alerts and incidents
Alerts raised / cleared today:          Open incidents (sev1/sev2):
Decisions taken today (and by whom):
Anything a Member or doctor complained about:
Go / hold / stop for tomorrow:
```

On day 7 and day 14 add: p50 and p95 for the five patient and doctor actions in the plan targets, measured from the wall and the logs, and a count of Members who stopped logging.

## 4. Stop rule (proposed; the CMO and founder to confirm)

**Stop immediately** (pause new sign-ups, section 5, and call the pilot owner and the CMO) if any one of these happens:
1. A red event for a Member did not reach an on-call doctor, or a page sat unacknowledged past the end of its ladder (10 minutes) with nobody alerted.
2. A task was handed to two doctors, a task was lost, or a payment confirmation, lab result or notification was lost.
3. A result was released to a patient that should have been held, or any record was shown to someone without access.
4. The rota had no cover for any hour in which a Member could have had a red event.
5. Two or more sev1 incidents in one week, or one sev1 not acknowledged inside its 15 minute target.

**Hold** (no new Members that day; fix, then review the next morning) if any of these happens:
- The page-to-phone time exceeds 60 seconds more than once in a day.
- A reading save exceeds 5 seconds for more than 5 percent of saves over an hour.
- Notification failures exceed 2 percent over 15 minutes, or a channel delivers nothing.
- Unprocessed payment or Zoom webhooks older than 5 minutes.
- Zoom join failures above 3 percent or fallback to phone above 10 percent in an hour.
- Database connections above 70 percent of the limit, or disk above 70 percent.

**Resume** only when the pilot owner and the CMO both write "resume" in the log with the cause and the fix. The pilot does not move to Stage B on a good average; it moves only if every target held and there were no unacknowledged pages or lost items (plan phase 5).

## 5. Rollback (what exists today, and what does not)

Plan phase 5 asks for three rollbacks. This section states which switch actually exists in the code at the time of writing. A rehearsed rollback needs a real switch; where there is none, the gap is an entry-checklist item, not a footnote.

| Rollback | Switch today | Status |
|---|---|---|
| Route new people to Free (no new Members) | `v5_checkout` feature flag in `/admin/settings/feature-flags`. Off means the membership checkout does not take payment; people who sign up stay on Free. | Exists. Rehearse it. Existing Members keep their membership. |
| Pause sign-ups | The go-live guard `public_signup_enabled` exists as a record, **but it is not wired to the sign-up flow** (S37 design note, OQ-184). Switching it does nothing today. | **GAP. Before the pilot, engineering must either enforce it in sign-up or the pilot must rely on a closed allow-list.** Do not tell the team a sign-up pause exists until it has been tested. |
| Stop testing-day booking | No testing-day booking feature or guard was found in the code. The lab-booking guard `lab_booking_enabled` is also not wired. Lab ordering is blocked only by deactivating the lab partner (`lab_providers.is_active`). | **GAP / not built.** If testing days are in the pilot, decide how they are stopped before the entry checklist is signed. |
| Stop doctor consultations | Go-live guard `clinical_operations_enabled` is enforced for slot holds, booking, the consultation room and video visit requests. | Exists. Switching it off blocks booking and rooms; it does not stop pages or the queue. |
| Stop red-event paging | Do not. Paging is a safety control. If it is faulty, use the incident runbooks and phone the on-call doctor directly. | Intentionally no switch. |

Order of use when something is wrong: hold (section 4), then pause new sign-ups, then route new people to Free, then stop consultations booking. Write each switch use in the pilot log with the time and the person.

After a rollback the pilot owner decides, in writing, whether existing Members are affected and who tells them (in-app notice only; no clinical detail in any message).

## 6. End of pilot report (template; fill after day 14, do not pre-fill)

```
Pilot report - Stage A
Dates:                     Members enrolled:          Region:
Prepared by:               Reviewed by (CMO):         Decision (move to B / repeat A / stop):

1. What we set out to prove (the plan section 2 targets, copied in)
2. What the numbers were (from the wall and the daily logs, with the method; not estimates)
   Page-to-phone p50/p95:        Reading save p50/p95:       Next task p50/p95:
   Chart summary p50/p95:        Notification failure rate:  Payment webhook delays:
   Zoom join failure / fallback: Lab turnaround for the panel: Peak connections / disk:
3. Safety record
   Pages sent / acknowledged on time / unacknowledged:
   Red events for Members that went unpaged:      Tasks double-claimed or lost:
   Results held and released correctly:           Sev1/sev2 incidents (with references):
4. Stop-rule and hold events (date, cause, fix, who resumed)
5. Rollback switches used (which, when, effect), and any switch that did not work
6. What Members and doctors said (counts and themes, no names)
7. Cost per Member observed (hosting, lab, Zoom, AI, SMS) against the 34,000 naira assumption
8. Gaps between the local load results and what happened in the pilot
9. Changes needed before Stage B (feeds docs/design/SR7-architecture-changes.md)
10. Open items for the founder
```
