# Employer seat pilot: ops runbook (one page)

Built on the existing employer platform (docs/design/EMP.md). Nothing here is live until the founder switches on the `organisation_membership` module and the signed terms exist. Who does what: **finance** (role finance or admin) runs the money steps; the employer's own admin runs the roster. Never use the service role for these steps: the database checks the signed-in person.

## Before you start (once)
1. Terms: `docs/legal/employer-pilot-terms-DRAFT.md` is signed by counsel's version and the employer, with the Data Processing Addendum attached. Note the version label (for example `terms-v1`).
2. The founder has confirmed the organisation price (admin dashboard, organisation prices) and switched on `organisation_membership` (superadmin: `public.set_platform_module('organisation_membership', true, '<why>')`). Do not switch it on yourself.

## Steps
1. **Create the employer.** Admin, Employers, create. Fill the account, a signed contract, then "go live" once the account is verified (existing flow).
2. **Create the Membership benefit package.** Employer eligibility and benefits page (or admin). It must point at the Membership item. If the module is off the package cannot be created, which is the intended stop.
3. **Roster.** The employer uploads the roster (work email or phone) or shares the join code. Check the upload count with the employer. Tell the employer that employees join with their own account and that joining is voluntary.
4. **Create the pilot.** Admin, Employers, the employer, "Membership seat pilot": benefit package, number of seats, claim window (at most 120 days; it opens when you confirm payment and closes on the end date; the start date is the offer date), the terms version. The price is read from the organisation price and frozen. At most 500 seats; ask the founder for more.
5. **Issue the invoice.** One click. Send it to the employer with bank details, or create a Paystack payment link in the Paystack dashboard for the exact total and send that. Add VAT only as counsel instructs (open: OQ-EMP-6). No seat is granted yet. People who join before payment wait.
6. **Confirm payment.** Only after you have SEEN the money: the bank statement line, or the transaction in the Paystack dashboard (matching amount, NGN, success). Record the method and the bank or Paystack reference (you cannot reuse a reference). The pilot goes active, the invoice is marked paid, and anyone already waiting gets their seat. Pressing it twice with the same reference changes nothing.
7. **Watch uptake.** Ask the employer to open the "Seat pilot" tab on its corporate dashboard, or open the same report as finance. Check weekly: seats claimed, claims waiting for a seat, an ops incident `pilot-no-seat` or `pilot-closed` (someone joined but got no seat: tell the employer, offer a new offer, never grant a seat by hand).
8. **End of window.** Seats not claimed lapse. Open "End pilot", record the review reason. Members keep the year they were given. The employer is not refunded.
9. **End-of-pilot review.** Share the aggregate CSV (the page's Download as CSV). Review use together. Any renewal is a new offer.
10. **Cancel instead** if the employer withdraws before paying: "Cancel pilot" with a reason. The invoice is voided and the employer returns to normal billing for later joiners.

## What NOT to promise or do
- No outcomes, savings, fewer sick days or return on spend. The report describes use only.
- No names, conditions, readings or "who used it". If an employer asks, the answer is no, in writing, and tell the founder.
- Usage figures need a group of at least the platform minimum (20 people at the time of writing); a pilot smaller than about 40 members will show seat counts only. Do not read the report to the employer in a call if a figure shows "withheld": do not work around it, and do not give a smaller group's number from memory.
- No per-employee card payment, no family or dependant seats, no per-head population fee (no capitation), no wallet or credit balance.
- Do not mark an invoice paid before the money is seen. Do not grant or revoke a seat by editing tables.
- Do not flip any module on yourself, and do not switch on the usage figures (`usage_report_enabled`): that waits for counsel and the DPO (OQ-EMP-9). Until then the employer report shows seat counts only.
- A pilot's invoice cannot be voided on its own: cancel the pilot instead. Once a pilot has ended, new joiners get no seat until a new offer is paid (OQ-EMP-10).

## If something looks wrong
- A person has no Membership after payment: check their roster row's status (waiting, no seat left, pilot closed) in the pilot panel counts, then the incident list. Do not insert rows.
- The employer reports a wrong total: the price was frozen at creation. Cancel an unpaid pilot and create a new one; for a paid one, stop and call the founder.
- Suspected leak of an individual through the report: stop sharing it, tell the founder and the DPO, follow `docs/legal/breach-notification-runbook.md` if a person could be identified.
