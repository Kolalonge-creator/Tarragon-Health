# Lab Result Flow Disruption Runbook

*Operational runbook, not a legal filing. Since the 2026-08-03 self-arranged-fulfilment change, Tarragon does not book or pay labs directly — a patient can use any lab, pay the lab themselves, and upload the result (`lab_orders.fulfilment = 'self_arranged'`). That means "the lab is down" is no longer a single point of failure the way a booked-and-billed partner integration would be — but the upload path itself, or a single dominant lab chain many patients happen to use, still can be. This document is what an on-call person actually does when lab results stop flowing at scale. There is no dedicated admin screen for this yet — everything below is checked directly against the database or through the care-coordinator care-gap views described below.*

## What counts as a reportable incident

Not every patient with a late result is an incident — a single self-arranged order sitting unresulted is exactly the everyday risk the `awaiting_result` care gap already exists to catch (see below). This runbook is for something bigger than one patient's own delay:

- The self-arranged upload path itself breaks — patients report they cannot attach a lab document to an order (`lab_orders` upload flow, or the `handle_lab_result_document` trigger that turns an upload into a clinician-review alert stops firing).
- A major lab chain patients commonly use (Synlab Nigeria, Cerba Lancet, Healthtracka, Afriglobal Medicare) is unreachable, closed, or publicly reporting an outage/data incident of its own, and multiple patients are affected at once.
- A spike in `patient_care_gaps` rows with `gap_type = 'awaiting_result'` appears **within days**, concentrated in one organisation or one lab name in the order detail — the 21-day threshold that view uses is deliberately generous for one patient's own pace; a cluster arriving fast is a systemic signal, not individual lateness.
- Any abnormal-result pipeline symptom — a result gets uploaded but no `clinician_alerts`/escalation is ever raised for it. **This is never just a lab-outage footnote** — a silently-dropped abnormal result is the platform's single highest-priority failure mode (see CLAUDE.md's Category 2→1 upgrade rule) and should be treated as that incident first, with this runbook run in parallel to establish scope.
- A partner lab that does have a billing relationship (e.g. the Synlab "let us bill it" flow) reports a billing/data-handling problem on its end that could affect patients' ability to get or pay for a result.

**When in doubt, open an incident.** A false alarm that turns out to be one patient's own slow lab costs a few minutes checking a query; a real systemic gap in result flow, left unopened, means patients silently waiting on results nobody is chasing.

## Severity and detection clock

There is no statutory clock here (this is not a data-breach runbook — if what you find turns into a suspected data exposure at a partner lab, switch to `../legal/breach-notification-runbook.md`). The clock that matters is **how fast a systemic gap is told apart from normal noise**, because every day it runs is a day of patients waiting on results nobody is chasing on their behalf.

- **Low** — a single lab, a single patient, resolves with a normal nudge.
- **Medium** — one lab chain affecting a handful of patients across more than a day; the upload flow itself works.
- **High** — the self-arranged upload path is broken for anyone, or a lab used by a meaningful share of an organisation's patients is unreachable for more than a day.
- **Critical** — evidence that an abnormal result was uploaded and never escalated (Category 2→1 failure), or a lab-side data incident.

Check the `awaiting_result` branch of `patient_care_gaps` (`supabase/migrations/20260803125639_awaiting_result_care_gap.sql`) as the first move on any report — it is keyed on "no document uploaded yet" per `lab_orders`, organisation-scoped, so a same-day sweep across organisations tells you immediately whether this is one patient or many.

## Roles

- **Whoever notices first** (any employee, contractor, partner lab, or patient report) — escalates immediately. Do not sit on it to "confirm first" — check the care-gap query, don't wait for a second report before looking.
- **Lab Partner Relations contact** [to be appointed/confirmed — no one currently holds a standing relationship-management role with the labs patients actually use; today this defaults to whoever on the team happens to have a contact at the lab in question].
- **Founder / engineering** — confirms scope via `patient_care_gaps`/`lab_orders`, fixes the upload path if that's what's broken, and drives patient communication if a specific lab is the cause.
- **Care Coordinators** — work the affected patient list once scope is confirmed: check in on self-arranged orders sitting in the gap, help patients find an alternative lab if theirs is genuinely unreachable. This is logistics, not clinical judgement, so it stays within a Care Coordinator's existing scope (see CLAUDE.md's Clinical Tier Ladder).

## The four stages

### 1. Detect
A report comes in, or the `awaiting_result` care gap spikes. Log what's known: which lab (if any), how many patients, since when. This is a running note, not a one-time summary — there is no dedicated incident table for this category yet, so keep the note somewhere durable (a tracked task or a CLAUDE.md follow-up, not just chat history).

### 2. Confirm scope
Run the `patient_care_gaps` `awaiting_result` branch across the affected organisation(s) and compare against the baseline rate. Isolated vs. systemic changes everything downstream: an isolated case gets a normal Care Coordinator nudge; a systemic one gets patient communication and possibly a temporary "avoid this lab" note surfaced wherever the self-arranged order flow tells a patient which labs are commonly used.

### 3. Respond
- If the upload path itself is broken: this is a code fix, follow normal engineering process, not a patient-facing communication problem by itself (though patients affected in the meantime still need the same care-coordinator follow-up as stage 4).
- If a specific lab is the problem: tell affected patients, **in-app notification only** — never WhatsApp or SMS with any specific detail of a patient's own pending result or lab name (same non-negotiable content rule the breach-notification-runbook follows: WhatsApp/SMS never carries anything that could be mistaken for clinical or personally identifying content). The in-app message should be generic and actionable: acknowledge the delay, point the patient at any lab as a normal self-arranged alternative — that's the whole point of the self-arranged model, no lab is a single point of failure for the patient even if it is for a batch of pending orders.
- Care Coordinators work the affected list directly.

### 4. Resolve / stand down
Confirm the `awaiting_result` rate has returned to baseline for the affected organisation(s). Note what caused it and what, if anything, changed as a result.

## After the incident
Every incident here should produce at least one concrete follow-up if the cause was structural — not just "we told the patients." If it was the upload path, that's a bug fix with a regression test. If it was lab concentration risk (too many patients on one chain with no easy fallback), that's worth a product note, not just a one-off nudge campaign. Log the follow-up somewhere durable, not only in this runbook's own notes.

## Contact
Questions about this runbook: the founder, or whoever is on-call for `apps/web` at the time.
