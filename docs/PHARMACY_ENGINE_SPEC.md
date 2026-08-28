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
> **2026-08-28 — three of Phase 1's four items shipped**, on this branch, additive to the live
> self-arranged-fulfilment path and touching nothing in §12.2–§12.11's guardrailed routing/payment/
> delivery machinery: (1) `medication_dispense_flags` + `pharmacist_flag_dispense()` (§12.13) — a
> concern (prescription issue, availability, interaction, duplication, unclear instruction, patient
> query) now routes to a clinician, raised by a patient, staff, or (once routing is ever live again)
> a pharmacist via the same scoped-RPC pattern as `pharmacist_record_dispense`; (2)
> `medication_affordability_reports` (§12.16) — "couldn't afford it" is now a structured
> care-management signal any org staff can act on, matching the spec's own listed actions; (3)
> `pharmacy_order_dispenses.strength`/`batch_lot`/`expiry_date` (§12.14) — additive nullable columns,
> deliberately not a stock system (see §3's standing guardrail on §12.6). A follow-up migration
> closed a falsifiable-attribution gap found while building this (client-supplied `resolved_by`/
> `reviewed_by` would otherwise have been writable to an arbitrary id) — both are now server-stamped,
> on insert and update alike, proven in `packages/db/tests/medication_issues_rls.sql`. Patient-facing
> UI: `MedicationIssueReportForm` next to the existing "I picked this up" control. Staff-facing UI:
> `/clinician/medication-issues`, linked from both the clinician and care-coordinator nav. **Not
> shipped this pass:** Phase 1 item 4 (`pharmacy_partners`/`pharmacy_partner_locations`
> catalogue-metadata completeness — opening hours, medication categories, a responsible-pharmacist
> field) — lower value than the other three since it enriches an already-dormant, zero-active-row
> catalogue rather than the live pathway; still open. Everything in Phase 2/3 remains unbuilt, guardrail
> unchanged.

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
once a real partner is contracted — see the "keep the record, drop the routing" framing above. Reading
§12.2–§12.11 as "build this out to completion now" would functionally re-launch the reversed model
without anyone having asked for that reversal to be reversed.

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

### 12.2 Pharmacy network — 🟡
Live: `pharmacy_partners` (name, `delivery` bool, `regions[]`, `is_active`, `contact_phone`,
`contact_email`, `address`, `latitude`/`longitude`, `uses_platform_login`, plus `license_type`/
`license_number`/`license_expires_at`/`license_verified_at`/`license_verified_by` added
2026-07-31 — `license_type` is commented "e.g. 'PCN premises registration'"); `pharmacy_partner_
locations` (2026-08-27, per-branch name/state/address/contact_phone/lat/long — real self-service
partner UI, not just schema); `pharmacy_medications` (drug_name, pack_size, price_kobo, is_active).
**Missing:** opening hours (no column anywhere in the schema), a medication-category taxonomy
(`pharmacy_medications` is one flat row per drug, no category field), stock capability beyond a
binary per-SKU `is_active` (see 12.6), and a formal "responsible/superintendent pharmacist"
designation distinct from "a `pharmacist`-role login exists and is linked via `admin_link_pharmacist`."
**Live today:** 4 `pharmacy_partners` rows, **0 active**; 0 `pharmacy_partner_locations`; 0
`pharmacy_medications`.

### 12.3 Pharmacy onboarding — 🔴
No application → business verification → professional/regulatory verification → location
verification → service config → integration testing → approval → activated pipeline exists, for
pharmacy or for any other partner type. Today an admin manually inserts a `pharmacy_partners` row
(`(dashboard)/admin/settings/partners/pharmacies/pharmacies-manager.tsx`) and separately runs
`admin_link_pharmacist` to attach a login. The license columns from 12.2 exist to *record* a
verification outcome, but nothing drives a workflow or status through them — matches the identical
gap `docs/CLINICAL_NETWORK_SPEC.md` §4.3 found for lab/specialist/logistics partners; this is a
platform-wide gap, not something specific to pharmacy.

### 12.4 Prescription transmission — 🟡, reinterpreted
The spec wants: signed prescription → secure transmission → selected/assigned pharmacy → pharmacist
receives, with the patient never manually handling the document. As built: a `medications` row *is*
the signed order the moment it's created (`private.has_prescribing_authority` gates the insert,
`added_by` is server-stamped, never client-suppliable — 2026-08-27). But there is no transmission
step to a pharmacy at all — no `pharmacy_orders` row is auto-created from a prescription, no
pharmacist ever electronically "receives" one, because that hop is exactly what 2026-08-03 turned
off. The patient genuinely never has to fax/download anything, but not because Tarragon quietly
handles the handoff — because there is no handoff to route. The relevant migration says this
explicitly: *"Deliberately NOT building §5.11's literal 'Draft → Signed → Sent to patient → Sent to
pharmacy → Dispensed' as a new status enum... A 'sent to pharmacy' step would misrepresent a
fulfilment path that no longer exists."* (`20260827200208_prescription_workspace_fields.sql`) — the
same reasoning applies to this spec's §12.4 almost word for word.

### 12.5 Pharmacy acceptance — 🔴
No pharmacist-side accept/confirm-available/quantity/price/fulfilment-time flow exists.
`pharmacist_orders()`/`pharmacist_record_dispense()` only record what was already dispensed against a
`pharmacy_orders` row, once one exists — there is no "pharmacist reviews and accepts an incoming
order" step upstream of that. No out-of-stock workflow exists either, because there is no stock data
(12.6). This whole step assumes 12.4's routing feeds it, and that feed is off.

### 12.6 Stock management — 🔴, and directly conflicts with a standing founder decision
No in-stock / low-stock / unavailable / expected-restock states exist anywhere in the schema.
`pharmacy_medications` (0 rows) carries only `price_kobo` and `is_active`. This is not an oversight —
the founder was explicit, on record in the migration comment for `pharmacy_order_dispenses`, that
*"the pharmacist surface must not require pharmacies to load stock."* Building §12.6 as written would
directly re-open that decision, not just fill a schema gap — flag this to the founder before treating
it as open scope (see §5).

### 12.7 Price visibility — 🟡, schema-shaped, unpopulated
`pharmacy_medications.price_kobo` + `pack_size` per partner, `pharmacy_orders.total_kobo` /
`voucher_covered_kobo` (renamed from `discount_kobo`, care-voucher redemption) / `payable_kobo`
(generated column, `greatest(total_kobo - discount_kobo, 0)`) give the total-price math the spec
wants. **Missing:** no per-order delivery-fee column on `pharmacy_orders` itself (`logistics_
partners.delivery_fee_kobo` is a flat partner-level fee, not composed into an order-level breakdown);
no generic/brand substitution linkage anywhere in `pharmacy_medications`. All of it is moot today with
0 `pharmacy_medications` rows to price.

### 12.8 Pharmacy selection — 🔴 in effect (real UI, dormant data)
`(dashboard)/patient/pharmacy-catalogue.tsx` is real, working code implementing exactly this —
availability/price/location/delivery selection — but with an empty catalogue it has nothing to show.
No pharmacy-specific insurance-aware filter was found (the Care Voucher system applies platform-wide,
not as a pharmacy-selection filter). The spec's "don't prioritise a pharmacy that pays Tarragon more"
principle is trivially satisfied today: there is no ranking algorithm of any kind, only a plain
catalogue list — the same filter-not-rank posture `docs/CLINICAL_NETWORK_SPEC.md` §3 holds specialists
to.

### 12.9 Payment — 🟡
`payment_transactions` (Paystack primary, Stripe for diaspora) is real, shared, idempotent
(`unique(provider, provider_event_id)`) infrastructure used platform-wide, not pharmacy-specific.
`pharmacy_orders.payment_provider`/`payment_provider_ref`/`pending_payment_provider_ref` plus the
`pharmacy_order_status` enum's `pending_payment` → `payment_confirmed` states cover the spec's
pending/paid. **Missing:** no dedicated `failed`/`refunded`/`partially_refunded` states on
`pharmacy_order_status` — compare Synlab's full lab-order liability/reconciliation/settlement/refund
pipeline (`partner_billing_collect_and_liability/_transmit/_reconcile_settle_refund`), which has no
pharmacy equivalent. Insurance/employer/wallet coverage is handled generically by the Care Voucher
system (`applied_voucher_id`, `voucher_covered_kobo`) across order types including pharmacy; no
HMO-claims-specific integration for pharmacy was found. Card/bank-transfer/"supported Nigerian payment
methods" are a Paystack-channel-level fact already true platform-wide, not a pharmacy gap.

### 12.10 Delivery — 🟡, schema-complete, switched off
`pharmacy_order_status` already has `requested → confirmed → dispensed → out_for_delivery → delivered
→ cancelled` (plus `pending_payment`/`payment_confirmed` prepended 2026-07-15) — matches the spec's
diagram almost exactly. `fulfilment_method` (pickup/delivery), `logistics_partner_id`,
`delivery_address` (jsonb), `estimated_delivery_at`, `courier_reference`, `delivery_confirmed_at` all
exist (`20260715230129`, `20260716123000`). Explicitly confirmed dormant, not merely unused: *"a
pharmacy delivery pathway... is switched off in the UI and has zero production rows (no contracted
logistics partner is active)"* (`20260827195857_medication_receipt_confirmations.sql`).

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

### 12.12 Pharmacist workspace — 🟢 for what it covers, built against the dormant order flow
`pharmacist_orders()`, `pharmacist_order_allergies(p_order_id)`, `pharmacist_order_medications
(p_order_id)`, `pharmacist_record_dispense(...)`, `pharmacist_profile()`/`pharmacist_update_profile()`,
`pharmacist_dispense_history()` are all real SECURITY DEFINER RPCs, and `(dashboard)/pharmacist/`
(orders, history, profile, locations, services, overview) is a real dashboard. Because every one of
these is scoped to `pharmacy_orders` rows, and that table has 0 rows, this genuinely-built workspace
currently has nothing to work on — the same "built but unreachable" shape as 12.8's catalogue UI.

### 12.13 Pharmacist intervention — 🔴, but not routing-dependent
No table or RPC exists anywhere for a pharmacist to flag a suspected prescription issue, availability
issue, interaction concern, duplication, unclear instruction, or patient query back to a clinician.
`escalations` is the platform's general clinician-routing mechanism for exactly this shape of concern
elsewhere; nothing pharmacy-specific plugs into it today. **Worth calling out specifically:** unlike
most of §12, this gap does **not** depend on the routing pipeline being live — a pharmacist could
raise "I think this dose looks wrong" against a `medications` row regardless of whether Tarragon
routed the order, since dispensing happens at a pharmacy of the patient's own choosing either way.
Genuine candidate for Phase 1 (§4).

### 12.14 Dispensing record — 🟡
`pharmacy_order_dispenses` covers: drug_name, quantity (free text), dispensed_on, source
(patient/pharmacy), recorded_by, pharmacy_order_id (nullable), medication_id, pharmacy_name (free
text) — medication/quantity/pharmacy/date/prescription-relationship, all present. **Missing:**
strength as its own field (folded into drug_name/quantity today), a formally-identified dispensing
pharmacist (`recorded_by` is whoever logged the row, patient included — not necessarily the pharmacist
who actually dispensed), batch/lot, expiry. The table is deliberately narrow by the same founder
decision as 12.6 — its own migration comment states "no stock/inventory... the founder was explicit
the pharmacist surface must not require pharmacies to load stock," and batch/lot/expiry lean the same
direction. Batch/lot/expiry as pure additive nullable columns (not a stock system) would not
re-open that decision the way 12.6 itself would — see §4.

### 12.15 Medication receipt confirmation — 🟢, shipped 2026-08-27, closest literal match in the spec
`medication_receipt_confirmations` draws exactly the distinction the spec asks for: `confirmation_
source` is CHECK-constrained to `patient_self_report` / `delivery_confirmed` / `pharmacy_confirmed`,
and its own migration comment states it is deliberately **not** auto-derived from `pharmacy_orders.
delivery_confirmed_at` (a dormant pathway) — it is a standalone event, wired into `patient_timeline`
as `medication_received`. This is the strongest, most literal built match to any single 12.x item in
the entire spec, and it was built specifically so this distinction would survive fulfilment being
self-arranged rather than Tarragon-routed.

### 12.16 Medication affordability — 🔴, and not routing-dependent
No cost-related non-adherence signal exists anywhere in the medication schema — nothing on
`medication_logs`, no care-coordinator-facing "patient couldn't obtain this due to cost" flag or
downstream action (lower-cost alternative discussion, alternate pharmacy, assistance programme, care
coordinator intervention). Like 12.13, this is a genuine, clean gap that does not require the routing
pipeline to be live — a patient can fail to obtain medication at any pharmacy of their choosing just as
easily as at a Tarragon-selected one, and the signal that matters is "didn't get it," not "which
pharmacy failed to have it."

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

## 3. The guardrail — read this before re-enabling anything in §12.2–§12.11

This is a stronger guardrail than the usual "Phase 2/3, ask first" pattern elsewhere in `CLAUDE.md`
(specialist-matching, wellness testing, HMO dashboards): those are things that were **never built**.
Everything in §12.2–§12.11 **was built, shipped to production, and then deliberately reversed** by an
explicit, documented founder decision, with its own migration, its own assertion block proving the
reversal took effect, and a same-day platform-wide marketing sweep to match. Reviving it isn't
"finishing unbuilt scope" — it's undoing a founder decision, which needs the same weight of
sign-off the original reversal had, applied in the opposite direction.

**Do not, without an explicit, fresh founder ask:**
- Populate `pharmacy_partners`/`pharmacy_medications` with real catalogue data, or flip any
  `pharmacy_partners.is_active` to `true`, in a way that would make the dormant patient-facing
  ordering/payment/delivery UI live.
- Build the pharmacy onboarding pipeline (12.3) as a real, activatable workflow.
- Build stock management (12.6) — this one doubly needs an ask, since it also directly contradicts
  the standing "pharmacist surface must not require pharmacies to load stock" decision.
- Re-wire `medications` → automatic `pharmacy_orders` creation (12.4), or build a pharmacist
  accept/reject step (12.5) against it.
- Add refund/partial-refund states to `pharmacy_order_status` or build a Synlab-style settlement
  pipeline for pharmacy (12.9) — real money-movement infrastructure for a channel that isn't active.

**Safe to build without a new ask** (additive, doesn't require the routing pipeline to go live — see
§4 for the concrete list): the pharmacist-intervention/flag mechanism (12.13), an affordability signal
(12.16), dispensing-record enrichment that stays nullable/additive (12.14's strength/batch/lot/
expiry), and catalogue-metadata completeness on the dormant `pharmacy_partners`/`pharmacy_partner_
locations` tables (12.2's opening hours/category/responsible-pharmacist) so the schema is more
complete whenever a real partner eventually is contracted — none of these turn the ordering pipeline
on, they just make the record-keeping half of the pipeline (which stays live regardless) more
complete.

## 4. Proposed phasing

### Phase 1 — safe to build now, no new ask needed
Additive, routing-independent, matches the "keep the record" half of the 2026-08-03 decision:
1. ✅ **SHIPPED 2026-08-28 — Pharmacist intervention/flag mechanism** (§12.13) —
   `medication_dispense_flags` + `pharmacist_flag_dispense()`, routing a concern to a clinician;
   resolving one is clinical-tier-gated, matching the escalation-claiming pattern.
2. ✅ **SHIPPED 2026-08-28 — Medication affordability signal** (§12.16) —
   `medication_affordability_reports`, its own small event table (not bolted onto `medication_logs`,
   to keep the "couldn't obtain it" fact independent of any specific dose-logging event); any org
   staff can resolve it, matching §12.16's own listed actions.
3. ✅ **SHIPPED 2026-08-28 — Dispensing-record enrichment** (§12.14) — `strength`/`batch_lot`/
   `expiry_date` added to `pharmacy_order_dispenses`, additive and nullable; works the same for a
   patient's own self-logged collection as it would for a routed order.
4. **Pharmacy catalogue-metadata completeness** (§12.2) — opening hours, a medication-category field,
   a formal responsible-pharmacist designation, all as additive columns on the already-dormant
   `pharmacy_partners`/`pharmacy_partner_locations` tables. Makes the paused catalogue more complete
   without activating anything. *Not built yet.*

### Phase 2 — needs an explicit founder ask before functional code
Everything that would re-enable or extend the routing/payment/delivery loop the founder turned off:
1. **Pharmacy onboarding pipeline** (§12.3) — meaningful only once there is real intent to contract a
   partner.
2. **Stock management** (§12.6) — needs the standing "no stock loading" decision revisited first, not
   just a schema addition.
3. **Prescription transmission + pharmacy acceptance** (§12.4/§12.5) — re-enabling automatic
   `pharmacy_orders` creation and a pharmacist accept/reject step.
4. **Pharmacy selection, payment, and delivery going live** (§12.7–§12.10) — the "Tarragon routes and
   takes payment" loop itself; the schema is already built and tested, so this is a founder-approval
   gate, not a build effort, once a real partner exists.
5. **Refund/settlement pipeline for pharmacy** (§12.9) — extending the Synlab liability/reconciliation
   pattern to pharmacy orders; real money movement, wants the same sign-off Synlab's build had.

### Phase 3 — capacity-dependent, revisit once Phase 2 has a real contracted partner
Full end-to-end acceptance per §12.18 ("prescription → pharmacy → dispensing → patient receipt →
adherence" with a live network in the middle) can't be meaningfully validated against today's data —
4 partner rows, all inactive, 0 catalogue items. Same reasoning `docs/CLINICAL_NETWORK_SPEC.md` §4
Phase 3 gives for the specialist-matching engine: building or testing further against an empty
catalogue means designing against fake data. Revisit once Phase 2 has actually onboarded at least one
real, contracted pharmacy partner.

## 5. Open questions for the founder

- **Is §12 meant to re-activate pharmacy routing (reversing 2026-08-03), or is it a reference
  architecture to keep in mind for if/when a real pharmacy partner is eventually contracted?** This
  single answer determines whether §12.2–§12.11 is Phase 2 scope or permanently out of scope.
- **If self-arranged fulfilment stays the model going forward, should "Pharmacy Engine" now mean:**
  prescribing + receipt confirmation + adherence + refills + pharmacist-flag + affordability signal —
  i.e. formally narrow the term to the record-keeping half — or should the dormant network/routing
  schema stay as-is, kept ready but explicitly out of scope?
- **§12.6's stock-management ask conflicts directly with a specific, on-the-record founder decision**
  ("the pharmacist surface must not require pharmacies to load stock") — worth an explicit
  re-confirmation before treating it as open scope, rather than assuming the new spec silently
  supersedes the old decision.
- **Labs went through the identical reversal the same day** (`worktree-self-arranged-fulfilment`
  covered both). Should a parallel "Lab Engine" reconciliation follow the same phasing, or does the
  founder's current ask only concern pharmacy?

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
