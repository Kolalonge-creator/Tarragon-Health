# Pharmacy Network Disruption Runbook

*Operational runbook, not a legal filing. Medication fulfilment on this platform has two paths that need to be told apart when something breaks: a real partner-pharmacy order flow (`pharmacy_orders` — request, accept/decline, price confirm, dispense, deliver or collect) for pharmacies that have onboarded, and the self-arranged path underneath it — a patient can always fill a prescription at any pharmacy of their own choosing and log receipt manually (`medication_receipt_confirmations`, per the collapsed medication-lifecycle model), independent of whether a partner pharmacy is involved at all. This runbook is what an on-call person does when either path stops working for more than one patient at a time. There is no dedicated admin screen for this yet — everything below is checked directly against `pharmacy_orders`/`medication_receipt_confirmations` or through the care-coordinator worklist that already exists.*

## What counts as a reportable incident

- A partner pharmacy's order flow stalls — orders sitting in `requested`/`payment_confirmed`/an accepted state well past their `estimated_fulfilment_at` for more than one patient, or the pharmacist accept/decline/dispense screen itself throwing errors.
- A specific partner pharmacy goes dark (stops responding to new orders, or a patient/pharmacist reports it closed or unreachable) and multiple patients have open orders with it.
- The self-arranged medication-receipt logging path breaks — a patient reports they cannot record "medication received" at all, for any pharmacy, not just a partner one. **This is the more serious of the two**, because unlike a single pharmacy going dark (which the self-arranged model is specifically designed to route around), a broken logging path removes the fallback itself.
- A pattern of `pharmacy_order_dispenses` or `medication_receipt_confirmations` rows simply stopping for an organisation, with no obvious single cause — treat a silent drop the same as an explicit outage report; don't wait for someone to notice their own refill didn't arrive.
- Anything that also looks like a medication-safety issue on top of the availability problem (wrong strength/batch, a dispense flagged and never resolved) — that is `../runbooks/major-clinical-incident-runbook.md` territory (`medication_error` category) run in parallel with this one, not instead of it.

**When in doubt, open an incident.** A false alarm that turns out to be one pharmacy's normal restocking delay costs a few minutes checking `pharmacy_orders`; a real gap in medication access, left unopened, means patients missing doses nobody is chasing on their behalf.

## Severity and detection clock

No statutory clock applies. What matters is telling a genuinely stuck patient apart from ordinary pharmacy turnaround time, because chronic-disease patients (the platform's core wedge) missing doses is a real clinical risk, not just an inconvenience.

- **Low** — a single order, single pharmacy, resolves with a normal nudge or a pharmacist confirming a short delay.
- **Medium** — one partner pharmacy stalled across more than a handful of patients, self-arranged path unaffected.
- **High** — a partner pharmacy is unreachable for more than a day with no patient-facing alternative surfaced, or the self-arranged receipt-logging path is degraded for some patients.
- **Critical** — the self-arranged receipt-logging path is broken platform-wide (removes the fallback that makes any single pharmacy non-critical), or there's early signal of a linked medication-safety issue (see above).

## Roles

- **Whoever notices first** (any employee, contractor, partner pharmacy, or patient report) — escalates immediately. Do not sit on it to "confirm first."
- **Pharmacy Partner Relations contact** [to be appointed/confirmed — no one currently holds a standing relationship-management role across onboarded partner pharmacies; today this defaults to whoever has a contact at the pharmacy in question].
- **Founder / engineering** — confirms scope via `pharmacy_orders`/`medication_receipt_confirmations`, fixes the underlying flow if it's a code problem, coordinates with the partner pharmacy if it's on their end.
- **Care Coordinators** — work the affected patient list once scope is confirmed: refill reminders, helping a patient find an alternative pharmacy for a stuck partner order. Logistics only, per the existing Clinical Tier Ladder scope — a coordinator never adjusts a prescription or resolves a medication-safety flag.

## The four stages

### 1. Detect
A report comes in, or a sweep of `pharmacy_orders` shows a cluster stuck past `estimated_fulfilment_at`, or `medication_receipt_confirmations`/`pharmacy_order_dispenses` volume drops without explanation. Log what's known — which pharmacy (if any), how many patients, since when — as a running note; there's no dedicated incident table for this category yet, so keep it somewhere durable rather than only in chat history.

### 2. Confirm scope
Query `pharmacy_orders` for the affected organisation filtered to orders past their expected fulfilment window, and separately confirm whether `medication_receipt_confirmations` (the self-arranged path) is still working normally. These two answers determine everything downstream — a stuck partner pharmacy with a working self-arranged fallback is a Medium-severity logistics problem; a broken self-arranged path is a High/Critical availability problem regardless of any single pharmacy's status.

### 3. Respond
- If a partner pharmacy's flow is broken (code-side): normal engineering fix, with affected patients still getting the same Care Coordinator follow-up in the meantime.
- If a specific partner pharmacy is dark: tell affected patients **in-app only** — never WhatsApp or SMS with any specific detail of a patient's own order or which pharmacy (same non-negotiable content rule as every other runbook here). The message should be generic and actionable: acknowledge the delay, remind the patient they can fill the prescription at any pharmacy and log it themselves — that's the whole point of the self-arranged model underneath the partner flow.
- Care Coordinators work the affected list directly, including checking in on anyone whose care plan makes a missed dose meaningful (hypertension, diabetes) sooner rather than later.

### 4. Resolve / stand down
Confirm `pharmacy_orders` has returned to normal cycle times and `medication_receipt_confirmations`/`pharmacy_order_dispenses` volume is back to baseline. Note what caused it and what changed.

## After the incident
A structural cause needs a structural follow-up, not just a round of patient nudges: a bug fix with a regression test if the logging or order flow itself broke, or a product/partner-management note if one pharmacy's reliability is a repeat problem. Log the follow-up somewhere durable, not only in this runbook's own notes.

## Contact
Questions about this runbook: the founder, or whoever is on-call for `apps/web` at the time.
