# SR2: hot-path query plans at 10,000 and 1,000,000 rows

Date: 2026-10-12. Plan reference: `docs/plans/SCALE-READINESS-PLAN.md` Phase 1 item 5.

## How this was measured, and the limits of it

- **Where:** the local Supabase stack (project id `tarragon-sr1`, port 49822), never production. The live project was queried read-only for definitions, indexes and row counts only; its tables hold 0 to 1,827 rows, so a live `EXPLAIN` would only show the planner choosing a sequential scan on tiny tables and proves nothing about scale.
- **What:** `scripts/sr2-query-plans.sql` loads synthetic rows inside one transaction that ends in `ROLLBACK` (`session_replication_role = replica`, so triggers and foreign keys are off for the load only), runs `ANALYZE`, then `EXPLAIN (ANALYZE, BUFFERS)` on the exact query shapes the functions and edge function run. Re-run it: `psql "$LOCAL_DB_URL" -v n=10000 -f scripts/sr2-query-plans.sql`, then `-v n=1000000`.
- **Distributions assumed:** `clinical_tasks` 1 percent live (open, escalated, offered, claimed), the rest completed; `task_claims` 100 live; `pages` 20 open and unacknowledged; `notifications` 200 pending; `vitals_readings` and `lab_orders` spread over 20,000 patients, 2 percent of lab orders in `processing`. Real data will differ. In particular the synthetic overdue rows are scattered evenly through the table, which is the worst case for heap reads.
- **Timing caveat, important:** the local stack was on a laptop with a large rolled-back load and autovacuum running (the same table was loaded and rolled back several times), so wall-clock milliseconds in the 1,000,000-row runs swing by a factor of 5 to 20 between identical runs (the same plan took 1.3 s, 1.6 s and 21 s on three runs). **Trust the plan shape and the buffer counts, not the milliseconds.** Buffers are reproducible and are what scales.
- **Not measured, and why.** The plan also names chart summary, today screen, patient timeline and lab result release. Chart summary and today screen are assembled in TypeScript from many separate reads (`read_patient_chart_audited`, `ops_today_summary`, `queue_summary`, the patient overview queries) rather than one query; measuring them honestly needs the load-test harness (SR4) driving the real application with a realistic population, not a single `EXPLAIN`. `release_lab_result` is a write path (state change plus notifications), covered for correctness by its own proofs, not for scale here. The patient timeline's main read is the `vitals_readings` and `lab_orders` per-patient reads in Q9 and Q10 below; `diagnostic_episode_timeline` and the other timeline RPCs were not profiled. These are recorded as open work, not as passed.

## Results

"Before" is the plan as the database stood on `main-dev` (only the SR2c indexes existed for Q6). "After" includes SR2d. Buffers are 8 kB pages.

| # | Hot path (source) | At 10,000 rows | At 1,000,000 rows, before | At 1,000,000 rows, after | Verdict |
|---|---|---|---|---|---|
| Q1 | **Next task**: eligible pool ordered by priority then due, limit 1 (`private.queue_candidates`, `public.queue_next`) | Index Scan `clinical_tasks_pool_idx`, 12 buffers | Index Scan `clinical_tasks_pool_idx`, 3 read buffers | same plan | Good. The partial index `(priority_class, due_at) where state in (open, escalated)` means cost follows the number of live tasks, not the table. Measured plan cost: well under the 2 second target at every size |
| Q2 | **Overdue task sweep** (every minute, `private.sweep_clinical_tasks`): `due_at + make_interval(...) <= now()` | Seq Scan, 910 buffers | **Parallel Seq Scan, 30,305 buffers read (about 240 MB), 1.26 s, every minute** | Not applicable: query rewritten | **Problem found and fixed in SR2d.** The expression on the column cannot use an index |
| Q2b | Same sweep, new form `due_at <= now() - make_interval(...)` (SR2d) | not run (form did not exist) | n/a | Bitmap Index Scan on new `clinical_tasks_overdue_idx` (4 index buffers), **3,000 heap blocks = exactly the 3,000 overdue rows** | Fixed. Cost now follows the number of overdue rows, not the table size. Proved identical result set to the old form for grace 0 and 15 minutes (`sr2d_...` proof) |
| Q3 | Offer window ended: `state = 'offered_to_lead' and lead_window_ends_at <= now()` | Bitmap Index Scan `clinical_tasks_offer_idx`, 1 buffer | same, 2 read buffers | same | Good |
| Q4 | Amber promotion: `type = 'amber_bp_review' and priority_class = 4 ...` | planned via the `(type, task_type_version)` foreign-key index, 916 buffers | **250,000 candidate rows from that index, 30,507 buffers, 828 ms** | Bitmap Index Scan on new tiny partial `clinical_tasks_amber_promotion_idx`, 0 rows read | **Problem found and fixed in SR2d** |
| Q5 | **Claim expiry**: `task_claims where ended_at is null and expires_at <= now()` (every minute, `private.expire_task_claims`) | Bitmap Index Scan `task_claims_one_live`, 9 buffers | same, 3 buffers read | same plan | Good: the partial unique index `where ended_at is null` already holds only live claims |
| Q6 | `queue_next` live-claim count: `clinician_id = $1 and ended_at is null` | with the SR2c foreign-key index, 8 buffers | 5 buffers read through the new `task_claims_clinician_id_fk_idx` (before SR2c this was a scan of `task_claims_one_live`'s 100 live rows plus a filter, also cheap) | same | Good. The new index serves the delete check from `clinical_staff` and the count; at 3,334 historic rows per clinician it reads 5 pages |
| Q7 | **Red page sweep**: unacknowledged root pages ordered by `sent_at` (every minute, `private.sweep_pages`, first loop) | Index Scan `pages_sweep_idx`, 2 buffers | same, 2 read buffers | same | Good: the partial index holds only the unanswered pages, so the safety-critical sweep stays constant-cost whatever the history |
| Q8 | **Notification send**: next batch of pending rows (edge function `send-pending-notifications`, every 5 minutes) | Bitmap Index Scan on `notifications_org_idx`, 94 buffers | Index Scan on `notifications_org_idx`, 798 read buffers for a 200-row backlog | Index Scan on new `notifications_pending_send_idx`, reads only the backlog | Improved in SR2d. The old plan scaled with how many rows the org/status index held; the new one scales with the pending backlog only |
| Q9 | **Timeline / chart**: latest 50 readings for one patient (`vitals_readings_patient_idx`) | Index Scan, 3 buffers | Bitmap Heap Scan, 53 read buffers (readings are scattered across the heap) | same | Fine for the 3 second target. Buffer count is bounded by the 50 requested rows; cold-cache latency on a real disk is the thing to measure in SR4 |
| Q10 | Lab orders for one patient, newest first | Index Scan `lab_orders_patient_idx`, 3 buffers | 23 read buffers | same | Good |
| Q11 | **Lab queue**: organisation orders in `processing`, oldest first, limit 50 | Bitmap Heap Scan, 202 buffers | **20,001 buffers and a sort of 20,000 rows, 2.1 s** (a 20,000-order backlog, deliberately large) | Index Scan on new `lab_orders_org_status_ordered_idx`, returns the first 50 directly, 0.1 to 0.2 ms | **Problem found and fixed in SR2d**, and the cost no longer depends on backlog size |

## Findings in order of importance

1. **The minute-by-minute overdue sweep was the one plan that does not survive scale.** A full table scan every 60 seconds is a fixed tax on the same database that serves doctors and patients, and it grows linearly with every task ever created. Fixed by writing the same condition so an index can serve it and adding a partial index on the two live states. This is the only change to a function body in SR2, made as a guarded in-place rewrite (the migration refuses to run if the live definition no longer contains the expected text).
2. The red page sweep (Q7), claim expiry (Q5) and next task (Q1) are already shaped correctly: each has a partial index holding only live rows. That is the design to copy for any new sweep.
3. `queue_next` itself was not profiled end to end at 1,000,000 rows because its candidate function (`queue_candidates`) filters by tier, competencies and conflicts through functions; the candidate ordering and index choice (Q1) is the part that scales with table size. The 50-session race test (`packages/db/tests/s17_queue_concurrent_claim.sh`) covers correctness, not scale; SR4 runs it under load.
4. Cold-cache latency on a real disk and the effect of 300 clinicians calling `queue_next` at once are not answerable from `EXPLAIN`. They belong to the SR4 load test.

## Re-running after any change

```sh
psql "$LOCAL_DB_URL" -X -v n=1000000 -f scripts/sr2-query-plans.sql | grep -E "^#####|Execution Time|Scan using|Scan on|Buffers: shared"
```

Expect: Q1, Q3, Q4, Q5, Q7, Q11 and Q2b to show an Index or Bitmap Index scan and low buffer counts; any `Seq Scan` on `clinical_tasks`, `task_claims`, `pages` or `notifications` in those lines is a regression.
