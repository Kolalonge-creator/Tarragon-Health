# Community: operations set-up (secrets, scheduled jobs, checks)

What has to be in place outside the code before Community can be switched on. None of this needs a developer after the first time.

## 1. The overdue-work check (every 10 minutes, round the clock)

It tells the safety reviewers, the moderators and the Chief Medical Officer when a safety item or a queue item has waited too long. Community cannot be
switched on until this check has run successfully in the last 45 minutes (go-live condition `overdue_monitor_running`).

1. In the GitHub repository, open Settings, then Secrets and variables, then Actions, then New repository secret.
2. Add `COMMUNITY_CRON_URL`: the address of the live app, starting with `https://` (for example `https://app.tarragonhealth.ng`). No trailing path.
3. Add `CRON_SECRET`: the same value the live app has as its `CRON_SECRET` environment variable (Vercel project settings). If the app has none, create a long random value and set it in both places.
4. Open Actions, choose "Community overdue-work check", then Run workflow. A green run means the app answered and recorded the run.
5. Look at the Community go-live page: "The overdue-work check has run successfully in the last 45 minutes" should now be met.

If the run shows a yellow warning "Community overdue check is not set up", a secret is missing. If it fails red, read the log: a 401 means the two `CRON_SECRET` values differ.

GitHub can delay a scheduled run by a few minutes and occasionally skips one. The 45 minute window and the thresholds in the configuration allow for that.

## 2. The daily housekeeping (Vercel cron, 03:50 UTC)

Configured in `apps/web/vercel.json`. It removes expired text and pictures, removes stray uploaded files and sends the opt-in weekly note. It needs the same
`CRON_SECRET` on the app. Nothing else to set up.

## 3. Pictures

The private storage bucket `community-images` is created by the migration. Check once that the app has `SUPABASE_SERVICE_ROLE_KEY` set (the picture route and the housekeeping use it).

## 4. People, not code

The Chief Medical Officer signs the emergency and self-harm rules, approves the weight-loss rules and names the crisis owner. Counsel supplies the consent text and the retention period.
Operations names the moderators and safety reviewers, enters their shifts so all 168 weekly hours are covered, and records a passing safety drill.
