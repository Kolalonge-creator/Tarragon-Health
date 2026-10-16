# Tarragon Health — Platform Outage Runbook

> The authoritative operational response to an availability/technical incident — the platform, or a
> dependency it needs, is down or degraded. **Not for privacy or data-exposure incidents** — for
> those, use `docs/legal/breach-notification-runbook.md` instead (its 72-hour NDPC clock and
> notification duties don't apply here). If an outage also turns out to involve unauthorized data
> access or exposure, switch to that runbook immediately — the two are not mutually exclusive.
> Recovery-objective targets and the service dependency map this runbook responds to live in
> `docs/BUSINESS_CONTINUITY_DR_SPEC.md`.
>
> Reuses the breach-notification runbook's proven four-stage shape, relabeled for availability
> instead of confidentiality, and its "every closed incident produces a concrete follow-up"
> discipline. Deliberately **not** a six-role incident-command structure (incident commander /
> technical lead / clinical safety lead / ops / comms / recovery / post-incident review) — that's
> sized for an org with departments and a bench to staff those roles; today it's two people at most.

---

## Roles

- **Whoever notices first** — any employee, contractor, or a report from a patient/partner.
  Escalate immediately; don't sit on it to "confirm first."
- **Founder / engineering** — the only other real role today. Technical containment, communication,
  and recovery all fall to the same person/people. When Tarragon has a real ops team, this runbook
  is the place to split that role out — not before.

## The four stages

### 1. Open — detect & contain
- Note how it was detected: `/api/status` reporting a dependency down, a Sentry uptime-monitor
  alert (once activated — see the founder-blocked list in `BUSINESS_CONTINUITY_DR_SPEC.md`), a
  provider status page, or a direct report.
- Contain what can be contained: if it's a code-level issue (a bad deploy, a migration that broke
  something), the fastest safe path is usually a rollback, not a forward fix under pressure.
- Record what's known and not yet known — a running log, not a one-time summary, same discipline as
  the breach runbook.

### 2. Contained — assess & restore
- Identify which dependency is actually down using the service dependency map in
  `BUSINESS_CONTINUITY_DR_SPEC.md` §2 — that tells you what else is affected and whether any action
  is even needed (several dependencies, like ML or WhatsApp, are designed to degrade with zero
  action required).
- Work the fix: provider-side (wait/escalate to their support), infrastructure-side (Vercel/
  Supabase status, redeploy, restart), or code-side (rollback, hotfix on a feature branch — never a
  direct commit to `main`/`main-dev` even under pressure).

### 3. Restored — verify & communicate
- Verify recovery against something real, not a guess: `/api/status` returning `"ok": true`, a
  successful login round-trip, a test write landing in the affected table.
- If the outage was visible to patients/partners for a meaningful window, say so plainly once
  restored — what happened, roughly how long, what to do if something looks wrong now (e.g. "a
  reading you logged during the outage — check it's there, log it again if not").

### 4. Closed
- Close with a final summary once recovery is verified to hold, not just verified once.
- **Every closed incident produces at least one concrete follow-up** — a migration, a test, a config
  change, an addition to §2's dependency map if something behaved differently than documented. Log
  it somewhere durable (a CLAUDE.md entry, a tracked task), not only in the closed incident's own
  notes — same rule as the breach runbook, for the same reason: an incident that doesn't change
  anything structurally will happen again.

---

## External dead-man's switch (OQ-436)

Every watcher of the event bus and paging engine (`sweep_paging_health`, `queue_watchdog`, the reconciler, `paging_heartbeats`)
runs inside Supabase under the same pg_cron and pg_net that failed on 2026-10-14 and 2026-10-15. If that dies, nothing inside
notices. So the platform is also checked from OUTSIDE, two independent ways, both calling one read-only endpoint:

    GET /api/health/deadman      header: x-health-secret: <HEALTH_CHECK_SECRET>   (or Authorization: Bearer <same value>)

It reads `public.deadman_status()` (service_role only) and returns counts and ages only, no patient or staff identifier:
seconds since the `process_events` heartbeat, deliveries due for over 5 minutes and not claimed, dead letters from the last 24 hours, open
sev1/sev2 incidents. Thresholds are the PROPOSED config `ops.deadman_thresholds` (packages/shared/src/proposed-config). Answers
200 for ok or degraded, 503 for down or an unreadable database, 401 for a wrong or missing secret, and 503 "not configured"
when `HEALTH_CHECK_SECRET` is unset (fails closed, reads nothing).

**Layer 1: GitHub Actions** (`.github/workflows/deadman-switch.yml`, every 5 minutes, runs on a GitHub runner). On
unhealthy, non-200, timeout or unreachable it opens or updates ONE issue titled "[dead-man's switch] Tarragon platform status
check failing" with label `incident` (never a duplicate), emails through Resend if configured, and on the next healthy run
comments "Recovered" and closes it. A missing required secret fails the run (red) with an `::error::` line, never a quiet pass.
**Caveat: GitHub cron is best effort.** Runs can start minutes late, can be skipped under load, and schedules are switched off
after 60 days without repository activity. The repository is public, so the issue shows only check names, counts and ages.

**Layer 2: a free third-party HTTP monitor** (UptimeRobot, Better Stack, Checkly or cron-job.org free tier), independent of GitHub:
create an HTTP(s) monitor on `https://<production app host>/api/health/deadman`, interval 1 to 5 minutes, add the request header
`x-health-secret` with the secret value, alert on any non-200 response and on a request timeout, alert to the founder's phone
and email. Optionally add a keyword check that the body contains `"verdict":"ok"` (a degraded answer is 200 and is a warning,
not a page). The same URL and secret also serve the SR1 monitor on `/api/health/deep`.

**When it fires**: treat it as the paging engine being possibly dead. Open the Supabase dashboard (cron job run history,
`process-events` edge function logs), check `select * from paging_heartbeats`, `select public.event_bus_health()` as an admin,
then phone the on-call clinician for any open red case (the in-database path cannot be trusted). Log an `ops_incidents` row
once the database is reachable. Rotating the secret: change `HEALTH_CHECK_SECRET` in Vercel, the GitHub secret and the
third-party monitor together.

---

## Tabletop exercises

A walkthrough to run mentally (or literally, talking through each step) per scenario — **not** a
live fault-injection drill against the production project. None of these should ever be simulated by
actually taking a production dependency down.

| Scenario | Detection | Immediate response | Recovery signal |
|---|---|---|---|
| Cloud outage (Vercel) | `/api/status` unreachable from outside; Vercel status page | Check Vercel's own status page; no code-level action is possible for a hosting-provider outage — communicate and wait | The deployment is reachable again and `/api/status` returns 200 |
| Database issue (Supabase Postgres) | `/api/status`'s Supabase check fails; a Sentry error spike | Check Supabase's status page; **do not attempt a live restore without explicit founder sign-off** (see the destructive-action warning in `BUSINESS_CONTINUITY_DR_SPEC.md` §3) | `/api/status` recovers, plus a manual spot-check read and write against a non-sensitive table |
| Payment-provider outage (Paystack) | A gap in webhook deliveries; the provider's own status page | None required by design — `paystack-webhook/index.ts`'s idempotent insert already tolerates a delayed or duplicate replay once the provider recovers | The webhook backlog drains and transactions catch up |
| WhatsApp/Termii outage | A rise in notification delivery failures | None required by design — Termii is WhatsApp's documented fallback, and no core action ever depends on either succeeding | Delivery rates return to normal |
| ML-service outage | `/api/status`'s ML check reports down | None required by design — every ML caller has a non-ML fallback path (`ml-client.ts`) | `/api/status`'s ML check reports up again |
| Identity/auth outage (Supabase Auth) | Login failures; `/api/status`'s Supabase check | **No code-level fallback exists today** — see the honest gap flagged in `BUSINESS_CONTINUITY_DR_SPEC.md` §2. Response is limited to checking Supabase's status page and waiting | A successful login round-trip |

## Contact

Questions about this runbook: the founder, directly — there's no separate on-call rotation yet.
