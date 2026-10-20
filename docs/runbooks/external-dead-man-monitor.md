# External dead-man monitor for the pager, the task queue and the database (OQ-436, OQ-452)

**Why this exists.** Every watcher we built (`sweep_paging_health`, `queue_watchdog`, the reconciler, the paging and queue heartbeats) runs inside the database under the same pg_cron that broke on 14 October (16:19 to 23:20 UTC) and 15 October (15:01 to 21:23 UTC). A watcher that dies with the thing it watches cannot raise the alarm. The first sev1 appeared 38 minutes into the second outage and the queue ones about four hours in. An outside service that calls one address every minute and phones a named person is the only answer that survives a database or cron outage.

**Status when this was written (2026-10-16): nothing is switched on.** `HEALTH_CHECK_SECRET` was not confirmed as set in production, no outside monitor account exists, and no person is named to receive the alert. Everything below is for a human to do. The agent that wrote this did not set any secret, create any account or call the production address.

## 1. The address

`GET https://app.tarragonhealth.ng/api/health/deep` (use the host the web app is served on) with the secret in a header:

```
x-health-secret: <the value of HEALTH_CHECK_SECRET>
```

`Authorization: Bearer <secret>` also works. **Never put the secret in the address.** Addresses are logged by proxies and monitors.

| Answer | Meaning |
|---|---|
| **200** `{"ok":true,"verdict":"ok","failing":[]}` | Every check below is healthy. This is the only healthy answer. |
| **503** `{"ok":false,"verdict":"degraded"` or `"down","failing":[...]}` | At least one check is not healthy. `failing` lists the names. |
| **503** `{"ok":false,"error":"not configured"}` | The server has no `HEALTH_CHECK_SECRET` (or a value under 24 characters). Nothing is being checked. Fix the variable. |
| **401** | The header is missing or wrong. The monitor's copy of the secret does not match the server's. |
| No answer / timeout | The web app or the platform behind it is down. Treat as an outage. |

The body never carries an age, a count, an id, an error message or patient data: names and verdicts only. Detail for diagnosis lives in `/admin/ops` (admin sign-in) and in the database.

## 2. What it checks, and what each failing name means

| Failing name | What is wrong | First action |
|---|---|---|
| `database_unreachable` | The database did not answer within the time limit. Nothing else can be trusted. | Open the Supabase dashboard; follow `docs/PLATFORM_OUTAGE_RUNBOOK.md`. Phone the on-call clinician for any open case. |
| `deep_health_unreadable` | The heartbeat read failed. Usually the latest migration is not applied yet, or the database is overloaded. | Check `public.platform_deep_health()` exists; check database load. |
| `heartbeat_paging_sweep_pages` | The one-minute page sweep has not run for more than the engine limit (`engine_heartbeat_stale_seconds`, 120). Red-event pages may not be created or escalated. | **Phone the on-call clinician for every open case now.** Check pg_cron (`cron.job_run_details`) and Supabase status. |
| `heartbeat_paging_process_events` | The `process-events` edge function has not reported. Events are not being turned into pages and notifications. | Check the function is deployed from `origin/main-dev` and `PROCESS_EVENTS_SECRET` is set (edge drift job). Phone the on-call clinician for open cases. |
| `heartbeat_paging_reconciler` | The reconciler that catches an unpaged red event is not running. | Same as `sweep_pages`; it runs from the same sweep. |
| `heartbeat_queue_sweep_clinical_tasks` | Tasks past due are not being escalated, lapsed offers are not returning to the pool. | Check the `sweep-clinical-tasks` cron job. |
| `heartbeat_queue_expire_task_claims` | Claims that lapsed are not being released. A task may sit with a clinician who is not working it. | Check the `expire-task-claims` cron job. A missing row (never reported) fails too. |
| `heartbeat_queue_queue_watchdog` | The queue watchdog itself has stopped (limit 25 minutes). The thing that would warn about the two jobs above is down. | Check the `queue-watchdog` cron job. |
| `open_sev1_incident` | At least one sev1 incident is open (patient safety at risk, platform down, confirmed breach, or a sev1 raised by a watcher). **This stays red until the incident is resolved.** | Open `/admin/ops` incidents and work the sev1. Do not mute the monitor to silence it. |
| `chain_canary` | The clinical chain canary (runs every 30 minutes through `process-events`) has been quiet longer than its limit (100 minutes) once a real patient exists. | `docs/runbooks/canary-external-heartbeat.md`. |
| `database_connections`, `overdue_clinical_tasks`, `unacknowledged_red_pages`, `notification_backlog`, `critical_notifications_unopened`, `event_bus_backlog`, `payment_webhook_backlog`, `zoom_webhook_backlog`, `partner_webhook_dead_letters`, `cron_freshness` | The backlog and cron checks from SR1 (`ops.health_thresholds`, still PROPOSED). `unacknowledged_red_pages` fails at 5 minutes (degraded) and 10 (down), lined up with the paging ladder. `cron_freshness` fails when a minute-granular cron job has not succeeded in twice its interval. | See `docs/runbooks/hosting-baseline-checklist.md` section 8 and `docs/PLATFORM_OUTAGE_RUNBOOK.md`. |

**Degraded now returns 503.** Before 2026-10-16 a degraded verdict answered 200 and only `down` answered 503. The monitor now needs only the status code: anything but 200 is an alert. The body still says `degraded` or `down` for a person reading it.

**A sev1 that is already open keeps the monitor red.** The sign-off pack (section 2b) records an open sev1, `red_outreach_task_type_unconfirmed`. The first time the monitor is switched on it will be red until that incident is resolved. That is the intended behaviour, not a fault in the monitor.

## 3. Set it up (about 20 minutes, a human does this)

1. **Create the secret.** `openssl rand -hex 32`. At least 24 characters. Keep it in the founder's password manager.
2. **Set it in production only.** Vercel project `tarragon-health-web`, Production environment variable `HEALTH_CHECK_SECRET`, then redeploy. (`apps/console` and Preview do not need it.) Confirm: `curl -s -o /dev/null -w '%{http_code}' -H "x-health-secret: <secret>" https://app.tarragonhealth.ng/api/health/deep` is `200` or `503`, never `401` and never the `not configured` 503. Run it from your own terminal, not a shared screen.
3. **Create the monitor in an account that is NOT on the same Supabase project or Vercel account.** Any of:
   - **Better Stack Uptime** (free plan): monitor type *HTTP status*, URL as above, request header `x-health-secret`, check every 1 to 3 minutes, expect status `200`, confirm after 2 failed checks. Call or push, not email only.
   - **Cronitor** (HTTP monitor): same address and header; alert integrations to phone.
   - **UptimeRobot**: custom request headers may be a paid-plan feature. **Check the plan page before choosing it.** If the plan cannot send a header, use one of the two above. Never fall back to putting the secret in the address.
   Also keep the existing public checks (`/` and `/api/status`) and the canary heartbeat (`docs/runbooks/canary-external-heartbeat.md`).
4. **Name who is alerted.** A phone that reaches a named person at any hour, plus a deputy. This is the same person as the final fallback in decision S16-S20-10 (someone who phones the on-call clinician and the CMO when a page expires). Primary: ________ Deputy: ________ . An email alone is not enough.
5. **Second watcher on GitHub.** PR #1170 adds `/api/health/deadman` and `.github/workflows/deadman-switch.yml` (every 5 minutes, outside Supabase and Vercel, opens an incident issue). It watches the event pipeline (`process-events` heartbeat, due deliveries, dead letters, open sev1 and sev2). This deep check is the complementary, authenticated one: pager and queue heartbeats, open sev1, the canary and the SR1 backlogs. Use both; they share the secret `HEALTH_CHECK_SECRET`. Do not duplicate the GitHub workflow here.
6. **Test it once.** Temporarily change the monitor's header value to a wrong string and confirm the alert reaches the named phone as a 401; restore it. Then, in a quiet hour, with the CMO's agreement, confirm a deliberately stale heartbeat is seen only on staging (do not stop production cron to test).

## 4. When the monitor alerts

1. Open the address in a browser with the header (or `curl`). Read `failing`.
2. Anything in the paging rows or `database_unreachable`: first **phone the on-call clinician and the CMO** for every open red case. Then diagnose. The automated pager may be down.
3. Use the table in section 2 for the first action. Resolve the cause, not the alert.
4. Record the outage in `/admin/ops` as an incident if none exists (the in-database watchers may be the thing that failed).

## 5. Known limits

- The monitor proves the heartbeats are fresh, not that a page reached a phone. The test page and drill pack (`docs/plans/S16-S20-unified-red-paging-test-pack.md`) prove delivery.
- It reads only the production database through the web app. If the web app is down the monitor reports that, and cannot tell a web outage from a database outage. Section 4 step 2 covers both.
- A heartbeat can be fresh while the job it stands for does the wrong thing; the clinical-chain canary and the backlog checks cover some of that.
- The thresholds in `ops.health_thresholds` are PROPOSED engineering values, not yet confirmed by the founder.
- This route was not called against production when it was written, and its database function was first exercised by CI, not by hand (the production database and the local Docker stack were both unavailable to the author). Call it once yourself after setup (step 2) and read the answer.
