# Scale-readiness plan: 5,000, then 25,000, then 100,000 Members

Date: 2026-10-10. Status: DRAFT for founder decision. Nothing here is approved, built or applied. Branch context: `s38/outcome-snapshots-analytics`.

Why this exists: the two-tier model (Free, and Member at 120,000 naira a year or 100,000 per organisation member) was costed at 5,000 and 100,000 Members. The platform is built to be correct and safe. It has not been sized or load-tested for those numbers.

## 1. Where we are today (measured 2026-10-10, read-only, live project `koiplnmbgnqnbywhpjlf`)

| Fact | Value | What it means |
|---|---|---|
| Real accounts | 12 profiles | There is no volume experience at all. Every number below is untested against real traffic. |
| Database size | 298 MB | Small. Growth is the question, not today. |
| `max_connections` | 60 | A small compute tier. `shared_buffers` is about 224 MB, which fits an entry-level instance. |
| Connections in use now | 17 of 60 | With 12 accounts. Serverless web instances each open connections, so this is the first limit to break. |
| Active scheduled jobs | 112, of which 7 run every minute or faster | The sweeps that page doctors, expire claims and send notifications compete with real traffic. |
| `cron.job_run_details` | 333,778 rows, 162 MB, since 2026-07-06 | The largest object in the database is job history, over half of its size. It grows without a clean-up job. |
| Plan | Below Pro (branching refused for plan reasons, per the standing note) | Confirm in the dashboard: backups, point-in-time recovery, read replicas and compute upgrades depend on it. |
| Backups / PITR | Unverified (see `docs/BUSINESS_CONTINUITY_DR_SPEC.md` section 3) | The recovery targets in the docs are placeholders. |
| Performance advisor | Reports unindexed foreign keys, row-level-security re-evaluation per row, multiple permissive policies, duplicate and unused indexes | Not counted precisely; the output was too large to read in full. Part of Phase 1. |
| Load testing | None found | No harness, no target, no results. |
| Alerting | Sentry is in the app but opt-in; uptime monitoring "exists but" is blocked on a founder step | Nobody is known to be paged if a service fails. |
| Rate limiter | In-memory until Upstash is configured | Does not hold across several web instances. |

## 2. Targets (proposed, for you to change)

| Stage | Members | Free users (assumed 4 per Member) | Follow-up calls | Blood tests a year | Red events a year (3%) |
|---|---|---|---|---|---|
| A. Pilot | 500 | 2,000 | 6,000 | 500 | about 15 |
| B. Launch | 5,000 | 20,000 | 60,000 (about 240 a working day) | 5,000 | about 150 |
| C. Growth | 25,000 | 100,000 | 300,000 (about 1,200 a day) | 25,000 | about 750 |
| D. Scale | 100,000 | 400,000 | 1,200,000 (about 4,800 a day) | 100,000 | about 3,000 |

Service targets to hold at every stage (proposed, the CMO and founder to set):
- A red event for a Member reaches an on-call doctor within 60 seconds of grading, and the acknowledgement ladder fires on time (5 and 10 minutes).
- A patient reading is saved and graded within 5 seconds of submission online, and syncs from offline without loss.
- A doctor gets the next task within 2 seconds of asking.
- A chart summary opens within 3 seconds.
- No lost payment confirmation, no lost lab result, no lost notification, no duplicated task.

## 3. Phases

### Phase 0: Know the baseline (about 1 week, you plus one session)
Cheap, mostly settings, and everything else depends on it.
1. **Hosting facts.** In the Supabase dashboard record: plan, compute size, connection limit, backup type and retention, whether point-in-time recovery is on. Same for Vercel (plan, function limits, deploy cap), Upstash, Railway, Zoom (plan, meeting and host limits), Paystack, Resend, Expo push.
2. **Upgrade to a paid plan with point-in-time recovery** before any real Member's data is stored. Treat this as a launch blocker (it is already on the release-blockers checklist).
3. **Switch on Sentry and uptime checks**, and route alerts to a phone: web app, `/api/health`-style endpoint, edge functions, Paystack webhook, Zoom webhook, `process-events`.
4. **Configure Upstash** so rate limits are shared across instances.
5. **Write down the targets** in section 2 as versioned config, using the existing PROPOSED-config mechanism, and get the CMO to sign.

### Phase 1: Make the database safe to grow (about 2 weeks, one build session)
1. **Job history clean-up.** Add a scheduled job that deletes `cron.job_run_details` older than 7 days, and make the sweeps record failures to the incident table rather than relying on history. Do this first; it is already 162 MB.
2. **Connection pooling.** Move all server code, edge functions and the web app onto the pooler in transaction mode. Set per-role connection limits so the rota, payment and notification paths cannot be starved by browsing traffic.
3. **Fix the performance advisor findings** in priority order: unindexed foreign keys on the tables the queue, paging, vitals, notifications and labs use; row-level-security policies that re-evaluate per row (wrap in a subselect); overlapping permissive policies; duplicate indexes.
4. **Growth plan for the tables that grow without limit:** vitals readings, notifications, audit log, web events, domain events and outbox, clinical task transitions, encounter events. For each: expected rows a year at stages B to D, index plan, partitioning by month where it pays off, an archive or retention rule agreed with the DPO (audit rows are kept; the rest are summarised then moved).
5. **Hot-path query review.** Read the real plans for: next task, red page sweep, claim expiry, chart summary, today screen, patient timeline, lab result release, notification send. Record the cost at 10,000 and 1,000,000 synthetic rows.
6. **Proofs:** a Jest or SQL proof that each new index exists and that the clean-up job leaves failed-job rows for 30 days.

### Phase 2: Build the load-test harness (about 2 weeks, one build session)
1. **Synthetic population generator.** Creates N test Members with `is_test = true`, doctors, a rota, readings history, lab orders, encounters. Uses the existing test-flag so nothing touches real metrics. Runs against an isolated stack or a scratch copy, never production.
2. **Scenario scripts** (k6 or similar) for: morning logging peak (everyone logs BP between 6 and 9am), burst of red events, 300 doctors claiming tasks at once, 4,800 booking and join calls a day, a payment-webhook storm after a corporate campaign, notification fan-out after an alert rule change, offline-sync flood after a regional network outage.
3. **Results recorded** per stage: p50 and p95 latency, error rate, connection use, CPU, slowest queries, queue age, page ladder timings. The first run is the baseline.
4. **Two safety tests that must pass at every stage:** no task claimed twice (the written but unrun 50-session race test runs here), and no red event for a Member goes unpaged under load.
5. **Gate:** nothing moves to the next stage until the targets in section 2 hold for the current one.

### Phase 3: Monitoring and alerting (about 2 weeks, runs beside Phase 2)
Every item below is a rule that pages a person, not only a dashboard.

| Signal | Alert when |
|---|---|
| Unacknowledged page | any page open past its first step (already a sev1 incident; confirm it reaches a phone) |
| Queue starvation | oldest open task per class exceeds its due time |
| No one on call | rota gap in the next 12 hours |
| Notification health | send failures above 2% over 15 minutes, or a channel with zero sends |
| Payment webhooks | any unprocessed webhook after 5 minutes, any amount mismatch |
| Database | connections above 70% of limit, replication lag, disk above 70%, slow-query rate |
| Cron | a job has not succeeded in twice its interval |
| Edge functions | error rate above 1%, or deployed version differs from source (the existing drift job) |
| Labs | a held result unreviewed past the review target; a partner has not entered results past the turnaround |
| Zoom | join failures above 3%, fallback-to-phone rate above 10% |
| Cost | monthly spend projection above budget for hosting, Zoom, SMS, AI calls |

Also build one **operations wall**: queue age by class, open pages, doctors online, calls in progress, tests this week, notification delivery, payments in the last hour. Extend the existing queue-health, paging and delivery-health views rather than starting again.

### Phase 4: Scale the architecture (only if Phase 2 shows it is needed; plan, do not pre-build)
1. **Compute and read replicas.** Step up compute at each stage; send heavy reads (analytics, monthly figures, reports) to a replica.
2. **Event outbox throughput.** Measure `process-events` at 10x current volume; shard or batch it if the backlog grows.
3. **Notification fan-out.** Queue sends through a worker with per-channel rate limits, back-off and provider failover (push, email; SMS only for codes and paging).
4. **Video.** Confirm the Zoom plan covers concurrent meetings at the daily peak; test the audio and phone fallback ladder under the same load.
5. **Lab and testing-day capacity.** Not software, but gating: lab turnaround for the panel at volume, courier routes, phlebotomy and the point-of-care team count (about 2,200 team-days a year at Stage D).
6. **Data residency and retention.** Review the regional hosting gap and the retention rules before holding hundreds of thousands of records.
7. **Cost controls.** Per-Member cost dashboard (hosting, lab, Zoom, AI, SMS) to check the 34,000 naira "other costs" assumption against real invoices.

### Phase 5: Staged rollout with a stop rule
1. Stage A pilot (500 Members), one region, daily review of the monitoring wall for two weeks.
2. Move to Stage B only if every target held and there were no unacknowledged pages or lost items.
3. Repeat for C and D. Each step also re-runs the load test at the next stage's size before the Members arrive.
4. Keep a written rollback for every stage: pause new sign-ups, route new Members to Free, stop testing-day bookings.

## 4. Suggested sessions (proposed IDs; none exist yet)

| ID | What | Depends on |
|---|---|---|
| SR1 | Baseline facts checklist, plan and PITR upgrade, Sentry and uptime, Upstash, targets as signed config | none |
| SR2 | Job history clean-up, pooling, advisor fixes, indexes | SR1 |
| SR3 | Growth and retention plan for unbounded tables, partitioning | SR2 |
| SR4 | Load-test harness and synthetic population | SR2 |
| SR5 | Alert rules and operations wall | SR1 |
| SR6 | Stage A pilot run and report | SR3 to SR5 |
| SR7 | Stage B to D architecture changes the tests demand | SR6 |

These sit beside the v5 sessions. They do not change the two-tier amendments in `docs/v5-sessions/00-AMENDMENTS-2026-10-08-two-tier.md`.

## 5. Costs and risks

- **Hosting spend rises.** Approximate cost bands are not in this plan because I have not priced the tiers; get quotes in Phase 0 and replace the 1,000 naira per Member platform line in the cost model with the real figure.
- **The 12-account database proves nothing.** Phase 2 is the only way to learn the true limits. Do not promise a Member count to an employer before Stage A results.
- **Safety first.** Every load test uses test accounts, an isolated stack, and the `is_test` flag. Never run it against production data.
- **Clean-up jobs delete data.** Each retention rule needs the DPO's agreement before it ships, and audit rows are never deleted.
- **Out-of-scope here:** clinical hiring, lab contracts, regulatory approvals, the Free red-event change and the 8-point Free path. They have their own plans.

## 6. Open decisions

1. Approve the stage targets in section 2, or change them.
2. Approve the service targets (60-second page, 5-second save, and so on) and who signs them.
3. Who receives the alerts, and who is the backup, given the team is small.
4. Budget ceiling for hosting at Stage B.
5. Run load tests on a scratch copy of the live schema, or the local isolated stack only?
