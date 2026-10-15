# SR7: which Stage B to D changes the numbers justify

Date: 2026-10-12. Status: DRAFT for the founder. Plan: `docs/plans/SCALE-READINESS-PLAN.md` phase 4. Evidence: `docs/design/load-results/stage-a.md` and `stage-b.md` (SR4), plus three small probes described below.

**Read this first.** The evidence is a local-laptop result: synthetic `is_test` data, a Postgres container limited to 2 CPUs and 2 GB with `max_connections` 60 and `shared_buffers` 224 MB, database layer only (no web tier, edge functions, pooler, Expo, Resend, Zoom or Paystack). The laptop was shared with about 25 other containers; host load average ranged from 3 to 60 across runs and moved the same test by up to 10 times (25 reading saves a second on a loaded machine, about 900 a second on a quiet one). So these numbers show what is expensive and what grows; they do not state a production capacity, and no Member count should be promised from them. Stage C and D were not run. Stage B ran twice in full and several times in part.

**Nothing in production code or schema was changed for SR7.** Every item below is a recommendation. The one change I considered (making the `process-events` batch sizes settable by environment variable) is safe, but the numbers do not need it before Stage C, and any edit to a deployed edge function creates drift until someone redeploys it, so it stays a recommendation.

## Demand model used for the arithmetic (assumptions, not measurements)

One blood pressure reading a day per Member, 60 percent of Members logging inside a 3 hour morning window, the busiest minute three times the window average. One outbox event per reading (measured: 525,008 events and 525,000 deliveries for the saves in my runs, so 1 and 1).

| Stage | Members | saves a second, window average | busiest minute |
|---|---|---|---|
| A | 500 | 0.03 | 0.1 |
| B | 5,000 | 0.28 | 0.8 |
| C | 25,000 | 1.4 | 4.2 |
| D | 100,000 | 5.6 | 16.7 |

## What the numbers justify

| # | Area | Evidence | Verdict | Needed by |
|---|---|---|---|---|
| 1 | **Notification worker** (plan 4.3) | `send-pending-notifications` is scheduled every 5 minutes (live `cron.job`, read 2026-10-12) and its code takes one batch of 50 per run (`BATCH_SIZE = 50`, one `limit(BATCH_SIZE)` query, no loop). That is 50 notices per 5 minutes, 600 an hour. One reminder to each of 5,000 Members is about 8 hours of drain. The database side is not the limit: my 4-worker drain moved 50-row batches at 1,280 to 1,550 a second. | **Justified now, before Stage B.** Loop within a run until a time budget, claim with `for update skip locked`, add per-channel rate limits and back-off (plan 4.3). Check the Resend and Expo rate limits first; I did not measure either provider. | Stage B |
| 2 | **Event outbox drain** (plan 4.2) | `process-events` runs every 15 s and handles at most 10 x 6 = 60 deliveries per run, about 4 events a second at best. The busiest-minute demand is 0.8 (B), 4.2 (C), 16.7 (D) events a second. Claiming costs 330 ms for 100 deliveries with 525k pending (58 ms urgent-only), so the database is fine; the handler runtime is the limit. | Fine for B. **At the limit at C, about 4 times short at D.** Make batch size and batches settable (defaults unchanged), then add a second concurrent invocation or shard by `event_type`. Re-measure with the real handler runtime, which I could not run. | before Stage C |
| 3 | **Outbox and audit growth** (feeds SR3) | Each reading save writes a vitals row, one `domain_events` row (about 600 bytes), one delivery (about 370 bytes) and an `audit_log` row (about 1.1 KB). At 100,000 Members saving daily that is about 36.5 million saves a year, roughly 88 GB a year of which the reading itself is about 11 GB. `domain_events` was 318 MB for 525k events. | **Justified.** Retention or partitioning for `domain_events`, `domain_event_deliveries` and `audit_log` belongs in SR3, with the DPO's rule that audit rows are kept. | before Stage B data is large |
| 4 | **Compute size** (plan 4.1) | One reading save runs 19 triggers and costs about 21 ms of database time cold (explain), 3 to 7 ms median in the quiet runs. Quiet machine, 20 in flight: 25,000 saves in 27.8 s. Loaded machine: as low as 10 to 25 a second. Busiest-minute demand at D is 16.7 a second. | **Not justified by the quiet numbers, not ruled out by the loaded ones.** The gap is contention, which production will have from its own cron and edge work. Decide from a production-sized trial (Stage A pilot logs, then a re-run of this harness on the real tier), not from this laptop. | measure at Stage A |
| 5 | **Connections and pooling** | A 20-connection client pool showed up to 26 open and 24 active connections of 60, and a 50-session race test needs 50 slots by itself. When the harness kept its idle pool open, the race test failed with 14 callers refused (a harness fault, now fixed, but it shows how little room 60 gives). I did not measure memory per connection; one database crash during the first Stage B attempt (log: server processes terminated, container flagged out-of-memory) did not reproduce in the second attempt (peak 618 MiB of 2 GiB sampled). | Pooler transaction mode and per-role limits (SR2) are justified. Per-connection memory on this 1,650-migration schema needs a real measurement. The crash is unexplained and is not evidence of a limit. | SR2, before B |
| 6 | **Tail stalls** | In several of the full runs a few requests stalled for 10 to 33 seconds (one saw 17 of 3,000 saves hit the 15 s statement timeout; Stage B final: 20 of 24,200 offline-sync inserts). An isolated probe of 25,000 saves at the same concurrency had a worst case of 1.1 s, and an isolated 55-doctor next-task burst took 0.2 to 0.4 s total. The full runs also showed the next-task burst at 0.8 to 4.9 s once. | **Open, and the most important unknown.** Cause not found (candidates: checkpoint or autovacuum after bulk work, host contention). Re-run on a quiet machine with `log_checkpoints`, `auto_explain` and lock logging before trusting any latency claim. A 15 s stall is far outside the 5 s save and 2 s next-task targets. | before B |
| 7 | **Read replicas** (plan 4.1) | The heavy reads I measured were cheap: `operations_wall()` p95 5 to 47 ms, the alert evaluator p95 80 ms on 160k notifications. Analytics, monthly figures and reports were not measured. | **Not justified yet.** Revisit when the analytics RPCs are timed at Stage B size. | after B |
| 8 | **Video** (plan 4.4) | Only the read side of booking and joining was measured: slot listing p95 25 to 490 ms, upcoming-encounter lookup p95 6 to 48 ms, at 100 to 120 calls. Holding and confirming a slot and the Zoom room are behind the clinical-operations guard and Zoom, and were not exercised. | **No evidence either way.** The Zoom plan, concurrent-meeting ceiling and fallback ladder still need a real test (Stage A pilot checklist item). | Stage A |
| 9 | **Lab and testing-day capacity** (plan 4.5) | Not software; not measured. | Out of scope for these numbers. | planning |
| 10 | **Monitoring cost** | Evaluator and wall are cheap at Stage B size (above). The stale-cron rule reads `cron.job_run_details`, 162 MB in production on 2026-10-10, which my local copy did not have. | Land SR2's job-history clean-up before switching the stale-cron rule on in production, or its scan will be the most expensive thing the evaluator does. | before SR5 goes live |

## Safety results that hold at both stages run

At Stage A and Stage B, on the final runs: no Member red event went unpaged (10 of 10, 50 of 50), no task was claimed twice (10, then 47 claims, all distinct, no clinician with two live claims), the page ladder created the backup page and class 1 task at 5 minutes and alerted the lead at 10 minutes for every unacknowledged page, and the two written race tests (`s17_queue_concurrent_claim.sh`, `s19_page_ack_sweep_race.sh`) ran for the first time and passed, each with its lock-free control failing as it should. These are database-layer results with synthetic data; the grading step, push, email and SMS delivery were not in the loop.

## What I could not verify

- Stage C and D (not run). Anything on the web tier, edge functions, pooler, PostgREST, Zoom, Paystack, Expo or Resend.
- The free-versus-Member red event gate (it lives in the edge-function handler, not the database).
- Booking holds, confirmation and the Zoom room.
- Memory per connection, disk growth in time, replication lag, and anything on the real Supabase tier.
