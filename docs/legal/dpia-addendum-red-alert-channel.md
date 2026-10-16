# DPIA addendum: red-alert notification channel and the patient's answers (DRAFT)

*Draft for the Data Protection Officer to review and sign. **NOT SIGNED.** Nothing here has been approved by the DPO or counsel, and
no retention figure below is final. Prepared for OQ-335 (raised by the critical-notifications build, answered 2026-10-16: write the
addendum, the DPO signs). Extends `docs/legal/dpia-health-data-processing.md`.*

**Date drafted:** 16 October 2026
**Scope:** (1) the red-alert notification channel: the neutral push, email and in-app notices a patient receives when a red alert is
raised, the 30 minute unconfirmed-alert rule and the clinician call task it can open; (2) `red_care_responses`, the patient's recorded
answer to "have you sought care?"; (3) the notice to a patient's own emergency contact.

## 1. What is processed

| Item | What it holds | Who sees it |
|---|---|---|
| Red-alert notices (`notifications`, `notification_delivery_events`) | A generic notice. By design (INV-07) it names no condition, reading or result. It records that a notice was queued, sent, delivered, opened or failed, on which channel. | The patient; operations and delivery tooling (tied access) |
| Unconfirmed-alert watch (`red_alert_watch`) and clinician call task | That a red alert for this patient went 30 minutes without the patient's own confirmation, and a task to phone them. Confirmation means the patient opened a notice, acknowledged the guidance or replied. A delivered push receipt does NOT count (decision OQ-329). | On-call clinician and the Chief Medical Officer |
| `red_care_responses` | The patient's answer: "I sought care" or "I could not get care", the time, and the alert it relates to. Health data about care-seeking behaviour. Append only. | The patient; the paged on-call clinician and the CMO while the alert is open. A Free-plan answer is stored but never shown to a clinician. |
| Emergency-contact notice | Push, in-app or email to a contact who is also a Tarragon account, saying only "Please call {patient name} now." No SMS exists for this (decision OQ-333). | The contact only |

## 2. Lawful basis and necessity (for the DPO to confirm)

- Basis proposed: vital interests and provision of health care under the patient's consented membership terms; the emergency-contact
  notice rests on the patient's recorded consent, re-checked each time a copy is sent.
- Necessity: the answer lets the on-call clinician see, before calling, whether the patient already has care or cannot reach it. Without
  it the clinician may spend the first minutes of a red alert on the wrong question.
- Minimisation: notices carry no clinical content; the answer is a two-value choice plus time; the clinician view of an answer shows no
  patient identity beyond the case they are already handling.

## 3. Risks and mitigations

| Risk | Mitigation in the build |
|---|---|
| A notice on a lock screen or shared phone reveals a condition | Generic wording only, INV-07 lint enforced in tests; discreet-mode envelope for push. |
| A silent or unread push is wrongly treated as seen | Delivered receipt no longer confirms; only the patient's own action does (OQ-329). |
| The patient's answer is used to stop paging | It never acknowledges a page or stops the ladder; only a clinician acknowledgement does. |
| A contact is told something they are not entitled to know | Consent re-checked per copy; matched only through a confirmed phone and only when exactly one account has it; content-free text; no SMS. |
| Answers are edited after the fact | Append only, enforced by the database. |

## 4. Retention (class proposed: `review`)

- `red_care_responses`: proposed class **review**. It is health data about seeking care. It is kept with the clinical record of the alert it
  belongs to (alert records are never deleted absent an explicit future policy) and reviewed by the DPO at 24 months for a shorter
  period or de-identification. **The DPO decides the final figure; nothing deletes these rows today.**
- Red-alert notices and delivery events: follow the communications row of `data_retention_policies` (currently no deletion). SR3
  proposes 13 months for operational delivery records with clinical-trail notices exempt; not adopted until the DPO signs.
- Emergency-contact notices: the notice carries only a name and a fixed sentence; proposed same class as other notices.
- Webhook inbox rows (related, OQ-341): rejected rows 30 days; verified raw bodies 90 days, then customer emails redacted. The purge is
  built and OFF until the DPO signs.

## 5. Open points for the DPO

1. Confirm the lawful basis wording and the retention class `review` for `red_care_responses`, and the review period.
2. Confirm whether an emergency-contact notice needs a separate consent screen beyond the existing contact consent.
3. Confirm the transfer position for Expo (push) and Resend (email) as notice processors, given the notices are content-free.

## 6. Sign-off

DPO name: ____________________  Decision: ____________________  Date: ____________________

*Status: unsigned draft.*
