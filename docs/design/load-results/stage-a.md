# Load results, Stage A (500 Members)

> **LOCAL-LAPTOP RESULT. NOT PRODUCTION CAPACITY.** Synthetic `is_test` data, an isolated local Postgres in a container, database layer only: no Next.js, no edge functions, no Expo, Resend, Zoom or Paystack, no network between the client and the database, no PostgREST or pooler. Use these numbers to find what breaks first and to compare stages, never to promise a Member count to anyone (plan section 5).

Run: 2026-10-12T19:43:09.173Z to 2026-10-12T19:44:23.194Z. Seed 1.

## Machine and database

- Load generator and database host: Apple M5 Pro, 18 cores, 64 GiB, darwin 25.5.0 arm64, Node v24.20.0.
- Host load average (1, 5, 15 min) at the start of the run: 3.4, 14, 22.8. Other containers and sessions share this machine, so the numbers are noisier and slower than a quiet machine would give; they are not a clean benchmark.
- Database: PostgreSQL 17.6, in a Docker container. Container limited to 2 CPUs and 2 GB (docker update), max_connections 60, shared_buffers 224MB.
- Matched to the live project's small tier where it could be (live, read-only look 2026-10-10): max_connections 60, shared_buffers 224 MB. Not the same hardware: cloud shared-core ARM versus a laptop CPU.
- 111 active pg_cron jobs were running in the background during the whole run (the real schedule from the migrations; their HTTP calls to edge functions fail locally, so their cost is understated).
- Client pool: 20 connections (the database allows 60).

## Population

500 Members, 2,000 Free users, 10 doctors with a rota and queue availability. Generated in 1.6 s.

Rows: {"profiles":2511,"vitals":25000,"notifications":16000,"lab_orders":500,"encounters":150,"db_size":"953 MB"}

| table | rows (estimate) | size incl. indexes |
|---|---|---|
| domain_events | 126 | 318 MB |
| vitals_readings | 50000 | 153 MB |
| notifications | 32267 | 80 MB |
| profiles | 5024 | 14 MB |
| lab_orders | 500 | 4304 kB |
| encounters | 150 | 1360 kB |
| clinical_tasks | 0 | 296 kB |
| pages | 0 | 248 kB |

Database size after generation: 953 MB.

## Safety assertions at this stage

- PASS: SAFETY: no Member red event goes unpaged (0 of 10 events had no page)
- PASS: SAFETY: no task was claimed twice (10 claims, 10 distinct tasks, 0 tasks with two live claims)
- PASS: after every scenario, Member red events without a page: 0
- PASS: after every scenario, tasks with two live claims: 0
- PASS: s17_queue_concurrent_claim.sh (the written race test, run for real against this database, 15 s, exit 0)
  ```
  PASS | 50 callers, 30 tasks: 30 claims, 0 duplicates, 20 told none, 0 errors
  PASS | 50 callers, 1 task: exactly one winner, 49 told none, 0 errors
  PASS | control: a lock-free picker made 49 of 50 callers fail on the guard, so the race is real
  ```
- PASS: s19_page_ack_sweep_race.sh (the written race test, run for real against this database, 51 s, exit 0)
  ```
  PASS | 12 rounds of acknowledge-versus-sweep: every family fully acknowledged, at most one backup page, at most one task
  PASS | control: a lock-free sweep left a half-acknowledged family in 3 of 3 rounds, so the race is real
  ```

No assertion failed.

## Scenarios

Latencies are milliseconds for the whole request as the database sees it (a transaction as the signed-in role), measured by the client.

| scenario | calls | p50 | p95 | p99 | max | error rate | throughput |
|---|---|---|---|---|---|---|---|
| morning logging peak (reading save, as the patient) | 300 | 8.7 | 128.8 | 139.7 | 142.7 | 0.00% | 239/s |
| baseline: reading save, one at a time | 40 | 3.4 | 52.1 | 97.0 | 97.0 | 0.00% | 57/s |
| red burst: red reading save (Member) | 10 | 12.7 | 13.6 | 13.6 | 13.6 | 0.00% | 400/s |
| red burst: create_red_page (service role) | 10 | 17.1 | 17.4 | 17.4 | 17.4 | 0.00% | 200/s |
| red burst: red reading save (Free user) | 10 | 6.4 | 6.6 | 6.6 | 6.6 | 0.00% | 1429/s |
| queue_next (doctors asking for the next task) | 5 | 19.7 | 21.6 | 21.6 | 21.6 | 0.00% | 32/s |
| baseline: queue_next, one at a time | 5 | 8.1 | 51.9 | 51.9 | 51.9 | 0.00% | 42/s |
| booking: list_bookable_consult_slots | 100 | 5.1 | 24.2 | 25.7 | 43.9 | 0.00% | 862/s |
| join: encounter lookup (my_upcoming_encounters) | 100 | 4.6 | 21.0 | 45.2 | 45.8 | 0.00% | 862/s |
| payment webhook insert (idempotent, service role) | 125 | 5.1 | 21.2 | 44.7 | 59.0 | 0.00% | 1389/s |
| notification worker batch (claim 50 pending, mark sent) | 14 | 2.4 | 4.2 | 4.2 | 4.2 | 0.00% | 1556/s |
| offline sync: queued reading insert (with client_reading_id) | 2200 | 7.4 | 78.0 | 93.7 | 117.9 | 0.00% | 945/s |
| alert evaluator (all enabled rules, forced) | 8 | 12.1 | 41.8 | 41.8 | 41.8 | 0.00% | 63/s |
| operations_wall() as an admin | 30 | 1.8 | 5.5 | 43.4 | 43.4 | 0.00% | 132/s |

### morning (1.5 s)

- 300 Members logged (60 percent of 500) with 20 requests in flight.
- Connections seen (sampled every 250 ms): at most 23 open, 15 active, 0 waiting on a lock, of 60.
- PASS: reading save p95 within 5000 ms (p95 129 ms)
- PASS: no failed saves (0 errors [])

Slowest statements by total time (pg_stat_statements, reset before this scenario):

| statement | calls | mean ms | total ms |
|---|---|---|---|
| `insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, so` | 300 | 18.18 | 5454 |
| `insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, so` | 40 | 1.95 | 78 |

### red (0.4 s)

- 10 simultaneous red events. Trigger side effects of the Free reds: 0 emergency_events and 0 clinician_alerts (the Free-plan rule is enforced by the edge-function handler, which is not part of this run).
- Grading is done by the TypeScript triage engine inside process-events in production. This run inserts the red triage event directly (what the handler does after grading) and times create_red_page, the sweep and the notice rows. Delivery of push, email and SMS is not exercised.
- Connections seen (sampled every 250 ms): at most 23 open, 2 active, 0 waiting on a lock, of 60.
- Page ladder: create_red_page p50 17.1 ms, p95 17.4 ms; the 5 minute sweep over 10 unacknowledged pages took 23 ms (10 backups, 10 class 1 tasks); the 10 minute sweep took 14 ms (10 leads alerted). Times are database work only, not the 5 and 10 minute waits themselves.
- PASS: SAFETY: no Member red event goes unpaged (0 of 10 events had no page)
- PASS: each page notified the primary on push, in-app and email at critical priority (30 critical notices over 3 channels for 10 pages)
- PASS: the primary was an eligible, on-call clinician (clinician_is_eligible = true)
- PASS: page created within 60 s (p95) (p95 17 ms (database step only))
- PASS: ladder step 1 (5 min): every unacknowledged page paged its backup and created the class 1 task (10 backups, 10 tasks for 10 pages)
- PASS: ladder step 2 (10 min): every unacknowledged page alerted the clinical lead (10 of 10)
- PASS: no failed reading saves (0 Member, 0 Free)

Slowest statements by total time (pg_stat_statements, reset before this scenario):

| statement | calls | mean ms | total ms |
|---|---|---|---|
| `select public.create_red_page($1)` | 10 | 13.96 | 140 |
| `insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, so` | 20 | 5.35 | 107 |
| `select private.sweep_pages()` | 2 | 17.18 | 34 |
| `select count(*)::int n, count(distinct channel)::int ch from public.notifications where source_table = $2 and ` | 1 | 19.86 | 20 |
| `select private.clinician_is_eligible($1) e` | 1 | 2.41 | 2 |

### queue (0.4 s)

- 5 doctors asked at once for 7 open tasks (after 5 one-at-a-time baseline claims), through a pool of 20 connections (so some waited for a connection, as they would behind PostgREST).
- Connections seen (sampled every 250 ms): at most 23 open, 1 active, 0 waiting on a lock, of 60.
- PASS: SAFETY: no task was claimed twice (10 claims, 10 distinct tasks, 0 tasks with two live claims)
- PASS: no doctor holds two live claims (0 doctors)
- PASS: every task was handed out when there were enough doctors (10 claimed of 12 tasks by 10 doctors, 2 left open)
- PASS: next task p95 within 2000 ms (p95 22 ms)
- PASS: no errors (0 [])

Slowest statements by total time (pg_stat_statements, reset before this scenario):

| statement | calls | mean ms | total ms |
|---|---|---|---|
| `select public.queue_next($1) j` | 10 | 6.79 | 68 |
| `select private.create_clinical_task($1, $3, $2)` | 12 | 1.15 | 14 |
| `delete from public.clinical_task_transitions where task_id in (select id from public.clinical_tasks where pati` | 2 | 0.08 | 0 |
| `set session_replication_role = replica` | 2 | 0.06 | 0 |
| `reset session_replication_role` | 2 | 0.04 | 0 |

### booking (0.3 s)

- 200 read calls (half slot listings, half upcoming-encounter lookups). Holding and confirming a slot, and the Zoom room, are behind the clinical_operations_enabled go-live guard and Zoom; they are NOT exercised here, so this measures the read side only.
- Connections seen (sampled every 250 ms): at most 23 open, 3 active, 0 waiting on a lock, of 60.
- PASS: no errors ([[0,[]],[0,[]]])
- PASS: booking read p95 within 3 s (p95 24 ms)

Slowest statements by total time (pg_stat_statements, reset before this scenario):

| statement | calls | mean ms | total ms |
|---|---|---|---|
| `select * from public.list_bookable_consult_slots($1::timestamptz, $2::timestamptz, $3, $4, $5)` | 100 | 4.00 | 400 |
| `select * from public.my_upcoming_encounters()` | 100 | 0.25 | 25 |

### paystack (0.3 s)

- 125 deliveries of 100 distinct events. The business logic after the insert (activating a membership, ledger posting) is in the edge function and is not exercised.
- Connections seen (sampled every 250 ms): at most 23 open, 10 active, 0 waiting on a lock, of 60.
- PASS: no lost payment event and no duplicate (100 stored for 100 unique events sent (125 deliveries))
- PASS: none left unprocessed (0)
- PASS: no errors (0)

Slowest statements by total time (pg_stat_statements, reset before this scenario):

| statement | calls | mean ms | total ms |
|---|---|---|---|
| `insert into public.payment_transactions (provider, provider_event_id, event_type, amount_minor, currency, raw_` | 125 | 1.80 | 225 |
| `update public.payment_transactions set processed_at = now() where id = $1` | 100 | 0.64 | 64 |
| `delete from public.payment_transactions where provider_event_id like $1` | 1 | 13.14 | 13 |
| `select count(*)::int n, count(*) filter (where processed_at is null)::int unprocessed from public.payment_tran` | 1 | 0.12 | 0 |

### fanout (0.3 s)

- 500 notices, 4 concurrent workers. This is the database side of the worker only. Real throughput is bounded by Expo push and Resend rate limits and by the edge function's per-row work, which are not in the loop.
- Connections seen (sampled every 250 ms): at most 23 open, 5 active, 0 waiting on a lock, of 60.
- Notification queue age to send: p50 0.02 s, p95 0.02 s, max 0.02 s. Bulk queueing took 13 ms.
- Drain: 500 notices in 0.0 s, 55556 per second.
- PASS: every queued notice was drained (500 of 500 sent, 0 left)
- PASS: no errors (0)

Slowest statements by total time (pg_stat_statements, reset before this scenario):

| statement | calls | mean ms | total ms |
|---|---|---|---|
| `with b as (select id from public.notifications where status = $1 and template = $2 order by created_at limit $` | 14 | 1.57 | 22 |
| `delete from public.notifications where template = $1` | 1 | 20.29 | 20 |
| `insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_c` | 1 | 11.60 | 12 |
| `delete from public.notifications where status = $1 and template = $2` | 1 | 0.50 | 0 |
| `select count(*)::int n from public.notifications where status = $1 and template = $2` | 1 | 0.21 | 0 |

### offline (2.4 s)

- 100 phones, 20 queued readings each (capped at 40,000 requests), then 10 percent re-sent.
- Connections seen (sampled every 250 ms): at most 23 open, 17 active, 0 waiting on a lock, of 60.
- PASS: no reading lost: every queued reading is stored once (2000 stored of 2000 sent)
- PASS: retries were deduplicated, not errors (200 retries deduped, 0 errors [])

Slowest statements by total time (pg_stat_statements, reset before this scenario):

| statement | calls | mean ms | total ms |
|---|---|---|---|
| `insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, so` | 2000 | 7.28 | 14559 |
| `select count(distinct client_reading_id)::int n from public.vitals_readings where client_reading_id = any($1::` | 1 | 1.09 | 1 |

### monitoring (0.2 s)

- The stale-cron rule reads cron.job_run_details, the largest object in production (162 MB on 2026-10-10). Here it holds only this local stack's own history, so its cost is understated until SR2's clean-up lands.
- PASS: evaluator runs every enabled rule without error (ok)
- PASS: the wall loads in under 2 s (p95) (p95 5 ms)
- PASS: the evaluator finishes well inside its one minute cycle (p95 42 ms)

Slowest statements by total time (pg_stat_statements, reset before this scenario):

| statement | calls | mean ms | total ms |
|---|---|---|---|
| `select private.ops_evaluate_alerts($1, $2)` | 8 | 15.03 | 120 |
| `select public.operations_wall()` | 30 | 0.93 | 28 |
| `select code, last_error from public.ops_alert_rules where last_error is not null` | 1 | 0.00 | 0 |

## Service targets (PROPOSED, unsigned) against this run

Page to on-call within 60 s; reading save p95 within 5000 ms; next task p95 within 2000 ms; chart summary within 3000 ms. The chart summary is not measured by any scenario here. See each scenario's assertions above.

## What this does not tell you

- Anything about the web tier, serverless cold starts, the pooler, PostgREST, edge functions or third parties.
- Anything about cloud disk, memory pressure or noisy neighbours.
- Real user behaviour: arrival is a closed-loop burst, not a human curve.
- Triggers skipped in bulk generation (risk scores, timeline rows, points): live tables will be heavier than this population.
