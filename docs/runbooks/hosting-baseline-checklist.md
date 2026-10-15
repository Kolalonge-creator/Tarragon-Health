# Hosting baseline checklist (SR1)

Owner: the founder. Purpose: record, once, the real plan, limits and recovery settings of every paid service, switch on the alerts that were only opt-in, and turn the figures into a dated record. Nothing here can be done from code. Fill in the "Record" column as you go and commit the finished copy so the next session starts from facts, not assumptions.

Date started: ______  Done by: ______  Source plan: `docs/plans/SCALE-READINESS-PLAN.md` Phase 0.

Do the sections in this order. Sections 1 and 2 are launch blockers (already on the release-blockers checklist): no real Member's data is stored before they are done.

## 0. Facts measured from code and the live database on 2026-10-12 (so you know what to expect to see)

| Fact | Value | Why it matters |
|---|---|---|
| Postgres `max_connections` | 60 (3 reserved for superuser) | Looks like an entry compute size. Dashboard compute size should confirm it. |
| Connections in use | 17 at one reading; of those 5 are PostgREST, 1 pg_net, 1 pg_cron scheduler, 1 exporter, 1 management API | Nothing in the code opens a direct Postgres connection (see `docs/design/SR2-advisor-triage.md` section 4). Connection pressure comes from PostgREST's pool, not from serverless instances. |
| `shared_buffers` | 224 MB | Small instance. |
| `statement_timeout` | 120 s default; `authenticated` 8 s; `anon` 3 s | Already set per role. |
| Database size | about 300 MB | `cron.job_run_details` was 182 MB of it before the SR2a clean-up. |
| Real accounts | 12 profiles | No volume experience yet. |

## 1. Supabase (project `koiplnmbgnqnbywhpjlf`, eu-west-1)

Dashboard path in brackets. Take a dated screenshot of each page into the evidence folder named in section 11.

| Step | Where | Record |
|---|---|---|
| 1.1 Plan name and monthly cost | [Organization > Billing] | Plan: ____  Cost: ____ |
| 1.2 Compute size (RAM, CPU) and the max connections it gives | [Project Settings > Compute and Disk] | Size: ____  RAM: ____  CPU: ____  Connections: ____ |
| 1.3 Disk size and whether auto-scaling is on | same page | Disk: ____ GB  Auto: ____ |
| 1.4 **Backups: type and retention.** Daily backups only, or point-in-time recovery (PITR)? | [Database > Backups] | Type: ____  Retention (days): ____  PITR on: yes / no |
| 1.5 **Switch on PITR** (requires a paid plan and the PITR add-on). Choose the longest window offered (7 days is the usual minimum to accept). | [Database > Backups > Point in Time] | PITR enabled on: ____ |
| 1.6 **Do one real restore test** into a new project or a restore point, confirm it opens and the row counts of `profiles`, `vitals_readings`, `audit_log` match, then note how long it took. This is the only evidence that recovery works. | [Database > Backups] | Restore time: ____ min  Verified by: ____ |
| 1.7 Connection pooler (Supavisor): pool mode and pool size. Pool size should leave headroom under max connections. | [Database > Connection pooling] / [Project Settings > Database] | Mode: ____  Pool size: ____  Max client connections: ____ |
| 1.8 Read replicas available on this plan? (cost only; not needed before Stage C) | [Database > Replicas] | Available: ____  Cost: ____ |
| 1.9 Branching: still refused on this plan? (standing note in CLAUDE.md) | [Branches] | Result: ____ |
| 1.10 Edge function invocation and compute limits for the plan | [Edge Functions] and plan page | Invocations/month: ____ |
| 1.11 Auth: SMTP provider in use (Resend or the built-in one, which is rate limited), rate limits for sign-in and OTP | [Authentication > Rate Limits], [Authentication > SMTP] | SMTP: ____  Emails/hour: ____ |
| 1.12 Storage size and egress allowance | [Storage], plan page | Included: ____ GB |
| 1.13 Spend cap on or off | [Organization > Billing] | Spend cap: ____ |
| 1.14 Set the edge-function secrets for error reporting (section 8.3): `SENTRY_DSN`, `SENTRY_ENVIRONMENT=production`, `SENTRY_RELEASE` | [Edge Functions > Secrets] | Done on: ____ |
| 1.15 Redeploy the seven edge functions that now wrap their handler (`supabase functions deploy <name>` for process-events, paystack-webhook, zoom-webhook, send-pending-notifications, queue-next, integration-outbound-drain, abnormal-result-handler). Deploy needs no link or Docker (see memory note). Confirm with the edge-drift job. | terminal | Deployed on: ____ |

Decision to write down: is the plan Pro or above, is PITR on, and what is the restore time? If any answer is "no", stop here; that blocks real data.

## 2. Vercel (web app and console)

| Step | Where | Record |
|---|---|---|
| 2.1 Plan (Hobby, Pro, Enterprise) and monthly cost | [Team > Settings > Billing] | Plan: ____ |
| 2.2 Function limits: max duration, memory, concurrency, regions | [Project > Settings > Functions] | Duration: ____ s  Memory: ____ MB  Region: ____ |
| 2.3 Deployment cap per day (the standing note says 100/day, 402 above it) | [Team > Usage] | Cap: ____ |
| 2.4 Cron jobs allowed and their minimum interval on this plan (sub-daily can block deploys on Hobby) | [Project > Settings > Cron Jobs] | Allowed: ____ |
| 2.5 Environment variables to add (Production only unless stated). See `.env.example` for what each does. | [Project > Settings > Environment Variables] | |
| 2.5a `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` (same value) | | Set: ____ |
| 2.5b `SENTRY_TRACES_SAMPLE_RATE=0.1` and `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=0.1` | | Set: ____ |
| 2.5c `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` (build time, uploads source maps; the release name is the Vercel commit sha automatically) | | Set: ____ |
| 2.5d `HEALTH_CHECK_SECRET` (random, at least 24 characters, for example from `openssl rand -hex 32`; same value goes into the uptime monitor) | | Set: ____ |
| 2.5e `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (section 3) | | Set: ____ |
| 2.6 Expose system environment variables so `VERCEL_GIT_COMMIT_SHA` and `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` exist (the release tag depends on them) | [Settings > Environment Variables > Automatically expose System Environment Variables] | On: ____ |
| 2.7 Production branch is `main-dev`; promotion is automatic | [Settings > Git] | Confirmed: ____ |
| 2.8 Usage this month: bandwidth, function GB-hours, edge requests, against plan limits | [Team > Usage] | Bandwidth: ____  GB-h: ____ |

## 3. Upstash (rate limiting)

| Step | Where | Record |
|---|---|---|
| 3.1 Create one Redis database in the region nearest the Vercel functions (eu-west-1 or the Vercel region in 2.2). Global is not needed. | [Upstash console] | Region: ____ |
| 3.2 Plan and limits: commands per day, max request size, bandwidth, cost at 100k commands a day | plan page | Plan: ____  Commands/day: ____ |
| 3.3 Copy the REST URL and REST token into Vercel (2.5e). The code starts using it on the next deploy with no change; until then the in-process limiter protects each instance only. | | Done: ____ |
| 3.4 Verify after deploy: Upstash Data Browser shows keys starting `th-ratelimit`. If the keys never appear, the variables are wrong. If Upstash is down the app falls back to the in-process limiter and logs one warning a minute. | [Upstash > Data Browser] | Keys seen: ____ |
| 3.5 Estimate: every login and sign-up attempt makes 1 to 2 commands. At Stage B (5,000 Members) allow 5,000 to 20,000 commands a day; confirm the plan covers 10x that. | | Plan covers: ____ |

## 4. Railway (persistent compute and background jobs)

| Step | Where | Record |
|---|---|---|
| 4.1 Is anything deployed on Railway today? (The architecture lists it; the repo has no Railway config.) | [Railway > Projects] | Services: ____ |
| 4.2 If yes: plan, per-service CPU and RAM, restart policy, cost per month | [Project > Settings] | |
| 4.3 If no: write "nothing deployed" here and strike Railway from the capacity plan | | |

## 5. Zoom (video consultations)

| Step | Where | Record |
|---|---|---|
| 5.1 Account plan and licence type | [Zoom admin > Billing] | Plan: ____ |
| 5.2 Concurrent meetings allowed, maximum participants, meeting duration limit. Stage B has about 240 calls a working day; Stage D about 4,800 | plan page | Concurrent: ____ |
| 5.3 Host user and Server-to-Server OAuth app (S21 launch checklist: none of these were done as of 2026-10-06) | [Zoom Marketplace] | Done: ____ |
| 5.4 Webhook: URL is the `zoom-webhook` edge function; copy the secret token into the function's environment | [Marketplace > App > Feature] | Done: ____ |
| 5.5 API rate limits for the plan (meeting create per second and per day) | [Zoom docs for your plan] | Limit: ____ |
| 5.6 Cloud recording storage, if used | | |

## 6. Paystack

| Step | Where | Record |
|---|---|---|
| 6.1 Live business status (live keys issued, settlement account set) | [Paystack dashboard > Settings] | Live: ____ |
| 6.2 Transaction fee, settlement schedule, and any monthly volume cap or transaction limit on the account | [Settings > Preferences], account manager | Fee: ____  Cap: ____ |
| 6.3 Webhook URL points at the `paystack-webhook` edge function, with retries on | [Settings > API Keys and Webhooks] | Done: ____ |
| 6.4 Test-mode payment completed end to end (S25 deferred this until the founder supplies a test key) | | Done: ____ |
| 6.5 Payouts: transfer limits and OTP settings (S31 go-live guard is OFF; tax counsel and a real test payout are the gates) | | |

## 7. Resend (email) and Expo push

| Step | Where | Record |
|---|---|---|
| 7.1 Resend plan, monthly send cap, daily cap, per-second rate limit | [Resend > Settings > Billing] | Cap: ____  Rate: ____ |
| 7.2 Sending domain verified (SPF, DKIM, DMARC all green) | [Resend > Domains] | Verified: ____ |
| 7.3 Webhook for delivery events points at the `resend-webhook` edge function | [Resend > Webhooks] | Done: ____ |
| 7.4 Stage B estimate: 5,000 Members times a few emails a month is small, but a single alert-rule change can fan out to everyone; confirm the daily cap exceeds the largest single fan-out you can imagine (all Members at once) | | Largest fan-out: ____ |
| 7.5 Expo push: Expo account plan, whether push receipts are being read (the `expo-push-receipts` job runs every 10 minutes), the free-tier throughput limit | [expo.dev > Account] | Plan: ____ |
| 7.6 EAS: a `runtimeVersion 0.2.0` build exists before the next OTA publish reaches devices (standing note) | [expo.dev > Builds] | Build: ____ |

## 8. Error reporting (Sentry) and uptime monitoring

The code now builds Sentry's options in one place (`apps/web/src/lib/sentry/options.ts`) for the server, the edge runtime and the browser, tags every event with the release (the Vercel commit sha), strips personal data before sending, and samples 10 percent of traces by default (it was 100 percent). The seven critical edge functions report their own uncaught errors and any 5xx they return. Everything stays off until a DSN is set.

| Step | Where | Record |
|---|---|---|
| 8.1 Create a Sentry organisation and ONE project of type Next.js (web, console and browser share it, separated by environment). Free Developer plan is enough to start; note the event quota. | [sentry.io] | Org: ____  Project: ____  Quota: ____ |
| 8.2 Copy the DSN. Put it in Vercel (2.5a). | | Done: ____ |
| 8.3 Put the same DSN into the Supabase edge function secrets (1.14). | | Done: ____ |
| 8.4 Create an auth token with `project:releases` and `org:read` scope for source maps (2.5c). | [Sentry > Settings > Auth Tokens] | Done: ____ |
| 8.5 Trigger one test error in production from a signed-in staff session and confirm it appears with the release tag and without an email address or phone number in its message. If a personal value appears, stop and tell an engineer. | | Seen: ____ |
| 8.6 Alert rules in Sentry: new issue in production, issue seen more than 10 times in an hour, and any issue tagged `edge_function` in `paystack-webhook`, `process-events`, `zoom-webhook`. Send to your phone (Sentry mobile app push, plus email as the backup). | [Alerts] | Done: ____ |
| 8.7 Uptime monitor (Better Stack, UptimeRobot or Sentry Uptime) with these checks, each alerting your phone by push or phone call, not only email: | | |
| 8.7a `GET https://tarragonhealth.ng/` every 1 minute, expect 200 | | Done: ____ |
| 8.7b `GET https://app.tarragonhealth.ng/api/status` every 1 minute, expect 200 (this is the public liveness probe) | | Done: ____ |
| 8.7c `GET https://app.tarragonhealth.ng/api/health/deep` every 1 minute with the header `x-health-secret: <HEALTH_CHECK_SECRET>`; alert on any non-200 (503 means a check is down: a red page unanswered 10 minutes, a stale cron job, a payment webhook unprocessed for 30 minutes, connections above 90 percent and so on). If the tool can read the body, also warn when `"verdict":"degraded"`. | | Done: ____ |
| 8.7d Edge function liveness is covered by the backlog checks in 8.7c (a stopped function shows up as a growing backlog) and by Sentry. Do not point the monitor at the webhook URLs themselves. | | |
| 8.8 Who receives the alerts, and who is the backup? (Open decision 3 in the plan.) | | Primary: ____  Backup: ____ |
| 8.9 Run the platform-outage runbook tabletop once with the alert actually firing (`docs/PLATFORM_OUTAGE_RUNBOOK.md`). | | Date: ____ |

What `/api/health/deep` returns: `verdict` (ok, degraded, down) and a list of named checks, each with a short plain detail (counts and ages only, never a patient identifier). The thresholds are versioned configuration, key `ops.health_thresholds`, still PROPOSED until you confirm them.

## 9. Service targets to sign

Engineering has put the plan's service targets into versioned configuration as PROPOSED (`packages/shared/src/proposed-config`, key `ops.service_targets`): a red event reaches an on-call doctor within 60 seconds of grading; a reading is saved and graded within 5 seconds; the next task arrives within 2 seconds; a chart summary opens within 3 seconds; no lost payment confirmation, lab result or notification and no duplicated task. They are NOT signed. The Chief Medical Officer and you confirm or change them by adding a version 2 entry with status `confirmed`. Date signed: ______ By: ______

## 10. Costs to quote

Plan section 5 says to replace the 1,000 naira per Member platform line in the cost model with a real figure. From the pages above: Supabase plan plus compute plus PITR add-on, Vercel plan, Upstash plan, Zoom plan, Resend plan, Sentry plan, uptime monitor. Total per month: ______ . Divide by 5,000 for the Stage B per-Member figure: ______ .

## 11. Evidence

Save the screenshots in `docs/evidence/hosting-baseline-2026-10/` (create the folder) named `1.4-supabase-backups.png` and so on, and commit them with this checklist. Do not paste keys, tokens or DSN secrets into the file.
