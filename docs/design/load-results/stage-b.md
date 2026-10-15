# Load results, Stage B (5,000 Members)

> **LOCAL-LAPTOP RESULT. NOT PRODUCTION CAPACITY.** Synthetic `is_test` data, an isolated local Postgres in a container, database layer only: no Next.js, no edge functions, no Expo, Resend, Zoom or Paystack, no network between the client and the database, no PostgREST or pooler. Use these numbers to find what breaks first and to compare stages, never to promise a Member count to anyone (plan section 5).

Run: 2026-10-12T19:44:23.255Z to 2026-10-12T19:52:02.673Z. Seed 1.

## Machine and database

- Load generator and database host: Apple M5 Pro, 18 cores, 64 GiB, darwin 25.5.0 arm64, Node v24.20.0.
- Host load average (1, 5, 15 min) at the start of the run: 5, 12.1, 21.4. Other containers and sessions share this machine, so the numbers are noisier and slower than a quiet machine would give; they are not a clean benchmark.
- Database: PostgreSQL 17.6, in a Docker container. Container limited to 2 CPUs and 2 GB (docker update), max_connections 60, shared_buffers 224MB.
- Matched to the live project's small tier where it could be (live, read-only look 2026-10-10): max_connections 60, shared_buffers 224 MB. Not the same hardware: cloud shared-core ARM versus a laptop CPU.
- 111 active pg_cron jobs were running in the background during the whole run (the real schedule from the migrations; their HTTP calls to edge functions fail locally, so their cost is understated).
- Client pool: 20 connections (the database allows 60).

## Population

5,000 Members, 20,000 Free users, 60 doctors with a rota and queue availability. Generated in 2.7 s.

Rows: {"profiles":25061,"vitals":250000,"notifications":160000,"lab_orders":5000,"encounters":1500,"db_size":"901 MB"}

| table | rows (estimate) | size incl. indexes |
|---|---|---|
| domain_events | 6 | 318 MB |
| vitals_readings | 250000 | 116 MB |
| notifications | 160270 | 55 MB |
| profiles | 25063 | 18 MB |
| lab_orders | 5000 | 3536 kB |
| encounters | 1500 | 1072 kB |
| pages | 0 | 272 kB |
| clinical_tasks | 0 | 192 kB |

Database size after generation: 901 MB.

## Safety assertions at this stage

- PASS: SAFETY: no Member red event goes unpaged (0 of 50 events had no page)
- PASS: SAFETY: no task was claimed twice (47 claims, 47 distinct tasks, 0 tasks with two live claims)
- PASS: after every scenario, Member red events without a page: 0
- PASS: after every scenario, tasks with two live claims: 0
- PASS: s17_queue_concurrent_claim.sh (the written race test, run for real against this database, 15 s, exit 0)
  ```
  PASS | 50 callers, 30 tasks: 30 claims, 0 duplicates, 20 told none, 0 errors
  PASS | 50 callers, 1 task: exactly one winner, 49 told none, 0 errors
  PASS | control: a lock-free picker made 49 of 50 callers fail on the guard, so the race is real
  ```
- PASS: s19_page_ack_sweep_race.sh (the written race test, run for real against this database, 50 s, exit 0)
  ```
  PASS | 12 rounds of acknowledge-versus-sweep: every family fully acknowledged, at most one backup page, at most one task
  PASS | control: a lock-free sweep left a half-acknowledged family in 3 of 3 rounds, so the race is real
  ```

**Assertions that failed (1):** offline: retries were deduplicated, not errors

## Scenarios

Latencies are milliseconds for the whole request as the database sees it (a transaction as the signed-in role), measured by the client.

| scenario | calls | p50 | p95 | p99 | max | error rate | throughput |
|---|---|---|---|---|---|---|---|
| morning logging peak (reading save, as the patient) | 3000 | 10.3 | 304.9 | 1657.1 | 10627.9 | 0.00% | 199/s |
| baseline: reading save, one at a time | 40 | 6.3 | 87.1 | 87.9 | 87.9 | 0.00% | 46/s |
| red burst: red reading save (Member) | 50 | 15.5 | 30.1 | 35.0 | 35.0 | 0.00% | 909/s |
| red burst: create_red_page (service role) | 50 | 19.1 | 72.6 | 74.7 | 74.7 | 0.00% | 254/s |
| red burst: red reading save (Free user) | 50 | 6.5 | 44.8 | 45.1 | 45.1 | 0.00% | 862/s |
| queue_next (doctors asking for the next task) | 55 | 123.2 | 212.6 | 214.1 | 214.1 | 0.00% | 140/s |
| baseline: queue_next, one at a time | 5 | 4.6 | 8.0 | 8.0 | 8.0 | 0.00% | 156/s |
| booking: list_bookable_consult_slots | 120 | 5.0 | 25.6 | 48.5 | 50.5 | 0.00% | 1121/s |
| join: encounter lookup (my_upcoming_encounters) | 120 | 4.1 | 5.8 | 6.3 | 6.5 | 0.00% | 1121/s |
| payment webhook insert (idempotent, service role) | 1250 | 5.0 | 31.3 | 54.0 | 105.6 | 0.00% | 2441/s |
| notification worker batch (claim 50 pending, mark sent) | 105 | 2.9 | 6.5 | 10.3 | 10.3 | 0.00% | 1280/s |
| offline sync: queued reading insert (with client_reading_id) | 22000 | 10.3 | 134.6 | 1416.8 | 33462.2 | 0.09% | 192/s |
| alert evaluator (all enabled rules, forced) | 8 | 54.8 | 80.1 | 80.1 | 80.1 | 0.00% | 19/s |
| operations_wall() as an admin | 30 | 7.4 | 11.1 | 22.3 | 22.3 | 0.00% | 45/s |

### morning (15.1 s)

- 3000 Members logged (60 percent of 5000) with 20 requests in flight.
- Connections seen (sampled every 250 ms): at most 22 open, 20 active, 0 waiting on a lock, of 60.
- PASS: reading save p95 within 5000 ms (p95 305 ms)
- PASS: no failed saves (0 errors [])

Slowest statements by total time (pg_stat_statements, reset before this scenario):

| statement | calls | mean ms | total ms |
|---|---|---|---|
| `insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, so` | 3000 | 66.06 | 198192 |
| `insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, so` | 40 | 2.85 | 114 |
| `select private.sweep_pages()` | 1 | 12.66 | 13 |
| `insert into cron.job_run_details (jobid, runid, database, username, command, status) values ($1,$2,$3,$4,$5,$6` | 2 | 2.44 | 5 |
| `update cron.job_run_details set status = $1, start_time = $2 where runid = $3` | 2 | 0.27 | 1 |

### red (0.7 s)

- 50 simultaneous red events. Trigger side effects of the Free reds: 0 emergency_events and 0 clinician_alerts (the Free-plan rule is enforced by the edge-function handler, which is not part of this run).
- Grading is done by the TypeScript triage engine inside process-events in production. This run inserts the red triage event directly (what the handler does after grading) and times create_red_page, the sweep and the notice rows. Delivery of push, email and SMS is not exercised.
- Connections seen (sampled every 250 ms): at most 22 open, 4 active, 0 waiting on a lock, of 60.
- Page ladder: create_red_page p50 19.1 ms, p95 72.6 ms; the 5 minute sweep over 50 unacknowledged pages took 77 ms (50 backups, 50 class 1 tasks); the 10 minute sweep took 38 ms (50 leads alerted). Times are database work only, not the 5 and 10 minute waits themselves.
- PASS: SAFETY: no Member red event goes unpaged (0 of 50 events had no page)
- PASS: each page notified the primary on push, in-app and email at critical priority (150 critical notices over 3 channels for 50 pages)
- PASS: the primary was an eligible, on-call clinician (clinician_is_eligible = true)
- PASS: page created within 60 s (p95) (p95 73 ms (database step only))
- PASS: ladder step 1 (5 min): every unacknowledged page paged its backup and created the class 1 task (50 backups, 50 tasks for 50 pages)
- PASS: ladder step 2 (10 min): every unacknowledged page alerted the clinical lead (50 of 50)
- PASS: no failed reading saves (0 Member, 0 Free)

Slowest statements by total time (pg_stat_statements, reset before this scenario):

| statement | calls | mean ms | total ms |
|---|---|---|---|
| `select public.create_red_page($1)` | 50 | 20.37 | 1019 |
| `insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, so` | 100 | 5.19 | 519 |
| `select private.sweep_pages()` | 2 | 56.10 | 112 |
| `select count(*)::int n, count(distinct channel)::int ch from public.notifications where source_table = $2 and ` | 1 | 9.16 | 9 |
| `insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_` | 50 | 0.07 | 3 |

### queue (0.4 s)

- 55 doctors asked at once for 42 open tasks (after 5 one-at-a-time baseline claims), through a pool of 20 connections (so some waited for a connection, as they would behind PostgREST).
- Connections seen (sampled every 250 ms): at most 22 open, 0 active, 0 waiting on a lock, of 60.
- PASS: SAFETY: no task was claimed twice (47 claims, 47 distinct tasks, 0 tasks with two live claims)
- PASS: no doctor holds two live claims (0 doctors)
- PASS: every task was handed out when there were enough doctors (47 claimed of 47 tasks by 60 doctors, 0 left open)
- PASS: next task p95 within 2000 ms (p95 213 ms)
- PASS: no errors (0 [])

Slowest statements by total time (pg_stat_statements, reset before this scenario):

| statement | calls | mean ms | total ms |
|---|---|---|---|
| `select public.queue_next($1) j` | 60 | 51.80 | 3108 |
| `select private.create_clinical_task($1, $3, $2)` | 47 | 0.79 | 37 |
| `delete from public.clinical_task_transitions where task_id in (select id from public.clinical_tasks where pati` | 2 | 0.14 | 0 |
| `delete from public.pages where patient_id in (select id from public.profiles where full_name like $1)` | 2 | 0.09 | 0 |
| `delete from public.clinical_tasks where patient_id in (select id from public.profiles where full_name like $1)` | 2 | 0.07 | 0 |

### booking (0.3 s)

- 240 read calls (half slot listings, half upcoming-encounter lookups). Holding and confirming a slot, and the Zoom room, are behind the clinical_operations_enabled go-live guard and Zoom; they are NOT exercised here, so this measures the read side only.
- Connections seen (sampled every 250 ms): at most 26 open, 0 active, 0 waiting on a lock, of 60.
- PASS: no errors ([[0,[]],[0,[]]])
- PASS: booking read p95 within 3 s (p95 26 ms)

Slowest statements by total time (pg_stat_statements, reset before this scenario):

| statement | calls | mean ms | total ms |
|---|---|---|---|
| `select * from public.list_bookable_consult_slots($1::timestamptz, $2::timestamptz, $3, $4, $5)` | 120 | 2.01 | 241 |
| `select * from public.my_upcoming_encounters()` | 120 | 0.24 | 29 |

### paystack (0.8 s)

- 1250 deliveries of 1000 distinct events. The business logic after the insert (activating a membership, ledger posting) is in the edge function and is not exercised.
- Connections seen (sampled every 250 ms): at most 26 open, 11 active, 0 waiting on a lock, of 60.
- PASS: no lost payment event and no duplicate (1000 stored for 1000 unique events sent (1250 deliveries))
- PASS: none left unprocessed (0)
- PASS: no errors (0)

Slowest statements by total time (pg_stat_statements, reset before this scenario):

| statement | calls | mean ms | total ms |
|---|---|---|---|
| `insert into public.payment_transactions (provider, provider_event_id, event_type, amount_minor, currency, raw_` | 1250 | 0.22 | 273 |
| `update public.payment_transactions set processed_at = now() where id = $1` | 1000 | 0.10 | 101 |
| `delete from public.payment_transactions where provider_event_id like $1` | 1 | 30.42 | 30 |
| `select count(*)::int n, count(*) filter (where processed_at is null)::int unprocessed from public.payment_tran` | 1 | 0.10 | 0 |

### fanout (0.4 s)

- 5000 notices, 4 concurrent workers. This is the database side of the worker only. Real throughput is bounded by Expo push and Resend rate limits and by the edge function's per-row work, which are not in the loop.
- Connections seen (sampled every 250 ms): at most 26 open, 4 active, 0 waiting on a lock, of 60.
- Notification queue age to send: p50 0.15 s, p95 0.18 s, max 0.18 s. Bulk queueing took 98 ms.
- Drain: 5000 notices in 0.1 s, 60976 per second.
- PASS: every queued notice was drained (5000 of 5000 sent, 0 left)
- PASS: no errors (0)

Slowest statements by total time (pg_stat_statements, reset before this scenario):

| statement | calls | mean ms | total ms |
|---|---|---|---|
| `with b as (select id from public.notifications where status = $1 and template = $2 order by created_at limit $` | 105 | 2.03 | 213 |
| `insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_c` | 1 | 93.27 | 93 |
| `delete from public.notifications where template = $1` | 1 | 72.51 | 73 |
| `delete from public.notifications where status = $1 and template = $2` | 1 | 0.53 | 1 |
| `select count(*)::int n from public.notifications where status = $1 and template = $2` | 1 | 0.44 | 0 |

### offline (114.7 s)

- 1000 phones, 20 queued readings each (capped at 40,000 requests), then 10 percent re-sent.
- Connections seen (sampled every 250 ms): at most 42 open, 21 active, 7 waiting on a lock, of 60.
- PASS: no reading lost: every queued reading is stored once (19980 stored of 19980 sent)
- **FAIL**: retries were deduplicated, not errors (2000 retries deduped, 20 errors [["57014: canceling statement due to statement timeout",20]])
- Error kinds for "offline sync: queued reading insert (with client_reading_id)": [["57014: canceling statement due to statement timeout",20]]

Slowest statements by total time (pg_stat_statements, reset before this scenario):

| statement | calls | mean ms | total ms |
|---|---|---|---|
| `insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, so` | 19980 | 54.71 | 1093159 |
| `select private.queue_push_email_fallbacks()` | 1 | 591.26 | 591 |
| `select private.ops_evaluate_alerts()` | 2 | 257.44 | 515 |
| `select private.earnings_sweep()` | 1 | 377.21 | 377 |
| `select private.sweep_triage_rechecks()` | 1 | 204.26 | 204 |

### monitoring (0.7 s)

- The stale-cron rule reads cron.job_run_details, the largest object in production (162 MB on 2026-10-10). Here it holds only this local stack's own history, so its cost is understated until SR2's clean-up lands.
- PASS: evaluator runs every enabled rule without error (ok)
- PASS: the wall loads in under 2 s (p95) (p95 11 ms)
- PASS: the evaluator finishes well inside its one minute cycle (p95 80 ms)

Slowest statements by total time (pg_stat_statements, reset before this scenario):

| statement | calls | mean ms | total ms |
|---|---|---|---|
| `select private.ops_evaluate_alerts($1, $2)` | 8 | 51.81 | 414 |
| `select public.operations_wall()` | 30 | 5.29 | 159 |
| `select code, last_error from public.ops_alert_rules where last_error is not null` | 1 | 0.01 | 0 |

## Service targets (PROPOSED, unsigned) against this run

Page to on-call within 60 s; reading save p95 within 5000 ms; next task p95 within 2000 ms; chart summary within 3000 ms. The chart summary is not measured by any scenario here. See each scenario's assertions above.

## What this does not tell you

- Anything about the web tier, serverless cold starts, the pooler, PostgREST, edge functions or third parties.
- Anything about cloud disk, memory pressure or noisy neighbours.
- Real user behaviour: arrival is a closed-loop burst, not a human curve.
- Triggers skipped in bulk generation (risk scores, timeline rows, points): live tables will be heavier than this population.
