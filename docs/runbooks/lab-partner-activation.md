# Lab partner activation runbook

*Operational runbook for bringing a contracted laboratory onto the platform (S28e, the laboratory equivalent of `pharmacy-activation.md`). It documents the steps; it does not perform them. Every step is a person with the right role recording a fact or pressing a button. Today one laboratory is live (SYNLAB Nigeria, switched on 2026-08-21 as an explicit exception); Cerba Lancet, Healthtracka and Afriglobal Medicare are inactive placeholders and no contract has been invented for any of them. Check the live `lab_providers` rows (`is_active`) before assuming how many are live: the mechanism supports several, the roster may be exactly one. Check each statement against the live screens before relying on it.*

## What "live" means for a laboratory

A laboratory is live when `lab_providers.is_active` is true. From then on it can receive paid lab orders, collection-site bookings and result entry, and the paid-order trigger sends it the patient's name and patient number. That is why a laboratory must never go live carrying a placeholder contact. The patient pays through Tarragon at the contracted price list; the laboratory is billed or paid as the contract says (decision D-06 and the partner-billing machinery). Nothing here changes who pays whom.

**Which laboratory gets an order.** `private.resolve_lab_order_provider` takes the provider the order names, else the provider of the chosen collection facility, else the single active laboratory. With two or more active laboratories and no choice it returns nothing and the order is refused with a request to choose, rather than silently picking a price list. The booking flow lets the patient choose a location. So adding a second laboratory is safe, but check that the booking page really shows the choice before you do.

## Before you start

- You are an administrator with the `partners.labs.manage` permission.
- A signed contract exists with the laboratory, including the **price list** (what the laboratory charges Tarragon per test) and the turnaround it commits to. Do not activate a laboratory on a published retail price list: `lab_providers.cost_basis` is `published_list` until a person has seen a real contracted invoice or rate card.
- You hold the laboratory's accreditation and licence evidence. The expected set is MLSCN registration for the premises, and ISO 15189 or equivalent accreditation where the laboratory has it (competitor and spec research name both; the exact Nigerian requirements are for counsel to confirm, see `docs/legal/questions-for-nigerian-counsel-S83.md`). Do not activate without the registration evidence on file.
- A real contact email for result and order alerts. The database refuses to activate a laboratory whose `contact_email` is a seeded placeholder (`*.example`, `*.example.com`, `*@example.*`): the constraint `lab_providers_active_needs_real_contacts`. A null address means no alert is sent yet; that is allowed but means a paid order reaches nobody, so set a real one.

## Steps

### 1. Add the laboratory and its licence

1. Admin, Settings, Partners, Labs (`/admin/settings/partners/labs`): add the laboratory with legal name, city and state, a real contact email and phone.
2. In the licence editor record the licence type, number and **expiry date**, and press verify once you have checked the document. The licence badge turns amber inside 30 days of expiry and red when expired. A missing date never suspends anyone but shows as "no expiry date on file", so enter the real date.
3. Leave `is_active` off for now.

### 2. Record where the prices came from

On the laboratory row use the cost-basis editor. Choose `contracted_invoice` **only** if a real invoice or contracted rate card has been seen; the database refuses it without a verifier and a note. Otherwise leave `published_list`, which is the honest default and keeps the "never sell a test below what the laboratory charges" triggers meaningful. Then load the laboratory's test catalogue and per-test prices (`lab_tests` with this provider) from the contract. A test the laboratory does not offer must not be in the catalogue: an order for it is refused rather than taking the patient's money.

### 3. Add collection sites

Add each collection site or facility (name, address, state, opening times) and mark it active only once someone has confirmed it exists and takes walk-in or booked collections. The booking flow offers only active sites of an active laboratory. Check the state is spelled as in the service regions list so the region gate (`region_service_available`) lets patients in that state book.

### 4. Create the laboratory login

1. Admin, Settings, Members: create a login with the role **Lab partner** for a named person at the laboratory. No shared logins: results and specimen status are entered under a person.
2. On the laboratory row, **Link an existing lab_partner login** to the laboratory. This writes the link through `admin_link_lab_partner`.
3. Sign in as that user once and confirm they reach the laboratory area and see only their own laboratory's worklist (empty at first).

### 5. Rehearse end to end with test accounts only

With a test patient and the laboratory's test login: order a test, pay in test mode, see the order on the laboratory worklist, move it through specimen received and result entry, and confirm the patient's result goes through the held-result and doctor-review path before release. Check the contact email actually receives the order alert. Do not use a real patient for the rehearsal. Record who ran it and when, as the results-flow test.

### 6. Attest and activate

1. At Admin, Go-live, the `lab_booking_enabled` guard lists its conditions: the laboratory is an active partner, it has at least one active collection site, and the results flow has been tested (attested by a person: name who ran step 5 and when, at least 10 characters). As of S37 this guard documents readiness but does not block lab ordering by itself; ordering is stopped by deactivating the laboratory (`docs/runbooks/stage-a-pilot.md`). Check `/admin/go-live` for whether that has changed.
2. Switch the laboratory active on its row. The contact-email check runs here; if it refuses, fix the address, do not remove the check.
3. Place one real order only after the founder agrees, and watch it through.

### 7. After activation

- Open Admin, Partner quality (`/admin/partner-quality`): the nightly check scores turnaround against the target (72 hours, PROPOSED, CMO owns it), complaints and licence. For a laboratory a serious breach can still pause it from NEW work by rule; an expired licence cannot be reinstated until it is renewed. This is different from a pharmacy, where a breach is only a suggestion for staff (S28e).
- Re-verify the laboratory at each licence expiry and never more than 12 months apart (CMO decision, 2026-10-07). A stale check shows as a notice to staff; a person decides any pause.
- Know the outage steps in `docs/runbooks/lab-outage-runbook.md`.

## Stopping a laboratory

Deactivate it on its row, or pause it from new work at Partner quality with a written reason. Orders already placed stay with it. If it was the only active laboratory, lab ordering stops; say so to patients before you do it.

## What this runbook deliberately does not cover

Contract terms, partner-side billing and settlement, home sample collection and phlebotomist assignment, and any second laboratory's price-list routing beyond the single-active fallback. Each needs a founder decision or its own build.
