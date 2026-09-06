# Video Platform Failure Runbook

*Operational runbook, not a legal filing. Every patient-facing video consult on this platform runs through Zoom — `video_consultations` covers both the Level 4 pre-referral triage call (tied to an `escalation`) and the Level 5 post-referral specialist telemedicine consult (tied to a `specialist_referral`), created via Server-to-Server OAuth in `apps/web/src/lib/zoom/client.ts`. That client already fails gracefully — `isZoomConfigured()` and a never-throw `{ok, data|error}` contract mean a Zoom problem surfaces as a clean error rather than crashing anything — but "the code doesn't crash" is not the same as "the patient still gets seen," and that's what this runbook covers. There is no dedicated admin screen for this yet — everything below is checked directly against `video_consultations`/`zoom_webhook_events` or through the escalation/referral worklists that already exist.*

## What counts as a reportable incident

- Zoom itself is down or degraded (check Zoom's own status page) and meeting creation or join is failing for more than one patient/clinician at once.
- `video_consultations` rows are getting stuck in `scheduled` past their `scheduled_at` time without moving to `started`, across more than one patient — a sign that meetings aren't actually connecting even if the API calls that created them succeeded.
- `zoom_webhook_events` deliveries stop arriving or start failing signature verification (`apps/web/src/lib/zoom/webhook-signature.ts`) — this breaks the platform's own record of what happened in a consult (start/end times), independent of whether the call itself worked.
- Zoom credentials expire, get revoked, or are misconfigured (`isZoomConfigured()` starts returning false) — this is a total outage for new meetings, not a degradation, since there is currently no non-Zoom video alternative.
- A pattern of `no_show`/`cancelled` status on `video_consultations` that's plausibly caused by the platform side (broken join links) rather than genuine patient no-shows.

**When in doubt, open an incident.** A false alarm that turns out to be one patient's own connectivity problem costs a few minutes checking `video_consultations`; a real platform-side outage, left unopened, means Level 4 triage calls and Level 5 specialist consults silently not happening.

## Severity and detection clock

No statutory clock applies. What matters is how fast a platform-side problem is told apart from one patient's own connection, because a missed Level 4 triage call delays the very decision (does this escalation need a referral at all) that call exists to make.

- **Low** — a single patient/clinician connectivity issue, not Zoom or the platform's own integration.
- **Medium** — Zoom itself is degraded per its status page, small number of consults affected, expected to self-resolve.
- **High** — `video_consultations` rows are stuck across multiple patients, or webhook delivery has stopped (losing the record of what happened even if calls are still connecting).
- **Critical** — Zoom credentials are invalid/expired (`isZoomConfigured()` false) — no new meetings can be created for anyone, and there is currently no alternative video channel.

## Roles

- **Whoever notices first** (any employee, contractor, clinician, or patient report) — escalates immediately. Do not sit on it to "confirm first."
- **Video/Telehealth Platform Lead** [to be appointed/confirmed — no one currently holds a standing relationship with Zoom (billing, credential rotation, support escalation) beyond whoever set up the Server-to-Server OAuth app].
- **Founder / engineering** — confirms scope via `video_consultations`/`zoom_webhook_events`, checks Zoom's own status page, rotates/fixes credentials if that's the cause, and is the only one who can currently restore the video channel (no fallback video provider exists).
- **Care Coordinators / clinicians with an affected consult** — contact the patient directly to reschedule, or fall back to a masked phone call (`apps/web/src/lib/masked-calls/`, Twilio Proxy — audio only, not a video substitute, but a real existing channel for care-coordination or clinical follow-up contexts) rather than leaving the patient without any contact at all.

## The four stages

### 1. Detect
A report comes in, Zoom's status page shows an incident, or a sweep of `video_consultations` shows a cluster stuck in `scheduled` past their time. Log what's known as a running note — there's no dedicated incident table for this category yet, so keep it somewhere durable rather than only in chat history.

### 2. Confirm scope
Check `isZoomConfigured()`'s effective state (are credentials valid right now), query `video_consultations` for stuck rows across the affected window, and check `zoom_webhook_events` for a gap in deliveries. This tells you whether it's total (no meetings can be created at all) or partial (meetings create fine but something downstream — webhooks, join reliability — is off).

### 3. Respond
- If Zoom is down platform-wide: every clinician with an affected consult reschedules directly with the patient, or uses a masked phone call as a stopgap for anything that can be handled by voice rather than video. This is a real limitation worth naming plainly rather than pretending video has a seamless fallback — it doesn't yet.
- Patient communication about the disruption itself goes **in-app only** — never WhatsApp or SMS with any specific detail of a patient's own upcoming consult (same non-negotiable content rule as every other runbook here).
- If it's a credential problem: rotate/restore credentials, this is a straightforward fix once identified.
- If it's a webhook-only problem (calls still connect, but the record of what happened is incomplete): lower urgency than a connection failure, but still worth fixing promptly since `started_at`/`ended_at` feed the platform's own record of care delivered.

### 4. Resolve / stand down
Confirm new `video_consultations` are moving from `scheduled` to `started`/`completed` normally and `zoom_webhook_events` deliveries have resumed. Note what caused it and what changed.

## After the incident
If this was a credential-expiry or configuration problem, the follow-up is a monitoring/renewal process so it doesn't silently recur — not just a one-off fix. If it happens more than once, the lack of a non-Zoom fallback for anything currently gated to video-only stops being an acceptable gap and becomes a real product question worth raising with the founder. Log the follow-up somewhere durable, not only in this runbook's own notes.

## Contact
Questions about this runbook: the founder, or whoever is on-call for `apps/web` at the time.
