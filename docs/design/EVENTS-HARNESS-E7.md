# Events harness E7: can the sender deliver what the events queue?

Date: 2026-10-30. Branch `worktree-events-harness-notification-delivery`. Part of the events harness in
`docs/design/DASHBOARD-PROGRAMME-CLINICIAN-FIRST.md` (E1 to E4 in PR #1462, E5 and E6 in PR #1465).

## The question

E1 to E6 show that an event queues the right notifications for the right people. E7 asks whether the sender
(`supabase/functions/send-pending-notifications`) can turn each queued push or email into a message. A row it cannot
render fails with "unknown template" or "template has no email rendering", the recipient is never told, and nothing a
person would look at shows it.

## What the proof does

`packages/db/tests/events_notification_delivery_renderable.sql` fires two real events:

- a patient sends a care message containing emergency keywords;
- a critical screening result goes unacknowledged and climbs the ladder at 1x, 2x and 3x the timeout.

It then requires every push or email row they queue to be renderable. A template is renderable if it is on the
`E7_TS_RENDERED` line, or has an active English row in `notification_template_locales` for that channel (the sender's
fallback). It also fails if the events queued no push or email at all, so it cannot pass having checked nothing.

`packages/notifications/src/events-delivery-renderable.test.ts` reads that same line and proves each listed template
really renders from the sender's code map: a push line, a branded email, wording that passes the lint, no payload echo,
and the recipient's own address rule.

## Findings

1. **A patient's emergency-keyword message reached the clinician in the app only.** The alert is severity 4. The active
   rule `message_safety_flag` sends push, whatsapp (read as email) and sms (read as email), so `notify_clinician_alert`
   queued push and email rows with template `care_message_safety_flag`. That template had no renderer in the sender and
   no push or email locale row (only `in_app`), so both rows failed as "unknown template". Fixed in this PR: a
   `TEMPLATE_MAP` entry using the same generic line the ladder uses, and an own-address rule so the email can find the
   clinician. The in-app row was never affected.
2. **The deployed sender is behind `main-dev` on the unacknowledged-alert ladder.** Deployed v122 matches `main-dev`
   in all but two files. `templates.ts` lacks the email rendering for the three ladder templates, and
   `recipient-address.ts` lacks their own-address rule. On the deployed version the ladder's email rung fails with
   "template has no email rendering", so an admin or senior with no push subscription is not reached by email.
   Source already fixes this; it needs a deploy. This is the drift `CLAUDE.md` warns about, caught directly.
3. The ladder's push rung is covered in the database fallback (`push` locale rows), so push worked on v122.

## Needs a decision

Deploy `send-pending-notifications` from this branch once merged. That is a production change, so it was not done here.

## Not covered

This proves rendering and addressing, not delivery. Resend and Expo acceptance, bounce handling, retry and dead-letter
behaviour, quiet hours and the daily cap are tested elsewhere (`delivery.test.ts`, `resend.test.ts`) or not at all.
Booking templates (`appointment_*`) are present in the code map and E6 shows them queued; E7 does not drive them.
