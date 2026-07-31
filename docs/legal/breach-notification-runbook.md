# Data Breach Notification Runbook

*Operational runbook, not a legal filing. The Nigeria Data Protection Act 2023 requires notifying the Nigeria Data Protection Commission (NDPC) within 72 hours of becoming aware of a personal data breach that is likely to result in a risk to a data subject's rights — this document is what an on-call person actually does in that window, and `/admin/settings/data-breach-incidents` is where the resulting record lives. Draft for legal review — the exact NDPC notification form/portal and the patient-notification threshold are marked below as counsel items, same discipline as `docs/legal/cover-memo-to-counsel.md`.*

## What counts as a reportable incident

A "personal data breach" is any confirmed or reasonably suspected unauthorised access to, disclosure of, loss of, or destruction of personal data we hold — not only a technical hack. On this platform, the categories most likely to trigger this runbook are:

- A live RLS/authorization bug that let one patient, partner, or organisation read another's data (this codebase's own history has real examples — see e.g. the 2026-07-29 `is_org_staff` finding, the 2026-07-27 `lab_partner`/`pharmacist` cross-tenant read, and the 2026-07-30 wallet-compliance work referenced in `cover-memo-to-counsel.md`).
- A leaked or compromised credential (a service-role key, an admin password, a Supabase project token) that could have been used to read patient data.
- A partner organisation (a lab, pharmacy, employer, or HMO) reporting that data we sent them was mishandled or exposed on their end.
- A lost or stolen device belonging to a clinician or coordinator with cached patient data.
- A misconfigured storage bucket or export that made clinical documents (lab results, vaccination certificates) briefly public.

**When in doubt, open an incident.** A false alarm closed as "contained, no notification needed" costs an hour; a real breach never opened costs the company's ability to meet the 72-hour clock at all.

## The 72-hour clock

The clock starts at **the moment TarragonHealth becomes aware** of the incident — not when it happened, and not when the investigation finishes. "Aware" means a person at TarragonHealth has a reasonable basis to believe a breach occurred, even before all the facts are confirmed. Log the incident (`/admin/settings/data-breach-incidents` → "New incident") the moment that threshold is crossed, with a real `discovered_at` timestamp — that starts the countdown the admin dashboard displays.

## Roles

- **Whoever notices first** (any employee, contractor, or a report from a partner/patient) — escalates immediately to the founder and to whoever holds the Data Protection Officer role. Do not sit on it to "confirm first."
- **Data Protection Officer** [name/contact — to be appointed and confirmed, see `docs/legal/cover-memo-to-counsel.md`] — owns the incident once logged: drives containment, decides severity, drafts the NDPC notification, decides whether patients need individual notification.
- **Founder / engineering** — technical containment (revoke the credential, patch the RLS gap, take down the exposed export) and produces the facts the DPO needs: what data, how many people, over what window, confirmed or suspected.
- **Outside counsel** — reviewed before the NDPC notification is sent wherever the 72-hour window allows it; if counsel cannot be reached in time, send the notification anyway (a late-but-thorough legal review is not a reason to miss the statutory window) and loop counsel in immediately after.

## The four stages (matches the incident record's status field)

### 1. Open — contain
The moment an incident is logged:
- Stop the bleeding first: revoke a leaked credential, fix a live RLS gap (this codebase's own convention — see any of the RLS-hardening entries in `CLAUDE.md` — is to ship the fix as a migration with a rolled-back-transaction proof, same urgency here), take an exposed resource offline.
- Record what you know and don't yet know in the incident's description — this is a running log, not a one-time summary.
- Assign a severity:
  - **Low** — no sensitive/health data involved, or exposure was to a single trusted party under confidentiality obligations already (e.g. a partner lab that already had legitimate access to that record).
  - **Medium** — sensitive/health data of a small, boundable number of patients, contained quickly, low likelihood of misuse.
  - **High** — sensitive/health data of a larger group, or data that could enable identity theft or financial fraud (a wallet/payment detail), or the exposure window is long or unclear.
  - **Critical** — an active, ongoing exposure; a large number of patients; anything touching a minor's data; anything that reached outside the organisation (e.g. posted publicly, sent to the wrong external party).

### 2. Contained — assess and notify NDPC
Once the immediate exposure is stopped:
- Confirm, as precisely as you can, what categories of data were involved and how many people were affected (`affected_data_categories` and `estimated_affected_patients` on the incident record).
- Draft the NDPC notification. [The exact NDPC notification channel/portal and required form fields are being confirmed with counsel — until then, notify by the most direct channel available (email to the NDPC's published contact) and record what was sent.]
- Send it within the 72-hour window from `discovered_at`, and record `ndpc_notified_at` and a reference the moment it's sent. If you cannot meet 72 hours, send whatever you have — a partial, honestly-caveated notification on time is better than a complete one late.
- Move the incident to **notified**.

### 3. Notified — assess patient notification
Separately from the NDPC notification, decide whether affected patients need to be told directly. [The exact threshold under the Act for when individual notification is required, versus notification to the NDPC alone being sufficient, is a counsel question — until confirmed, default to notifying affected patients directly whenever the incident is Medium severity or above.] If patient notification is needed:
- Never send it over WhatsApp or SMS carrying any specific detail of what was exposed — per this platform's own non-negotiable content rule (`I1`, `notifications.content_class`), that channel never carries anything that could be mistaken for clinical or personally identifying content. Use email or an in-app notification, or a phone call for anyone without reliable digital access.
- Be honest and specific: what was exposed, when, what we've done about it, and what the patient can do (e.g. watch their wallet activity, change a password).
- Record `patients_notified_at`.

### 4. Closed
Once NDPC notification (where required) and patient notification (where required) are both done and containment is verified to hold, close the incident with a final summary and `closed_by`. A closed incident record is never deleted — it is the evidence that the runbook was followed.

## After the incident
Every closed incident should produce at least one concrete follow-up: a migration, a test, or a process change that makes the same class of exposure structurally harder — matching the discipline this codebase already applies to every RLS finding in its own history (fix the function, prove it with a rolled-back-transaction test, never just patch the one instance). Log that follow-up somewhere durable (a CLAUDE.md entry or a tracked task), not only in the closed incident's own notes.

## Contact
Questions about this runbook: privacy@tarragonhealth.ng.
