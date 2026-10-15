# Canary external heartbeat: register a free outside monitor (OQ-316)

**Why.** The clinical chain canary runs every 30 minutes and raises an incident inside the database when it stops. If the database
itself stops, that watcher stops with it. An outside monitor that polls one public address is the independent second watcher.

**The address.** `https://app.tarragonhealth.ng/api/status/canary` (the app host; use the host your production web app is served on).

**What it returns.** Only two fields, no patient data, no timestamp, no secret:

- Fresh: HTTP 200 and `{"ok":true,"age_bucket":"under_1h"}`
- Quiet or unreadable: HTTP 503 and `{"ok":false,"age_bucket":"3h_to_24h"}` (or `never`, `1h_to_3h`, `over_24h`, `unknown`)
- Too many requests from one address: HTTP 429 (rate limit 30 a minute; a monitor polling every 5 minutes never reaches it)

"Quiet" means no finished canary run for the `staleAfterMinutes` line in the active `chain_canary_config` (100 minutes today).

## Register it (about 5 minutes, free plan is enough)

Either service works. Pick one; do not use both.

**UptimeRobot (free plan, 5 minute checks)**
1. Sign up at uptimerobot.com with the founder's email and confirm it.
2. Dashboard, **Add New Monitor**. Monitor type **HTTP(s)**.
3. Friendly name: `Tarragon canary heartbeat`. URL: the address above. Monitoring interval: **5 minutes**.
4. Under alert contacts, tick the founder's email (add a phone number or Telegram contact if you want it louder).
5. Save. The monitor turns green on its first check.

**Better Stack (free plan, 3 minute checks)**
1. Sign up at betterstack.com and open **Uptime**, then **Create monitor**.
2. Monitor type **Status code**, URL: the address above, check every **3 minutes**, expect status **200**.
3. Add the founder's email as the on-call contact. Save.

**Settings that matter on either service**
- Alert when the status is not 200, after **2 failed checks in a row** (avoids a single blip).
- Do not add any header, cookie or token: the address is public by design and needs none.
- Do not put the address, a screenshot of it or the monitor page in any patient-facing place.

## When it alerts

1. Open the address in a browser. If it says `never` or `over_24h`, the canary has not run for a long time.
2. Open `/admin/ops/chain-health` (needs admin sign-in). Check the last canary result and any open incident.
3. If the whole app is down, follow `docs/PLATFORM_OUTAGE_RUNBOOK.md`. If only the canary is quiet, check the `chain-canary` cron job
   (minutes 11 and 41 of the hour) and that `process-events` is deployed, per `docs/design/S11-S15-p1-chain-closeout.md`.
4. A 503 with `unknown` means the web app could not read the database: treat it as an outage until proven otherwise.

## What this does not do

It does not tell you the canary passed or failed, only that it is still running. A failing canary raises its own in-app incident.
