# SR3: growth, index plan, partitioning and retention for the tables that grow without limit

Date: 2026-10-12. Status: DESIGN. Plan reference: `docs/plans/SCALE-READINESS-PLAN.md` Phase 1 item 4. Nothing here was applied to the live project except what section 6 lists as implemented (nothing is live yet; it is written as migrations on the branch `scale/sr1-sr3`).

## 0. Read this first

1. Every retention rule below is marked **needs DPO agreement**. `public.data_retention_policies` (live, 2026-10-12) carries the platform's current position: clinical records, audit and correction trails, financial records, consent records and communications have `retention_period_months = null` ("nothing here is deleted absent explicit future policy"), and only marketing and analytics (`leads`, `web_events`) has a value, 36 months, and that row has never been reviewed (`reviewed_at` is null). This document does not change that table and does not delete any of those categories. It designs what the rules could be so the DPO and CMO have something concrete to decide on.
2. **Audit rows are never deleted.** `audit_log` is only ever partitioned, indexed and (after DPO agreement) moved to cheaper storage with its rows intact and still queryable.
3. The row estimates are **assumption-driven, not measured**. The live database has 12 profiles, so there is no per-Member rate to measure. The assumptions are stated in section 2; replace them with the Stage A (500 Members) measurements and re-run the arithmetic. They are the right order of magnitude for deciding what needs partitioning and when, not a forecast.
4. No populated table is rewritten, partitioned or purged by this work. Anything that needs that is "designed, not applied" with a count-first header and a rollback written out below.

## 1. Inventory: what exists today (live, read-only, 2026-10-12)

| Table | Rows now | Size now | Time column | Incoming foreign keys | Partition-friendly? |
|---|---|---|---|---|---|
| `vitals_readings` | 12 | 424 kB | `taken_at` | 3 (`triage_pending_rechecks`, `clinician_alerts`, `emergency_events`) | After the 3 foreign keys are replaced |
| `notifications` | 1,827 | 1.2 MB | `created_at` | 6 (self `escalated_from_id`, `alert_deliveries`, `notification_delivery_events` and others) | After foreign keys are replaced; hardest |
| `audit_log` | 5,432 | 4.2 MB | `created_at` | 0 | Yes |
| `web_events` | 9,297 | 4.0 MB | `occurred_at` | 0 | Yes |
| `domain_events` | 16 | 920 kB | `occurred_at` | 2 (self, `domain_event_deliveries`) | After foreign keys are replaced |
| `domain_event_deliveries` | 0 | 480 kB | `created_at` | 1 (`event_effects`) | After foreign keys are replaced |
| `integration_outbound_events` | 0 | 120 kB | `created_at` | 1 (`integration_delivery_attempts`) | After foreign keys are replaced |
| `clinical_task_transitions` | 0 | 208 kB | `created_at` | 0 | Yes |
| `encounter_events` | 0 | 64 kB | `created_at` | 0 | Yes |
| `wearable_readings` | 0 | 40 kB | `recorded_at` | 0 | Yes |
| `net._http_response` (pg_net) | 1,973 | 2.9 MB | `created` | n/a | Self-cleaning (below) |
| `cron.job_run_details` | 377,797 | 182 MB | `start_time` | n/a | Cleaned daily (below) |

Note on `audit_log` content, live: 5,432 rows from 12 accounts in 75 days, and the largest single groups are system sweeps, not people: `profiles.updated` 1,631, `wearable_connections.updated` 1,127, `clinician_alert.ack_timeout_escalated` 543, `clinician_alert.sla_breach_escalated` 436. At Member volume the sweeps would dominate the table. Before Stage B, someone should confirm each of those sweep rows is meant to be a permanent audit fact and not an operational heartbeat (this is a question for the DPO and CMO, not an engineering deletion).

## 2. Growth model: rows a year at Stage B (5,000 Members), C (25,000), D (100,000)

Assumptions (replace after Stage A): Free users are 4 per Member (plan section 2), so total accounts are 25,000 / 125,000 / 500,000. Per Member per year, per Free user per year, and bytes a row including its indexes:

| Table | Per Member | Per Free user | Bytes a row incl. indexes | Basis |
|---|---|---|---|---|
| `vitals_readings` | 250 | 24 | 600 | roughly a reading most days for a monitored Member; occasional for Free |
| `wearable_readings` | 438 (20 percent connect a device, 6 passive metrics a day) | 0 | 500 | passive steps, sleep, HRV; 20 percent connection rate is a guess |
| `notifications` | 120 | 40 | 1,200 | reminders, results, follow-up nudges; `payload` jsonb is the bulk |
| `audit_log` | 200 | 20 | 1,500 | live row is about 790 bytes with indexes; allowance for record-access audit reads |
| `web_events` | 800 | 200 | 450 | live is 440 bytes a row |
| `domain_events` | 150 | 0 | 1,000 | one per reading, task, page, payment |
| `domain_event_deliveries` | 450 | 0 | 500 | about 3 subscribers per event (7 exist today) |
| `clinical_tasks` | 20 | 0 | 1,500 | follow-up calls (12) plus results and reviews |
| `clinical_task_transitions` | 100 | 0 | 500 | about 5 state changes a task |
| `encounter_events` | 60 | 0 | 500 | about 4 events for each of about 15 encounters |

Rows and size added per year (indexes included; this is yearly increment, not a cumulative total):

| Table | Stage B (5k) | Stage C (25k) | Stage D (100k) |
|---|---|---|---|
| `web_events` | 8.0 M rows, 3.6 GB | 40 M, 18 GB | 160 M, 72 GB |
| `audit_log` | 1.4 M, 2.1 GB | 7.0 M, 10.5 GB | 28 M, 42 GB |
| `notifications` | 1.4 M, 1.7 GB | 7.0 M, 8.4 GB | 28 M, 34 GB |
| `wearable_readings` | 2.2 M, 1.1 GB | 11 M, 5.5 GB | 44 M, 22 GB |
| `vitals_readings` | 1.7 M, 1.0 GB | 8.7 M, 5.2 GB | 35 M, 21 GB |
| `domain_event_deliveries` | 2.3 M, 1.1 GB | 11 M, 5.6 GB | 45 M, 22 GB |
| `domain_events` | 0.75 M, 0.8 GB | 3.8 M, 3.8 GB | 15 M, 15 GB |
| `clinical_task_transitions` | 0.5 M, 0.2 GB | 2.5 M, 1.2 GB | 10 M, 5.0 GB |
| `encounter_events` | 0.3 M, 0.1 GB | 1.5 M, 0.8 GB | 6 M, 3.0 GB |
| `clinical_tasks` (not unbounded, for scale) | 0.1 M, 0.1 GB | 0.5 M, 0.8 GB | 2 M, 3.0 GB |
| **Total of the above, a year** | about 20 M rows, 12 GB | about 100 M, 60 GB | about 400 M, 250 GB |
| `cron.job_run_details` | independent of Members: about 1.5 M rows a year unbounded; bounded to about 30,000 rows by SR2a | | |

What the table says in plain terms: at Stage B the database stays small enough (tens of GB) that partitioning is optional; at Stage C the append-only tables pass tens of millions of rows and the biggest ones need monthly partitions and a decision about old data; at Stage D, `web_events`, `audit_log`, `notifications`, `wearable_readings` and `vitals_readings` are each tens of millions of rows a year and partitioning plus a retention rule is no longer optional. The compute tier and disk must be sized for the cumulative figure of the retained years, not one year.

## 3. Index plan

Principle: every unbounded table keeps exactly the indexes its real queries need and no more, because each index doubles as a write cost on the hottest tables. Query shapes below come from the code and functions, not guesses.

| Table | Indexes to keep (exist today unless marked NEW) | Notes |
|---|---|---|
| `vitals_readings` | `(patient_id, taken_at desc)` timeline and chart; `(organisation_id, taken_at desc) where validation_status = 'requires_validation'`; the four partial unique dedupe indexes (`client_reading_id`, `wearable`, `cgm`, `device`); `logged_by_profile_id` | `vitals_readings_org_idx (organisation_id)` is low value with one organisation and is a candidate to drop at Stage B, after statistics exist. NEW in SR2c: `triage_event_id`, `validated_by` partial foreign-key indexes |
| `notifications` | `(recipient_id, created_at desc)` inbox; `(priority, status, sent_at) where critical and unopened`; `(recipient_id, created_at desc) where awaiting response`; NEW in SR2d `(created_at) where status = 'pending'` for the send job | `(organisation_id, status)` is non-selective with one organisation |
| `audit_log` | `(subject_patient_id, created_at desc) where subject_patient_id is not null`; `(organisation_id, created_at desc)`; `(entity_type, entity_id)`; `(actor_id)`; one partial inbox index | Index on `created_at` leading is what partition pruning needs; `(organisation_id, created_at)` already serves it. Do not add more; audit writes are on every mutation path |
| `web_events` | `(occurred_at desc)`, `(profile_id, occurred_at desc)`, `(country)` (all exist) | `(country)` alone is the weakest and is a drop candidate once statistics exist. No incoming foreign key, so it is the cheapest to partition; `(occurred_at desc)` is what pruning and retention need |
| `domain_events` / `domain_event_deliveries` | events: `(event_type, occurred_at desc)`, `(patient_id, occurred_at desc)`, unique `(event_type, idempotency_key)`; deliveries: `(next_attempt_at) where status = 'pending'`, `(locked_until) where status = 'processing'`, unique `(event_id, subscriber_key)` | The claim must stay an index scan on pending rows only; verify with the `scripts/sr2-query-plans.sql` pattern at 1M. Partitioning `domain_events` would force `occurred_at` into the unique `(event_type, idempotency_key)` index, which weakens the idempotency guarantee the bus relies on: another reason it is last, and it may be better to leave `domain_events` unpartitioned and trim by archive |
| `clinical_task_transitions` | `(task_id, created_at)` | NEW in SR2c: `actor_id` partial |
| `encounter_events` | `(encounter_id, created_at)` (exists) | |
| `wearable_readings` | `(connection_id, recorded_at desc)`, unique `(connection_id, external_reading_id)`, `(organisation_id)` (all exist) | `(organisation_id)` is non-selective with one organisation; consider BRIN on `recorded_at` for cold partitions. Partitioning needs `recorded_at` in the unique dedupe index, which is acceptable because the dedupe is per connection and reading id |

BRIN note: on an append-only table whose physical order follows time, a BRIN index on the time column is tiny (kilobytes) and effective for range scans over old partitions. Use it on closed monthly partitions of `web_events`, `wearable_readings` and `audit_log` only if a time-range query without a patient filter exists; the patient-keyed btree indexes above remain.

## 4. Partition-by-month design (NOT applied)

Which tables, in order of value and ease:

1. `web_events` and `wearable_readings`: no incoming foreign keys, pure append, biggest at Stage C. First.
2. `audit_log`, `clinical_task_transitions`, `encounter_events`: no incoming foreign keys. Second.
3. `vitals_readings`, `notifications`, `domain_events`, `domain_event_deliveries`, `integration_outbound_events`: have incoming foreign keys, so each needs those relationships replaced (a foreign key cannot target a partitioned table's non-partition-key columns). Last, and only if Stage C measurements show the need.

Shape (declarative range partitioning on the time column, monthly):

```sql
-- design only. For a table that already holds rows this is a migration with a count-first header and the steps below.
create table public.web_events_p (
  like public.web_events including defaults including constraints
) partition by range (occurred_at);
-- primary key must include the partition key: (id, occurred_at)
-- monthly children, created ahead by a scheduled function:
--   create table public.web_events_2026_11 partition of public.web_events_p
--     for values from ('2026-11-01') to ('2026-12-01');
```

A helper to keep partitions ahead (also design only; it would be created in the same migration that first partitions a table, so no unused scaffolding is added to the live schema now):

```sql
create function private.ensure_monthly_partitions(p_parent regclass, p_months_ahead int default 3) returns int
language plpgsql security definer set search_path = '' as $$
-- for each of the next p_months_ahead months, create the child partition if missing; return how many were created.
-- scheduled daily with pg_cron; an error opens an ops_incidents row exactly as private.cron_history_cleanup does.
$$;
```

Online-safe migration recipe for a populated table (do it table by table, in a quiet window, after a PITR restore test, and only if the count justifies it):

1. **Count first.** Write the row count and size into the migration header. If under about 20 million rows, do not partition; index maintenance is cheaper.
2. Create the partitioned shadow table and the children covering the existing data range plus three months ahead.
3. Copy in batches by month (`insert ... select ... where occurred_at >= ... and < ...`, 50,000 rows per batch, outside business hours), recording progress in a small progress table so it can be resumed.
4. Keep the old table writable and add a trigger that mirrors new inserts into the shadow table until cut-over; verify counts per month match.
5. Cut over inside one short transaction: take an `access exclusive` lock, copy the final delta, `alter table ... rename` old to `_old` and shadow to the real name, recreate grants and row-level-security policies and triggers on the new parent (policies and grants do NOT carry across `create table ... like`), re-run `alter default privileges` assumptions, and run the table's existing proof script.
6. Keep `_old` for one release cycle, then drop it only on the founder's instruction.
7. **Written rollback:** before step 5, rollback is dropping the shadow table and the mirror trigger. After step 5 and before step 6 completes, rollback is the reverse rename inside one transaction, after copying back any rows written to the new table since cut-over. After `_old` is dropped there is no rollback except a point-in-time restore; do not drop it until the new table has been through a full month end.

Row-level security, grants and `anon` revokes: a new partitioned parent is a new table, so the "freshly created table needs its own grant" and "anon default privilege" lessons in CLAUDE.md apply; each child inherits the parent's policies but needs no separate grant (grants are on the parent for queries through it). The proof for each table must include a simulated-session check that a stranger sees nothing.

Pruning requirement: every hot query must carry the time column in its predicate or it scans all partitions. `vitals_readings` by `patient_id` alone would touch every partition; the timeline query must be changed to bound `taken_at` (for example the last 12 months by default) before partitioning that table. This is the main reason `vitals_readings` and `notifications` are last.

## 5. Retention and archive rules (all NEED DPO AGREEMENT before anything is deleted or moved)

| Table | Proposed rule | Why | Needs |
|---|---|---|---|
| `audit_log` | **Kept for the life of the record it audits. Never deleted.** After 24 months, closed monthly partitions may be detached and moved to cheaper storage (a read-only archive schema or object storage as Parquet), still queryable on request | `data_retention_policies` ties the audit trail to the clinical and financial records it documents | DPO agreement on archive location (data residency) and access path; CMO on whether sweep-generated rows (section 1 note) belong in the audit trail |
| `vitals_readings` | Kept for the life of the patient record (clinical record, null policy today). Summarise only for display (daily and monthly rollups for charts); never delete the raw reading | Clinical record | DPO and CMO to confirm; a rollup table is additive and safe |
| `wearable_readings` | Raw passive metrics kept 24 months, then rolled up to daily summaries (steps, sleep duration, HRV mean) and the raw rows archived or deleted. Patient delete-my-data (`delete_wearable_connection_data`) already erases a connection's data on request | Passive consumer data, not a clinical record by itself; the clinical-grade overlap (heart rate, weight, SpO2) goes to `vitals_readings` and is not affected | DPO agreement |
| `notifications` | Operational delivery records kept 13 months, then detached and archived; notifications that form part of the clinical trail (a critical result notice, an escalation) are exempt and kept with the record. Delivery events (`notification_delivery_events`) follow their notification | `data_retention_policies` communications row is null: "treated as part of the clinical record trail where a message concerns clinical care" | DPO and CMO to define the exempt class |
| `web_events` | 36 months, as already written in `data_retention_policies` (marketing and analytics row, never reviewed) | Product decision, no clinical or statutory basis | DPO to review that row; then a monthly job drops whole partitions older than the line |
| `domain_events` / `domain_event_deliveries` | Keep events for 24 months (replay and incident reconstruction); keep deliveries 90 days after `done_at`; keep dead letters until resolved | Event-bus plumbing; the state-changing facts also live in their own tables and audit rows | DPO agreement; confirm no regulator reads the bus |
| `integration_outbound_events` / attempts | Delivered 90 days, dead-lettered kept until resolved | Partner webhook plumbing | DPO agreement |
| `clinical_task_transitions` | Kept with the task (clinical workflow trail used for quality and payout disputes) | Referenced by quality and earnings | CMO |
| `encounter_events` | Kept with the encounter | Clinical record | CMO and DPO |
| `net._http_response` | Self-cleaning already: pg_net deletes rows after its own TTL (6 hours by default; live shows the oldest row from today) | Pure transport log | None. IMPLEMENTED by the platform itself; nothing to add |
| `cron.job_run_details` | 7 days, failed runs 30 days, daily | Pure operational history | None. IMPLEMENTED in SR2a |

Every deletion job that eventually ships must: (a) count first and log the count, (b) delete whole partitions, not rows, where the table is partitioned, (c) never touch a row that belongs to a patient with an open legal hold or an open data subject request, (d) write its result to an operations table so failure is visible (the SR2a pattern), and (e) run in a transaction with a documented restore path (a PITR point taken immediately before the first run).

## 6. What was implemented from this document

Implemented (safe, pure operational history, no personal data):
- `cron.job_run_details`: daily clean-up `private.cron_history_cleanup(7, 30)` (SR2a migration `20261012180801_sr2a_cron_history_cleanup.sql`), proof `packages/db/tests/sr2a_cron_history_cleanup.sql`, retention numbers mirrored as PROPOSED config `db.cron_history_retention`. The first run on live removes about 370,000 rows and frees the table's space for reuse; run `vacuum full cron.job_run_details` once in a quiet minute afterwards if the 182 MB must be returned to the operating system (a plain `vacuum` only makes it reusable).
- `net._http_response`: nothing to build, pg_net already trims it.

Not implemented (and why):
- Monthly partition scaffolding: the plan asked for it "for new append-only tables if any". No new append-only table is introduced by SR1 to SR3, so there is nothing to scaffold; adding an unused helper function to the live schema would be clutter. The design above is ready to use the day a new append-only table is added (new tables should be created partitioned from the start, which is far cheaper than converting later).
- Partitioning any populated table, any deletion, archive or rollup of `audit_log`, `vitals_readings`, `wearable_readings`, `notifications`, `web_events`, event or outbox tables: designed above, not applied. Each needs the DPO's agreement (section 5) and, for partitioning, Stage A measurements to confirm the row counts in section 2.

## 7. Triggers: when to act

| Signal | Action |
|---|---|
| Any table above 20 million rows, or any single table above 25 percent of database size | Partition it (section 4) |
| `web_events` above 5 million rows | Partition first; it is the cheapest |
| Database above 50 percent of disk | Raise disk and run the retention decisions with the DPO the same week |
| After Stage A (500 Members, 2 weeks) | Re-run section 2 with measured per-Member rates and replace the assumptions |
| DPO signs a retention line | Add it as a versioned PROPOSED-then-confirmed config entry and build the job for that table only, with a proof |
