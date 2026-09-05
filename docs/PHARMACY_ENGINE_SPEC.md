# Pharmacy Engine — Design Spec & Gap Analysis

> **Status: design/reconciliation doc, not a build order.** This reconciles an incoming "Pharmacy
> Engine" spec (§12.1–12.18 below) against what actually exists in the codebase and the live
> `koiplnmbgnqnbywhpjlf` database, and proposes a phased path. **It does not itself authorise
> building the guardrailed pieces — see §3.** Subordinate to `CLAUDE.md`, which remains authoritative
> if the two ever conflict. Written the same way `docs/CLINICAL_NETWORK_SPEC.md` reconciled an
> incoming "Clinical Network" spec — same posture, same discipline: find out what's real before
> anyone reads a numbered spec as a to-do list.
>
> **The single fact that governs almost every line below:** on 2026-08-03 the founder reversed
> Tarragon's role in medication fulfilment — "Tarragon stops routing and billing labs/pharmacies/
> specialists directly" (`worktree-self-arranged-fulfilment`, `20260803132008_medication_collected_
> anywhere.sql`, commit message "keep the record, drop the routing"). That is not an unbuilt Phase
> 2/3 item like the referral-matching engine — it is scope that was **built, shipped, and then
> deliberately un-shipped**. Most of §12.2–12.11 below describes exactly the network/routing/payment/
> delivery machinery that decision turned off. See §1 before reading any further section as a build
> order.
>
> **2026-08-28, first pass — three of Phase 1's four items shipped**, additive to the live
> self-arranged-fulfilment path and touching nothing in §12.2–§12.11's then-guardrailed routing/
> payment/delivery machinery: `medication_dispense_flags` + `pharmacist_flag_dispense()` (§12.13),
> `medication_affordability_reports` (§12.16), `pharmacy_order_dispenses.strength`/`batch_lot`/
> `expiry_date` (§12.14). Full detail in the git history of this doc/branch.
>
> **2026-08-28, second pass — explicit founder ask to fully build the Phase 2 infrastructure too**
> ("full build this infrastructure ... so that when Tarragon start having pharmacy partner it will be
> easier to activate it, initially patient will buy their own meds, but in future this model will be
> used"). This is the fresh, explicit ask §3's guardrail required before touching §12.2–§12.11 — it
> authorises building the machinery, not activating it for a real patient. **What shipped:** the full
> onboarding pipeline (§12.3, `admin_advance_pharmacy_partner_onboarding()`/
> `admin_reject_pharmacy_partner_onboarding()`/`admin_verify_pharmacy_partner_location()`, a real
> `pharmacy_partners.onboarding_status` state machine gating `is_active` via a DB CHECK constraint so
> a partner can no longer be flipped active by skipping verification); optional/non-mandatory stock
> management (§12.6, `pharmacy_medications.stock_status`/`expected_restock_at`/`stock_updated_at`,
> nullable — the standing "must not require pharmacies to load stock" decision is unchanged, this
> just makes the field available to a partner who chooses to use it); pharmacist accept/decline
> (§12.5, `pharmacist_accept_order()`/`pharmacist_decline_order()` — the single biggest gap the
> codebase audit found: nothing before this let a pharmacist confirm or reject an order at all, only
> log a dispense against one); refund tracking (§12.9, `refund_status`/`refund_amount_kobo`/
> `refund_ref` on `pharmacy_orders`, a partial-refund-capable `refundTransaction()`, and
> `/api/cron/pharmacy-order-refunds` mirroring the existing `video-visit-refunds` pattern); the
> missing catalogue-creation UI (§12.2/§12.3 — confirmed nothing in the app could ever create a
> `pharmacy_medications` row before this, admin-only, matching existing RLS); a delivery fee field
> and generic/brand substitution fields (§12.7). **Deliberately still not done, and still gated:**
> populating any real partner's data or flipping a real `pharmacy_partners.is_active` to `true`, or
> re-mounting the unmounted `PharmacyCatalogue`/`PharmacyOrdersList` components for real patients —
> that remains a separate, later go-live decision, per §3 below (revised) and CLAUDE.md's Definition
> of Done ("app/web is the interface... WhatsApp/SMS is notifications, never required" — the same
> "build the pipe, don't turn on the tap" posture). Proven end-to-end against a throwaway test
> partner, never a real one, in `packages/db/tests/pharmacy_engine_end_to_end.sql` — prescription →
> order → payment → pharmacist accept → dispense → patient receipt → `patient_timeline`, plus the
> decline → refund-flagged path, all pass. One real bug was found and fixed in the process: the
> onboarding RPC's `is_active=true` write briefly violated its own new CHECK constraint (two separate
> UPDATEs racing the same invariant) — caught by the dry run before it ever reached production, fixed
> in the same pass (`fix_pharmacy_partner_onboarding_advance_update_order`).

## 0. What this document is

A "Pharmacy Engine" spec (§12.1–12.18, reproduced in §6) was handed in describing the medication
journey end to end: a verified pharmacy network with onboarding, prescription transmission to a
selected/assigned pharmacy, pharmacy acceptance with stock/price checks, patient pharmacy selection,
payment, a dispensing→delivery/collection pipeline, a pharmacist workspace with intervention/flagging,
a dispensing record, a distinct "medication received" event, a cost-affordability signal, and a refill
loop — all wired together end to end.

Two things needed to happen before this could turn into a build plan: (1) find out what already
exists — a full, real schema for almost every piece, it turns out, most of it dated "Phase 8/8a" in
its own migration comments — and (2) find out why so much of that real schema has zero live rows on
production today. Both are below. The short version: nothing here is a blank slate, and nothing here
is simply "not built yet" either — it's a deliberately paused build, and re-starting it is a founder
decision, not an engineering one.

## 1. How this fits the business, and the framing risk to watch

Care Coordination (`CLAUDE.md` "The Business", category 3) explicitly names "pharmacy network" as a
core platform layer, and the chronic-disease wedge (category 1) lives and dies on medication
adherence — so a real pharmacy engine matters to the business. That's not in question.

**The framing risk:** §12.1's pipeline — clinical decision → prescription → **pharmacy network → stock/
price → patient choice → payment → dispensing → delivery/collection** → medication received →
adherence → clinical review — reads as Tarragon operating a medication marketplace: verifying and
onboarding pharmacies, showing patients a price-compared list of participating pharmacies, taking the
payment, and tracking a partner's dispensing/delivery pipeline as its own operational data. That is
**exactly** the model the founder had built (Care Coordination Sprint/Phase 8, commit history from
2026-07-05 through 2026-07-21) and then reversed on 2026-08-03. The reversal's own migration comment
states the reasoning plainly: *"Tarragon has no contracted pharmacy, and `pharmacy_medications` has 0
rows, so the catalogue could not fulfil anything even before this... Only the ordering/routing does
[need to go]."* The same day's marketing sweep (`docs/CLAUDE_SPRINT_HISTORY_ARCHIVE.md`, 2026-08-03
entry, referenced again in the 2026-08-04 entry `CLAUDE.md` itself carries) replaced every "BOOK &
PAY" / "trusted partner pharmacy" claim across the site with "YOU PAY THE LAB" / self-arranged
language — this is a real, cross-cutting, still-current positioning decision, not a stale one-off.

The reconciliation that avoids re-opening a closed decision: **separate "the medication record,
which Tarragon owns end to end" from "the fulfilment network, which Tarragon does not operate."**
Prescribing, dose/schedule tracking, refill reminders, the missed-dose escalation ladder, medication
reviews, drug-class lab monitoring, and — as of 2026-08-27 — a genuine "patient received their
medication" event are all real, live, and **do not need a pharmacy partner to exist.** The network/
routing/payment/delivery half of §12 is real, tested, schema-complete infrastructure sitting behind a
switch the founder turned off on purpose, kept (not deleted) specifically so it can be turned back on
once a real partner is contracted — see the "keep the record, drop the routing" framing above.

**Corrected 2026-08-28 — that switch is now genuinely easier to turn on.** The founder explicitly
asked for the *infrastructure* behind §12.2–§12.11 to be fully built ahead of a real partner
(quoted in full in the status block above), which is a different thing from asking for the reversal
itself to be undone: the *activation* gate — a real `pharmacy_partners` row with real data, its
`is_active` flipped true, `PharmacyCatalogue`/`PharmacyOrdersList` re-mounted for real patients — is
untouched and still requires its own separate go-live decision. What changed is that the pipeline
those switches would flip on is no longer a stub: onboarding, acceptance/decline, and refund
handling are now real, DB-enforced, end-to-end-tested machinery (§3, revised, has the current
guardrail).

## 2. Section-by-section reconciliation

Legend: 🟢 built and live · 🟡 schema-complete but dormant / partially built · 🔴 not built ·
⚠️ guardrail — do not build without an explicit founder ask

All row counts below are live, queried against `koiplnmbgnqnbywhpjlf` while writing this doc (see
`CLAUDE.md`'s standing lesson: verify against the live database, never trust a past changelog entry).

### 12.1 Purpose (pipeline) — 🟡
The two ends of the pipeline are real and connected: **prescription** (`medications`, prescribing-
authority-gated, order-entry fields added 2026-08-27) and **medication received → adherence → clinical
review** (`medication_receipt_confirmations`, `medication_logs`, the refill-reminder engine,
`medication_reviews`/Annual Health Review). The middle five steps — pharmacy network → stock/price →
patient choice → payment → dispensing → delivery/collection — are schema-present, UI-present, and
switched off, per §1. The patient's actual live path today: clinician prescribes → patient buys the
medicine at any pharmacy of their own choosing, with no Tarragon involvement → patient optionally logs
"I collected it" and optionally confirms receipt → adherence and clinical review proceed exactly as
the built pipeline intends. `docs/PATIENT_HEALTH_RECORD_ARCHITECTURE.md`'s 4-stage medication model
(Prescribed → Pharmacy dispensed → Patient received → Patient reports taking) is the more current
description of this same journey and should be read alongside §12.1.

### 12.2 Pharmacy network — 🟡 (🟢 for catalogue-creation, still 🟡 for opening hours/categories)
Live: `pharmacy_partners` (name, `delivery` bool, `regions[]`, `is_active`, `contact_phone`,
`contact_email`, `address`, `latitude`/`longitude`, `uses_platform_login`, plus `license_type`/
`license_number`/`license_expires_at`/`license_verified_at`/`license_verified_by` added
2026-07-31 — `license_type` is commented "e.g. 'PCN premises registration'"); `pharmacy_partner_
locations` (2026-08-27, per-branch name/state/address/contact_phone/lat/long — real self-service
partner UI, not just schema); `pharmacy_medications` (drug_name, pack_size, price_kobo, is_active).
**Missing:** opening hours (no column anywhere in the schema) and a medication-category taxonomy
(`pharmacy_medications` is one flat row per drug, no category field) — still open, lower-value, not
built. **Corrected 2026-08-28:** stock capability beyond a binary per-SKU `is_active` is closed (see
12.6, optional/nullable). A formal "responsible/superintendent pharmacist" designation distinct from
"a `pharmacist`-role login exists" is still open. **Also corrected 2026-08-28:** the "no way to
create a catalogue row" gap this doc didn't originally flag (found during the codebase audit for the
Phase 2 build — confirmed no `useCreatePharmacyMedication` existed anywhere, only an `is_active`
toggle on rows that already exist) is now closed, admin-only, matching existing RLS. **Live in
production:** unchanged, 4 `pharmacy_partners` rows, **0 active**; 0 `pharmacy_partner_locations`; 0
`pharmacy_medications` — this build only added the machinery, not real data (see the status block).

### 12.3 Pharmacy onboarding — 🟢, built 2026-08-28
**Corrected 2026-08-28.** A real state machine now exists:
`pharmacy_partners.onboarding_status` (`application → business_verification →
regulatory_verification → location_verification → service_configuration → integration_testing →
approved → activated`, or `rejected` from any non-terminal stage), advanced one step at a time via
`admin_advance_pharmacy_partner_onboarding()` — which stamps the evidence for the stage just
completed and checks the evidence for stages proven by a separate action (regulatory verification
reuses the existing `license_verified_at`; location verification requires
`admin_verify_pharmacy_partner_location()` having been called, which a partner cannot self-call — a
DB trigger blocks it) — or terminates via `admin_reject_pharmacy_partner_onboarding()`. A DB CHECK
constraint (`pharmacy_partners_active_requires_activated_onboarding`) makes `is_active=true`
impossible except via the last step of this exact pipeline, closing the specific risk this section
originally flagged (an admin could previously just flip `is_active` with nothing behind it). Existing
rows were grandfathered to `onboarding_status='activated'` (vetted through the old ad-hoc process
before this pipeline existed) rather than forced to restart it. Admin UI:
`pharmacies-manager.tsx`'s new `PharmacyOnboardingPanel`. Proven full-cycle, application through
activation including both negative-path checks (blocked without evidence), in
`packages/db/tests/pharmacy_engine_end_to_end.sql`.

### 12.4 Prescription transmission — 🟡, reinterpreted, unchanged 2026-08-28
The spec wants: signed prescription → secure transmission → selected/assigned pharmacy → pharmacist
receives, with the patient never manually handling the document. As built: a `medications` row *is*
the signed order the moment it's created (`private.has_prescribing_authority` gates the insert,
`added_by` is server-stamped, never client-suppliable — 2026-08-27). The patient genuinely never has
to fax/download anything — but not via an auto-created `pharmacy_orders` row (that would need
`medications` to know a pharmacy has been selected, which happens later, patient-initiated, via the
still-unmounted `pharmacy-catalogue.tsx` — see 12.8). **Deliberately not rebuilt as an automatic
transmission step** — `20260827200208_prescription_workspace_fields.sql`'s own reasoning holds:
*"Deliberately NOT building §5.11's literal 'Draft → Signed → Sent to patient → Sent to pharmacy →
Dispensed' as a new status enum... A 'sent to pharmacy' step would misrepresent a fulfilment path
that no longer exists"* for a real patient today. The order-creation → payment → pharmacist-response
chain downstream of a *patient's own* pharmacy selection is now real end to end (12.5/12.9) — this
section's gap is specifically about *automatic* transmission the moment a clinician signs, which
remains out of scope.

### 12.5 Pharmacy acceptance — 🟢, built 2026-08-28
**Corrected 2026-08-28 — this was the single biggest gap the codebase audit found**, confirmed by
reading every line of `pharmacist_record_dispense`: it only ever inserted into the separate
`pharmacy_order_dispenses` log, never touched `pharmacy_orders.status` at all — no accept, no reject,
no out-of-stock path existed anywhere, not even a stub. Closed by `pharmacist_accept_order()`
(confirms quantity/price/fulfilment time; a confirmed price below what the patient paid
auto-flags the difference for refund — §12.9's "partially refunded," not a manual step) and
`pharmacist_decline_order()` (the out-of-stock workflow the spec explicitly asks for instead of
"simply failing" — flags a full refund automatically and enqueues a patient notification). Both are
scoped through `private.pharmacist_partner()`, the same pattern `pharmacist_record_dispense` already
used. UI: new accept/decline controls on `(dashboard)/pharmacist/orders/pharmacist-orders.tsx`,
shown only while `needsPharmacistResponse(order.status)`. Proven in
`packages/db/tests/pharmacy_engine_end_to_end.sql` (both the accept and decline paths, including the
notification enqueue).

### 12.6 Stock management — 🟢, built 2026-08-28, optional by design
**Corrected 2026-08-28.** `pharmacy_medications.stock_status`
(`in_stock`/`low_stock`/`unavailable`)/`expected_restock_at`/`stock_updated_at` (auto-stamped by
trigger on change, per the spec's own "should include a timestamp" line) now exist — but nullable,
so nothing *requires* a partner to set them. The standing founder decision this section originally
flagged as a direct conflict — *"the pharmacist surface must not require pharmacies to load
stock"* — is unchanged and still holds: a partner who never touches these columns behaves exactly as
before (`is_active`/`pharmacy_medications.is_active` remain the only signals anyone has to read).
This is the reconciliation the founder's 2026-08-28 ask called for: build the capability, don't make
it mandatory.

### 12.7 Price visibility — 🟢, built 2026-08-28
**Corrected 2026-08-28.** `pharmacy_partners.delivery_fee_kobo` (the pharmacy's own flat fee,
composed into `pharmacy_orders.total_kobo` by `useCreatePharmacyOrder` when
`fulfilment_method='delivery'` — deliberately not `logistics_partners.delivery_fee_kobo`, which
isn't assigned until after payment in the existing staff-side `AssignLogisticsForm` flow and so
can't be known at checkout time) and `pharmacy_medications.is_generic`/`generic_equivalent_of`
close both gaps this section originally found. Still moot in production today with 0
`pharmacy_medications` rows to price — the machinery is complete, the catalogue is empty.

### 12.8 Pharmacy selection — 🟡 in effect (real UI, unmounted, dormant data)
`(dashboard)/patient/pharmacy-catalogue.tsx` is real, working code implementing exactly this —
availability/price/location/delivery selection, including a live clinician-prescribed gate
(`isClinicianPrescribed()`, mirrored server-side by the `enforce_pharmacy_order_origin` trigger) so
only a drug the patient is actually prescribed can be ordered. **Confirmed 2026-08-28: this component
is not merely data-empty, it is literally unmounted** — zero imports of `PharmacyCatalogue` or
`PharmacyOrdersList` anywhere in the render tree (`medications/page.tsx`'s own comment: *"kept
unmounted rather than deleted, so contracting a partner is a matter of rendering them again"*). That
un-mount is the real activation switch for the patient-facing side, deliberately left untouched by
this build — see the status block. No pharmacy-specific insurance-aware filter was found (the Care
Voucher system applies platform-wide, not as a pharmacy-selection filter) — still open, low priority.
The spec's "don't prioritise a pharmacy that pays Tarragon more" principle is trivially satisfied
today: there is no ranking algorithm of any kind, only a plain catalogue list — the same
filter-not-rank posture `docs/CLINICAL_NETWORK_SPEC.md` §3 holds specialists to.

### 12.9 Payment — 🟢, built 2026-08-28
`payment_transactions` (Paystack only, as of the 2026-09-03 Stripe removal — see `CLAUDE.md`) is real,
shared, idempotent (`unique(provider, provider_event_id)`) infrastructure used platform-wide, not
pharmacy-specific. Diaspora payment is now the sponsor/Care Voucher model, not a second processor.
`pharmacy_orders.payment_provider`/`payment_provider_ref`/`pending_payment_provider_ref` plus the
`pharmacy_order_status` enum's `pending_payment` → `payment_confirmed` states cover the spec's
pending/paid. **Corrected 2026-08-28:** `refund_status`
(`due`/`refunded`/`failed`)/`refund_amount_kobo`/`refund_ref` on `pharmacy_orders` now cover
refunded/partially-refunded, set automatically by `pharmacist_accept_order`/`pharmacist_decline_order`
(§12.5) and processed by a new `/api/cron/pharmacy-order-refunds` — a **two-pass sweep mirroring the
existing `video-visit-refunds` cron exactly** (same file shape, same idempotent-retry posture): pass
1 cancels a `pending_payment` order abandoned >24h with no charge ever captured (no refund needed,
matching the paystack-webhook's own confirmed behaviour — `charge.failed` never touches the order
row, so an abandoned checkout just times out); pass 2 calls the Paystack Refunds API (extended,
backward-compatibly, to accept an optional partial `amountKobo`) for every `refund_status='due'` row.
Insurance/employer/wallet coverage is handled generically by the Care Voucher system
(`applied_voucher_id`, `voucher_covered_kobo`) across order types including pharmacy; no
HMO-claims-specific integration for pharmacy was found — still open, low priority, not blocking.
Card/bank-transfer/"supported Nigerian payment methods" are a Paystack-channel-level fact already
true platform-wide, not a pharmacy gap. A Synlab-style full liability/reconciliation/settlement
pipeline (`partner_billing_collect_and_liability/_transmit/_reconcile_settle_refund`) was
deliberately **not** built for pharmacy — the video-visit-refunds shape is the right-sized precedent
here, not Synlab's heavier one, since pharmacy has no equivalent of Synlab's ongoing
per-lab-network settlement relationship.

### 12.10 Delivery — 🟡, schema-complete, switched off, unchanged 2026-08-28
`pharmacy_order_status` already has `requested → confirmed → dispensed → out_for_delivery → delivered
→ cancelled` (plus `pending_payment`/`payment_confirmed` prepended 2026-07-15) — matches the spec's
diagram almost exactly. `fulfilment_method` (pickup/delivery), `logistics_partner_id`,
`delivery_address` (jsonb), `estimated_delivery_at`, `courier_reference`, `delivery_confirmed_at` all
exist (`20260715230129`, `20260716123000`), and the assignment/confirmation flow
(`AssignLogisticsForm`, `useAssignLogisticsPartner`, `useConfirmPharmacyDelivery`,
`DeliveryAddressForm`) is real, complete, working code — confirmed by direct audit, not just schema.
Explicitly confirmed dormant, not merely unused: *"a pharmacy delivery pathway... is switched off in
the UI and has zero production rows (no contracted logistics partner is active)"*
(`20260827195857_medication_receipt_confirmations.sql`). **Left as-is 2026-08-28** — this piece
needed no new build, only confirmation it was real, which the codebase audit provided. One real gap
the audit found and this build did *not* close, since it's independent of §12 and affects `confirmed`/
`dispensed`/`cancelled` too: those three `pharmacy_order_status` values have zero write paths in any
app code today (only `pending_payment`/`payment_confirmed`/`out_for_delivery`/`delivered` are ever
actually set) — §12.5's new `pharmacist_accept_order`/`pharmacist_decline_order` close `confirmed`/
`cancelled` specifically; `dispensed` as an *order-level* status (as opposed to a
`pharmacy_order_dispenses` row, which already existed) remains unset by any code path, a minor
residual gap not blocking anything above.

### 12.11 Collection — 🟢, rebuilt for the current model, exceeds the spec as written
The spec's "collect from pharmacy" is one of two structured `pharmacy_orders.fulfilment_method`
values, but the version that's actually **live and usable today** is broader and matches
self-arranged fulfilment directly: `pharmacy_order_dispenses` records "medication collected" **at any
pharmacy, not only a Tarragon-selected one** — `pharmacy_order_id` was made nullable and a free-text
`pharmacy_name` column added specifically so "I bought this at the chemist down the road" is
representable (`20260803132008_medication_collected_anywhere.sql`). Combined with
`medication_receipt_confirmations` (12.15), this gives the spec's collection-confirmation *outcome*
without depending on 12.2–12.10 being live at all — genuinely the best-fit piece in this whole
reconciliation.

### 12.12 Pharmacist workspace — 🟢, and now covers acceptance/decline too (§12.5)
`pharmacist_orders()`, `pharmacist_order_allergies(p_order_id)`, `pharmacist_order_medications
(p_order_id)`, `pharmacist_record_dispense(...)`, `pharmacist_profile()`/`pharmacist_update_profile()`,
`pharmacist_dispense_history()` are all real SECURITY DEFINER RPCs, and `(dashboard)/pharmacist/`
(orders, history, profile, locations, services, overview) is a real, **reachable** dashboard — unlike
12.8's patient-side catalogue, a real `pharmacist`-role login can open this today, it simply has
nothing to act on with 0 `pharmacy_orders` rows in production. **Corrected 2026-08-28:**
`pharmacist_accept_order`/`pharmacist_decline_order` (§12.5) and `pharmacist_orders()` returning
price/outcome fields close the "dispense-only, no accept/reject" gap this section originally
described — the workspace itself is otherwise unchanged, still built against `pharmacy_orders`, still
waiting on real rows.

### 12.13 Pharmacist intervention — 🟢, shipped 2026-08-28 (Phase 1, first pass)
**Corrected 2026-08-28.** `medication_dispense_flags` + `pharmacist_flag_dispense()` now let a
patient, staff member, or pharmacist flag a suspected prescription issue, availability issue,
interaction concern, duplication, unclear instruction, or patient query, routed to a clinician for
review (resolving one is clinical-tier-gated, mirroring escalation-claiming). `raised_by`/
`raised_by_role` are server-stamped from the caller's own session, never client-suppliable. As noted
below when this was scoped: this gap never depended on the routing pipeline being live, which is why
it shipped in the first Phase 1 pass, well before §12.5's pharmacist-order-acceptance build.

### 12.14 Dispensing record — 🟢, enriched 2026-08-28 (Phase 1, first pass)
`pharmacy_order_dispenses` covers: drug_name, quantity (free text), dispensed_on, source
(patient/pharmacy), recorded_by, pharmacy_order_id (nullable), medication_id, pharmacy_name (free
text) — medication/quantity/pharmacy/date/prescription-relationship, all present. **Corrected
2026-08-28:** `strength`/`batch_lot`/`expiry_date` were added as additive nullable columns — this
does not conflict with the standing "must not require pharmacies to load stock" decision the way a
true stock system would (§12.6), since these describe one specific already-dispensed unit
after the fact, not a pharmacy's inventory. Still not identified: a formally-attributed dispensing
pharmacist distinct from whoever logged the row (`recorded_by` may still be the patient) — low
priority, not built.

### 12.15 Medication receipt confirmation — 🟢, shipped 2026-08-27, closest literal match in the spec
`medication_receipt_confirmations` draws exactly the distinction the spec asks for: `confirmation_
source` is CHECK-constrained to `patient_self_report` / `delivery_confirmed` / `pharmacy_confirmed`,
and its own migration comment states it is deliberately **not** auto-derived from `pharmacy_orders.
delivery_confirmed_at` (a dormant pathway) — it is a standalone event, wired into `patient_timeline`
as `medication_received`. This is the strongest, most literal built match to any single 12.x item in
the entire spec, and it was built specifically so this distinction would survive fulfilment being
self-arranged rather than Tarragon-routed.

### 12.16 Medication affordability — 🟢, shipped 2026-08-28 (Phase 1, first pass)
**Corrected 2026-08-28.** `medication_affordability_reports` is now a real, structured
care-management signal — its own small event table (not bolted onto `medication_logs`), CHECK-gated
`resolution_action` matching the spec's own listed actions (lower-cost alternative, alternative
pharmacy, assistance programme, care coordinator intervention), any org staff can resolve one.
Like 12.13, this never depended on the routing pipeline being live — a patient can fail to obtain
medication at any pharmacy of their choosing just as easily as at a Tarragon-selected one, and the
signal that matters is "didn't get it," not "which pharmacy failed to have it" — which is why it
shipped in the same early Phase 1 pass as 12.13.

### 12.17 Refill system — 🟢, shipped, closely matches the spec
`medication_refill_reminder_rules` (`lead_days`, per-patient or org-wide default) + `medication_
refill_state` (bookkeeping, written only by the sweep) + `private.queue_medication_refill_reminders()`
(daily cron) + the `medications_confirm_refill` RPC (patient- or Tier-1-gated, `enforce_medication_
confirm_only` restricts a refill-confirm to touching only the refill date — extended 2026-08-27 to
cover the new prescription-workspace columns so a "confirm" can't silently rewrite prescribing detail)
implement supply → expected depletion → reminder → patient confirms → prescription validation
essentially as specified. The one step the spec has that this doesn't: an automated "→ pharmacy →
dispensing" handoff — same reason as 12.4/12.5, that hop is switched off, so a confirmed refill ends
at "patient goes and gets it themselves," identically to a brand-new prescription.

### 12.18 Acceptance criteria — reframed
The spec's bar — "must connect prescription → pharmacy → dispensing → patient receipt → adherence" —
is currently true for four of those five links and false for the fifth by design: **prescription →
[no live pharmacy/dispensing link] → patient receipt → adherence → clinical review.** Patient receipt
(12.15) and adherence (refills, `medication_logs`) connect correctly to prescription and to each
other; they simply don't connect *through* a live, Tarragon-operated pharmacy network, because that's
the exact link 2026-08-03 cut on purpose. Whether "connect prescription → pharmacy → dispensing" is
meant to include Tarragon operating that middle link, or is satisfied by "the patient connects
prescription to pharmacy themselves, and Tarragon records the outcome," is a founder framing question,
not an engineering one — see §5.

**Corrected 2026-08-28:** the middle link is no longer merely absent, it's built-and-dormant —
`packages/db/tests/pharmacy_engine_end_to_end.sql` proves prescription → order → payment → pharmacist
accept → dispense → patient receipt → `patient_timeline` connects correctly through a *test* pharmacy
partner, start to finish. What's still true is that no *real* pharmacy partner exists to connect
through — the chain is proven, not yet live (§3/§4 Phase 3).

## 3. The guardrail — revised 2026-08-28: infrastructure is built, activation is still gated

**Original guardrail (2026-08-03 → 2026-08-28):** everything in §12.2–§12.11 was built, shipped to
production, and then deliberately reversed by an explicit, documented founder decision — reviving any
of it needed a fresh, explicit ask before a single line was written. That ask arrived 2026-08-28
(quoted in full in the status block) and covered the *infrastructure*: onboarding (12.3), optional
stock management (12.6), pharmacist accept/decline (12.5), refund tracking (12.9), price-visibility
completeness (12.7), and the missing catalogue-creation UI (12.2). All of it is now built, tested, and
proven end-to-end against a throwaway test partner (`packages/db/tests/pharmacy_engine_end_to_end.sql`)
— see §2's per-section detail above for exactly what shipped.

**What the ask did NOT cover, and what remains gated exactly as before, needing its own separate,
later founder go-ahead:**
- Populating any **real** `pharmacy_partners`/`pharmacy_medications` row with real data, or advancing
  a real partner's `onboarding_status` past `application` for real — the pipeline exists to be walked
  through when there is an actual contracted partner, not before.
- Flipping any real `pharmacy_partners.is_active` to `true` — now additionally gated by
  `pharmacy_partners_active_requires_activated_onboarding` at the DB level, not just convention.
- Re-mounting `PharmacyCatalogue`/`PharmacyOrdersList` into the patient dashboard for real patients —
  confirmed 2026-08-28 to be a literal unmount, not just empty data (see §12.8); that render-tree
  change is the actual go-live moment and is a separate, later decision.
- The standing "pharmacist surface must not require pharmacies to load stock" decision is unchanged
  — 12.6 was built *within* that constraint (nullable/optional), not as an exception to it.

**The distinction that matters going forward:** "build the machinery" (now done, this pass) is not
the same decision as "turn it on for a real patient" (still not done, still gated, still needs its
own explicit ask when a real partner is actually contracted) — treat any future request to activate a
real partner as needing the same weight of confirmation this section always has, even though the code
itself is now ready.

## 4. Phasing — revised 2026-08-28: Phases 1 and 2 are both built

### Phase 1 — shipped 2026-08-28 (first pass)
Additive, routing-independent, matches the "keep the record" half of the 2026-08-03 decision:
1. ✅ **Pharmacist intervention/flag mechanism** (§12.13) — `medication_dispense_flags` +
   `pharmacist_flag_dispense()`, routing a concern to a clinician; resolving one is
   clinical-tier-gated, matching the escalation-claiming pattern.
2. ✅ **Medication affordability signal** (§12.16) — `medication_affordability_reports`, its own
   small event table (not bolted onto `medication_logs`); any org staff can resolve it.
3. ✅ **Dispensing-record enrichment** (§12.14) — `strength`/`batch_lot`/`expiry_date` added to
   `pharmacy_order_dispenses`, additive and nullable.
4. **Pharmacy catalogue-metadata completeness** (§12.2's opening hours/category field) — still not
   built; lowest-value remaining item, enriches an already-empty catalogue.

### Phase 2 — shipped 2026-08-28 (second pass, explicit founder ask)
The full infrastructure behind §12.2–§12.11, built but **not activated for any real partner** (§3):
1. ✅ **Pharmacy onboarding pipeline** (§12.3) — full state machine, DB-enforced activation gate.
2. ✅ **Stock management** (§12.6) — built within the standing "no mandatory stock loading"
   constraint, not as an exception to it.
3. ✅ **Pharmacy acceptance** (§12.5) — `pharmacist_accept_order`/`pharmacist_decline_order`, the
   single biggest gap found; **prescription transmission (§12.4)** stays deliberately unautomated
   (see §12.4) — a patient still initiates the pharmacy selection themselves via the (still
   unmounted) catalogue, same as it would once real routing goes live.
4. ✅ **Price visibility completeness** (§12.7) — delivery fee, generic/brand substitution.
5. ✅ **Refund tracking for pharmacy** (§12.9) — mirrors the existing `video-visit-refunds` cron
   shape, not Synlab's heavier settlement pipeline (see §12.9 for why that's the right-sized choice).

### Phase 3 — still gated, still needs its own separate ask: real activation
Not a capability gap any more — a **business decision gap**. Populating a real `pharmacy_partners`
row, walking it through onboarding for real, flipping `is_active`, and re-mounting
`PharmacyCatalogue`/`PharmacyOrdersList` for real patients all remain untouched, per §3. Full
end-to-end acceptance per §12.18 ("prescription → pharmacy → dispensing → patient receipt →
adherence" with a *live* network in the middle, not a throwaway test one) still can't be meaningfully
exercised with real data — 4 partner rows, all inactive, 0 real catalogue items — but the machinery
itself is no longer the blocker. Revisit once there's a real, contracted pharmacy partner and an
explicit founder go-ahead to activate one.

## 5. Open questions for the founder

**Resolved 2026-08-28:** §12 is a reference architecture to have ready for when a real pharmacy
partner is eventually contracted, not an immediate re-activation of routing — confirmed by the
founder's own framing ("initially patient will buy their own meds, but in future this model will be
used"). §12.6's stock-management ask is resolved the same way: built within the standing
no-mandatory-stock-loading constraint, not as an override of it (§3/§12.6).

**Still open:**
- **When there IS a real contracted pharmacy partner, who makes the call to actually activate it —**
  walk it through onboarding for real and flip `is_active` — and what evidence (a signed agreement, a
  test order actually fulfilled) should gate that, beyond what `admin_advance_pharmacy_partner_
  onboarding`'s stage checks already enforce technically? The DB constraint stops an accidental
  activation; it doesn't substitute for the business decision to activate a specific partner.
- **Labs went through the identical 2026-08-03 reversal** (`worktree-self-arranged-fulfilment`
  covered both). This build only touched pharmacy — should a parallel "Lab Engine" build follow the
  same shape (onboarding pipeline, accept/decline, refund tracking), or does labs stay out of scope
  for now?
- **Once a real partner exists, does the delivery-fee model in §12.7** (a flat per-pharmacy fee,
  decided at order-creation time) match how a real courier relationship will actually be priced, or
  will `logistics_partners.delivery_fee_kobo`'s post-payment assignment need to move earlier in the
  flow? Worth revisiting once real fulfilment economics are known, not before.

## 6. Original spec, for reference

The incoming spec text (§12.1–§12.18) is reproduced below verbatim, since it's the source-of-truth ask
this document reconciles against.

> ### 12. PHARMACY ENGINE
>
> **12.1 Purpose** — The Pharmacy Engine coordinates the medication journey from prescription to
> dispensing and, eventually, adherence monitoring. Pipeline: Clinical decision → Prescription →
> Pharmacy network → Stock/price → Patient choice → Payment → Dispensing → Delivery/collection →
> Medication received → Adherence → Clinical review.
>
> **12.2 Pharmacy network** — Each pharmacy should have: verified organisation, registration details,
> location, opening hours, delivery areas, medication categories, stock capability, pricing, contact,
> responsible pharmacist information, Tarragon network status.
>
> **12.3 Pharmacy onboarding** — Application → Business verification → Professional/regulatory
> verification → Location verification → Service configuration → Integration testing → Approval →
> Activated.
>
> **12.4 Prescription transmission** — Once a clinician signs a prescription: Signed prescription →
> Secure transmission → Selected/assigned pharmacy → Pharmacist receives. The patient should not have
> to manually download and send the prescription.
>
> **12.5 Pharmacy acceptance** — Pharmacist should confirm: prescription received, medication
> available, quantity, price, expected fulfilment time. If unavailable: out of stock should trigger an
> appropriate workflow rather than simply failing.
>
> **12.6 Stock management** — Partner pharmacies can provide: in stock, low stock, unavailable,
> expected restock. Stock data should include a timestamp because availability changes rapidly.
>
> **12.7 Price visibility** — Patient should see: medicine, strength, quantity, pharmacy, price,
> delivery fee, total. Where clinically appropriate, the platform can display generic options, but
> substitution must remain subject to appropriate clinical/pharmacy rules.
>
> **12.8 Pharmacy selection** — Patient can choose among appropriate participating pharmacies based
> on: availability, price, location, delivery, insurance, patient preference. Tarragon should not
> prioritise a pharmacy merely because it pays Tarragon more if that conflicts with patient or
> clinical interests.
>
> **12.9 Payment** — Support: card, bank transfer, supported Nigerian payment methods, insurance,
> employer coverage, wallet/credit where introduced. Payment status: Pending, Paid, Failed, Refunded,
> Partially refunded.
>
> **12.10 Delivery** — Where the pharmacy provides delivery: Prescription → Dispensed → Packed →
> Dispatched → Out for delivery → Delivered.
>
> **12.11 Collection** — Patient can select "Collect from pharmacy." The system generates collection
> information and records "Medication collected."
>
> **12.12 Pharmacist workspace** — Pharmacist sees: prescription, patient information necessary for
> dispensing, allergies where relevant, medication history where authorised, dispensing instructions,
> substitutions/issues requiring clarification.
>
> **12.13 Pharmacist intervention** — Pharmacist should be able to flag: suspected prescription issue,
> availability issue, interaction concern, duplication, unclear instruction, patient query. The issue
> routes back to the appropriate clinician.
>
> **12.14 Dispensing record** — Store: medication, strength, quantity, pharmacy, pharmacist, date,
> batch/lot where appropriate, expiry where relevant, prescription relationship.
>
> **12.15 Medication receipt confirmation** — Patient can confirm "I received my medication." This is
> distinct from "The pharmacy marked it dispensed." That distinction allows Tarragon to identify
> delivery failures.
>
> **12.16 Medication affordability** — The system can identify "Patient did not obtain medicine
> because of cost." That should become a care-management signal. Possible actions: lower-cost
> clinically appropriate options discussed with clinician, alternative pharmacy, assistance
> programme, care coordinator intervention.
>
> **12.17 Refill system** — For recurring medication: Medication supply → Expected depletion → Refill
> reminder → Patient confirms → Prescription validation → Pharmacy → Dispensing.
>
> **12.18 Pharmacy acceptance criteria** — The system must connect: Prescription → pharmacy →
> dispensing → patient receipt → adherence.
