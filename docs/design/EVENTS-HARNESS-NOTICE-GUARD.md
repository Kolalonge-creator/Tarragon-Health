# Events harness: the duplicate in-app guard and admin notice scope

Date: 2026-10-30. Branch `worktree-notice-guard-and-admin-scope`. Resolves the two decisions in `EVENTS-HARNESS-NOTICE-SWEEP.md`
(the sweep of the notice producers), both chosen by the founder: one guard on the table, and organisation-scoped admin notices.

## 1. One guard on the table

About 22 producers write an explicit in-app notice and then a second row on `patient_reminder_channel()`, which falls back to the
inbox. Most patients saw the same notice twice. The trigger `notifications_zz_suppress_duplicate_in_app` (migration
`20261030122555`) marks an in-app row `suppressed` when an identical one (same recipient, template, payload, source) was written in the
same transaction, meaning the same `created_at`. The row is kept so `insert ... returning id` still works, and the web and mobile
inboxes already filter `status not in (failed, suppressed)`.

Proof `events_duplicate_in_app_notice_guard.sql` covers three insert shapes (two statements, two sibling CTEs in one statement, one
`INSERT ... SELECT` of two rows), the cases that must not be suppressed (different payload, template, recipient, source, another
channel, a later transaction), and a real producer: a doctor adding a medicine now gives the patient one visible "prescribed" notice
where the same insert wrote two. Sabotage: disabling the trigger fails section 1.

Trade-offs, plainly: this hides a producer's double write rather than removing it, so the producers still write the extra row (they
are not rewritten). It costs one indexed lookup (`recipient_id, created_at`) per in-app insert. A producer that really means to send two
identical in-app notices to one person in one transaction will get one; none was found.

Not done: the producers themselves, and existing duplicate rows (history, untouched). The CMO-and-admin case (below) is also fixed by
this guard.

## 2. Admin notices stay in the alert's organisation

`escalate_unacknowledged_clinician_alerts` (hop 3) and `escalate_overdue_clinician_alerts` (tier 2) notified every admin on the
platform. In production that sent 130 notices about the real organisation's alerts to the synthetic canary organisation's admin and
25 canary notices to the real admin. Migration `20261030122553` adds `and organisation_id = r.organisation_id` to both, from the live
bodies. The canary reports its own failures through `private.page_incident`, not these ladders, so it does not depend on the old
behaviour.

Proof `events_escalation_admin_notices_scoped.sql`: the alert's own admin is told, another organisation's admin is not, and a person who
is both Chief Medical Officer and admin sees the SLA breach once (two rows are written, one suppressed). Sabotage: removing the filter
from both functions fails section 1.

## Applying

Neither migration is applied by CI. Both were written from live bodies compared by checksum on 2026-10-30
(`escalate_unacknowledged_clinician_alerts` e8a0891c, `escalate_overdue_clinician_alerts` ebe480e5); check those still match before applying.

## Noticed, not changed

Three older proofs fail on my local database with or without these changes (`alert_system_governance_and_ack_escalation`,
`pharmacy_engine_end_to_end`, and the lab proof until the E8 migration was applied there). CI's clean
replay will show whether the first two pass there; the local database had drifted, so I have not confirmed it.
