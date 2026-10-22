# RCPT-1 research note: consent receipts

Read: `docs/design/S42.md`, the S42 consent matrix migration, the S04b-2 receipts migration (`patient_consent_receipts`), the privacy page and its panels, the existing PDF routes (`bp-monthly-summary`, `visit-report`), `private.log_audit`.

Findings
- The legal-document receipts (S04b-2) and the matrix history (S42) are two append-only stores. A "whole consent matrix" receipt needs the matrix current state (`my_consent_matrix` shape) plus the agreements in force (latest accepted row per consent type).
- Nothing audits a patient's own PDF download today; the audited-read helpers are staff-side (`audit_chart_read`). The simplest guarantee that no download is un-audited is one definer function that reads and audits together.
- `profiles.full_name` can be null in fixtures (the signup trigger creates the row first); the receipt shows no "For" line when it is null.
- Wording status: matrix cells carry `wording_status` (`draft_pending_counsel` or `approved`); agreements carry `consent_versions.is_draft`. Both are surfaced; nothing is inferred.
- A receipt names data types such as reproductive health or mental health. No clinical value is involved, but the page can still reveal a choice if left lying around, so the page says to keep it private and the file name is generic.
- `@react-pdf/renderer` is already used across the app; no dependency was added. Helvetica in react-pdf renders bold weights from the standard font set.
