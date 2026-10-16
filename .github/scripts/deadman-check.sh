#!/usr/bin/env bash
# OQ-436 external dead-man's switch. Runs on a GitHub-hosted runner, outside Supabase and Vercel.
#
# Calls GET $DEADMAN_STATUS_URL with the shared secret. Healthy = HTTP 200 with verdict ok or degraded. Anything else
# (non-200, unreachable, timeout, unparseable body, verdict down) is UNHEALTHY and opens or updates ONE GitHub issue labelled
# "incident". When healthy again the issue gets a comment and is closed. Optional Resend email on open and on recovery.
#
# Required env: DEADMAN_STATUS_URL, HEALTH_CHECK_SECRET, GH_TOKEN, GITHUB_REPOSITORY.
# Optional env: RESEND_API_KEY, DEADMAN_EMAIL_TO, DEADMAN_EMAIL_FROM (all three or the email step is skipped with a notice).
# A missing REQUIRED value fails the run loudly (red run, GitHub emails the repo admins on a failed scheduled workflow).
# This repository is PUBLIC: the issue carries check names, counts and ages only. Never the URL, never a secret.
set -uo pipefail

TITLE="[dead-man's switch] Tarragon platform status check failing"
LABEL="incident"

missing=0
for v in DEADMAN_STATUS_URL HEALTH_CHECK_SECRET GH_TOKEN GITHUB_REPOSITORY; do
  if [ -z "${!v:-}" ]; then
    echo "::error::Required secret or variable ${v} is not set. The dead-man's switch is NOT watching the platform. See docs/PLATFORM_OUTAGE_RUNBOOK.md."
    missing=1
  fi
done
[ "$missing" -eq 0 ] || exit 2

case "$DEADMAN_STATUS_URL" in
  https://*/api/health/deadman) ;;
  *) echo "::error::DEADMAN_STATUS_URL must be an https URL ending in /api/health/deadman"; exit 2 ;;
esac

body_file="$(mktemp)"
err_file="$(mktemp)"
http_code="$(curl -sS -o "$body_file" -w '%{http_code}' --max-time 15 --retry 1 --retry-delay 3 --retry-all-errors \
  -H "x-health-secret: ${HEALTH_CHECK_SECRET}" "$DEADMAN_STATUS_URL" 2>"$err_file")" || http_code="000"
[ "$http_code" = "000" ] && echo "curl error: $(head -c 300 "$err_file")"
rm -f "$err_file"

unhealthy=0
reason=""
summary=""
if [ "$http_code" = "000" ]; then
  unhealthy=1; reason="endpoint unreachable (no HTTP response within 15 seconds, after one retry)"
elif { [ "$http_code" = "401" ] || [ "$http_code" = "503" ]; } && ! jq -e '.verdict' "$body_file" >/dev/null 2>&1; then
  unhealthy=1; reason="HTTP ${http_code} with no verdict (secret mismatch, secret not configured on the server, or the app is down)"
elif [ "$http_code" != "200" ] && [ "$http_code" != "503" ]; then
  unhealthy=1; reason="unexpected HTTP ${http_code}"
else
  verdict="$(jq -r '.verdict // empty' "$body_file" 2>/dev/null)"
  summary="$(jq -r '(.checks // [])[] | "- " + .name + ": " + .verdict + " (" + .detail + ")"' "$body_file" 2>/dev/null)"
  case "$verdict" in
    ok) ;;
    degraded) echo "::warning::Platform status is degraded (still reachable)."; echo "$summary" ;;
    down) unhealthy=1; reason="verdict down (HTTP ${http_code})" ;;
    *) unhealthy=1; reason="HTTP ${http_code} with an unreadable or unknown verdict" ;;
  esac
fi
rm -f "$body_file"

now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
gh label create "$LABEL" --color B60205 --description "Platform incident" >/dev/null 2>&1 || true  # already exists is fine
# List by label (not --search: the search index lags and would let duplicates through) and match the exact title.
lookup_failed=0
existing="$(gh issue list --repo "$GITHUB_REPOSITORY" --label "$LABEL" --state open --limit 100 --json number,title \
  --jq "[.[] | select(.title == \"$TITLE\")][0].number // empty")" || { lookup_failed=1; existing=""; echo "::error::Could not list open incident issues (GitHub API error); will not risk a duplicate."; }

send_email() { # $1 subject, $2 text
  if [ -z "${RESEND_API_KEY:-}" ] || [ -z "${DEADMAN_EMAIL_TO:-}" ] || [ -z "${DEADMAN_EMAIL_FROM:-}" ]; then
    echo "::notice::Email not sent: RESEND_API_KEY, DEADMAN_EMAIL_TO and DEADMAN_EMAIL_FROM are not all set (email is optional)."
    return 0
  fi
  payload="$(jq -n --arg from "$DEADMAN_EMAIL_FROM" --arg to "$DEADMAN_EMAIL_TO" --arg s "$1" --arg t "$2" \
    '{from: $from, to: ($to | split(",") | map(gsub("^\\s+|\\s+$"; ""))), subject: $s, text: $t}')"
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -X POST https://api.resend.com/emails \
    -H "Authorization: Bearer ${RESEND_API_KEY}" -H "Content-Type: application/json" -d "$payload" 2>/dev/null)" || code="000"
  case "$code" in
    2*) echo "Email sent." ;;
    *) echo "::warning::Resend email failed with HTTP ${code} (the GitHub issue is still the record)." ;;
  esac
}

if [ "$unhealthy" -eq 1 ]; then
  echo "::error::Platform status check UNHEALTHY: ${reason}"
  issue_body="The external dead-man's switch (.github/workflows/deadman-switch.yml) found the platform unhealthy.

- Last checked: ${now}
- Reason: ${reason}
${summary:+
Checks:
${summary}
}
Runbook: docs/PLATFORM_OUTAGE_RUNBOOK.md (section: External dead-man's switch). This issue updates in place and closes itself when the check passes again. GitHub scheduled runs can be delayed by several minutes."
  if [ "$lookup_failed" -eq 1 ]; then
    : # fail below; opening a possibly duplicate issue is worse than the red run
  elif [ -n "$existing" ]; then
    gh issue edit "$existing" --repo "$GITHUB_REPOSITORY" --body "$issue_body" >/dev/null || { echo "::error::Could not update issue #${existing}"; exit 1; }
    echo "Updated open issue #${existing}."
  else
    url="$(gh issue create --repo "$GITHUB_REPOSITORY" --title "$TITLE" --label "$LABEL" --body "$issue_body")" || { echo "::error::Could not open the incident issue"; exit 1; }
    echo "Opened ${url}"
    send_email "Tarragon platform check FAILING: ${reason}" "${issue_body}

Issue: ${url}"
  fi
  exit 1
fi

if [ "$lookup_failed" -eq 1 ]; then exit 1; fi
if [ "${verdict:-}" = "degraded" ]; then
  echo "Degraded but reachable at ${now}."
  [ -n "$existing" ] && echo "Open issue #${existing} stays open until the status is fully ok."
  exit 0
fi
echo "Platform status check healthy at ${now}."
if [ -n "$existing" ]; then
  gh issue comment "$existing" --repo "$GITHUB_REPOSITORY" --body "Recovered: the status check passed at ${now}. Closing." >/dev/null || { echo "::error::Could not comment on issue #${existing}"; exit 1; }
  gh issue close "$existing" --repo "$GITHUB_REPOSITORY" >/dev/null || { echo "::error::Could not close issue #${existing}"; exit 1; }
  echo "Closed issue #${existing}."
  send_email "Tarragon platform check recovered" "The external dead-man's switch passed at ${now}. Issue #${existing} was closed."
fi
exit 0
