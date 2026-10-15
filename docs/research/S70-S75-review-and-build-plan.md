# S70 to S75: review, competitor comparison and build plan

Date: 2026-10-07.
Scope: S70 (Module 18, devices and wearables), S71 and S72 (Module 19, checkout and payments), S73 (Module 20, pricing engine), S74 (Module 21, partner network and commerce), S75 (Module 22, outcomes and analytics).

**Baseline warning.** The working tree (`s38/outcome-snapshots-analytics`) is 136 commits behind `origin/main-dev`. A first audit against it wrongly reported S25, S26, S27, S29, S31 and S38b to S38f as unbuilt. Everything below was re-checked against `origin/main-dev` (HEAD `60c843718`, S28c). Read from a fresh worktree off main-dev before building any of these sessions.

Evidence: the six session prompts, `docs/BUILD-SPEC-v5.md` B.18 to B.22 and the invariants, four read-only code audits (docs, migrations and grep; nothing run, live row counts taken from BUILD-PROGRESS only), and a light web check. Competitor claims are vendor or press claims unless marked "verified" (seen on a public page this session) or "recall" (my own knowledge, not re-checked). The `docs/research/competitor-review-*.md` files were not re-read for this plan.

---

## 1. Headline findings

1. **S75 is mostly built.** S38 to S38f (applied to production 2026-10-07) already deliver outcome snapshots, a monthly report with Care Circle sharing, deterministic risk scoring with a clinician worklist, sponsor cohorts and figures, triage agreement review and audited CSV export. S75 shrinks to completion: other pathways, one minimum-cell enforcement point, response-time reporting, retention and a real accuracy measure.
2. **S71 to S73 sit on a checkout that is built but switched off.** S25 and S26 (orders, Paystack, refunds, entitlements) and S29 (pay for a loved one) are applied but dormant (`platform_modules.v5_checkout` off, Membership seeded inactive at 10,000,000 kobo, 0 care packs by founder choice OQ-172). The Release 2 commerce layer is wholly missing: sponsor-paid display, HMO eligibility, points, instalments, Access Fund, payment requests, discount codes, price books, `price-quote`, `price.changed`.
3. **S70 is mostly built under other names.** BLE, Health Connect, HealthKit, five cloud wearables, Dexcom, ECG report upload and source and plausibility labelling all exist. Missing: photo capture (18.3), cross-source dedup (the module's own acceptance test), `device.synced` and `device.alert`, Withings and Samsung, a CGM paid programme, inhaler sensors, the Tarragon band (correctly paused).
4. **S74 is the weakest-built module.** Labs and the pharmacy order flow are strong. Not built: `partner_quality`, quality-breach and settlement events, `settlement-run`, `shop_orders`, HMO eligibility, `LabResultsSource`, partner-facing invoicing, home kits beyond a scaffold, clinic partner calendars.
5. **Five items are conflicts with earlier founder decisions, not features.** Each needs a decision before code (section 4):
   - Device shop vs the 2026-08-02 "Tarragon does not sell or import devices" decision and migration `20260910011846` ("catalogue becomes guidance, not commerce").
   - 19.9 points discounts vs OQ-08 (points are non-monetary, kobo conversion to be removed; the conversion code still exists).
   - 20.2 "subscription plans built but off" vs the 2026-09-02 retirement of `subscription_plans` and the 2026-10-05 Membership pivot.
   - 19.11 Access Fund and 19.5 sponsor-paid vs INV-09 and OQ-07 (stored-value Care Vouchers still need a rebuild and counsel input).
   - 21.4 HMO partners vs the capitation ban (I8). Eligibility checks are fine; capitation is not.
6. **Minimum-cell suppression has no single enforcement point.** One config source (`outcome_config.min_cell` = 20, 30 for two attributes) but suppression is re-implemented in the BP report, the sponsor report, the S38f held-back rule and risk distribution, plus older TypeScript-layer suppression on corporate dashboards with a different threshold (`organisations.min_cohort_size`). The module's acceptance test is only provable once there is one function.
7. **Two live safety gaps carried into these sessions.** OQ-192: older RLS read paths admit any `profile_access` grantee and `create_order` lets one pay, a problem before any real caregiver grant exists. OQ-39: 56 older `analytics_*` RPCs ignore `is_test` (INV-13).
8. **Parallel work to avoid colliding with.** A session is removing dormant home delivery (branch `origin/oq261/remove-home-delivery-app`, 33 files). Peer sessions are also analysing S66 to S70 and S75 to S80, so file names here are distinct. S31 payouts cover contracted clinicians only; S74 settlement must not overlap them.

---

## 2. Function-by-function status (on main-dev)

Legend: Built / Partial / Missing. "Gap" is what the session closes.

### Module 18: devices and wearables (S70)

| # | Status | Live shape and gap |
|---|---|---|
| 18.1 BLE pairing | Built, never tested on real hardware | GATT parsers for BP, glucose, weight, temperature, SpO2 in `packages/shared/src/device-readings.ts`; `apps/mobile/src/lib/ble.ts`; routes under `api/integrations/device-readings` and `api/mobile/device-readings`. No Withings or Dario vendor path. Real-device test of the two named cuffs and meter is the gap. |
| 18.2 Recommended devices | Partial | `device_catalog` and marketing pages exist; affiliate links removed. Confirm the seed holds Nigerian distributors and add the in-app screen. |
| 18.3 Photo capture of any screen | Missing | Only lab and ECG document extractors exist. |
| 18.4 Wearables | Partial | Oura, WHOOP, Garmin, Fitbit, Dexcom adapters, Health Connect and HealthKit bridges, all inert until developer credentials exist. No Withings, no Samsung. Libre needs an Abbott partnership. |
| 18.5 CGM | Partial | Dexcom import, time-in-range, dedupe index. CGM glucose deliberately skips the red-flag engine (reading every 5 minutes). Paid two-week programme: Missing. |
| 18.6 Single-lead ECG | Partial, shape differs | `ecg_report_*` tables: upload plus AI extraction, abnormal links to a clinician alert, no judgement shown. No device connector, no `device.alert`. |
| 18.7 Inhaler sensors | Missing | |
| 18.8 Tarragon band | Missing, correct | D-22 pauses purchasing. D-22 is in the spec only, not in `docs/DECISIONS.md`. |
| 18.9 Source label and plausibility | Built | `vitals_readings.source`, `device_id`, `validation_status` and `validation_flags` (duplicate, sudden change, insufficient context), wearable `isPlausible()`, source-lock trigger. Limits follow OQ-66. |
| Acceptance: cross-source dedup | **Missing** | Only per-source partial unique indexes. Same reading from Health Connect and a BLE cuff is stored twice. |
| Acceptance: irregular rhythm becomes a task | Partial | ECG path reaches `clinician_alerts`, not a typed `device.alert` task event. |
| Events, `DeviceSource` interface | Missing | No `device.*` events; nearest interface is `lib/wearables/providers`. |

### Module 19: checkout and payments (S71, S72)

| # | Status | Live shape and gap |
|---|---|---|
| 19.1 pay per item | Partial | Only Membership is in the v5 catalogue. Consultation, test, home kit and device are not. Legacy per-domain checkouts still live (OQ-23). |
| 19.2 card, transfer, USSD | Partial | No `channels` parameter set; behaviour follows Paystack dashboard defaults. `order-reconcile` catches late transfer and USSD. Pending-state copy unverified. |
| 19.3 naira, one price list | Built | Bigint kobo, NGN only. |
| 19.4 pay for a loved one | Built, dormant | S29 `pay_for_care`, `create_order(p_beneficiary)`, gifted pack waits for the patient's yes. OQ-192 must be fixed before real grants. |
| 19.5 sponsor-paid shown as paid | Missing | `patient_memberships.source` has `employer` and `voucher` but nothing writes them. |
| 19.6 HMO eligibility | Missing | |
| 19.7 itemised fee | Partial | Components must sum to the amount; processing fee is a labelled estimate. Clinician or partner vs Tarragon split depends on seeded components. |
| 19.8 receipts, refunds | Built on web, partial on mobile | `my_orders`, `/patient/receipts`, refund request, admin decision, daily provider refund and GL reversal. Mobile refund screens deferred. |
| 19.9 points at checkout | Missing, blocked | OQ-08. |
| 19.10 instalments | Missing | |
| 19.11 Community Access Fund | Missing | No `donations`, `access_fund_grants`, `donation.received`. |
| 19.12 entitlements view | Built | `entitlements`, `EntitlementsCard`, expiry and reminder crons. |
| 19.13 payment requests | Missing | S29 is supporter-initiated, not a patient-sent link. |
| Events | Partial | `order.paid` emitted once per order. `sponsor_entitlement.granted` and `donation.received` missing. |

### Module 20: pricing engine (S73)

| # | Status | Gap |
|---|---|---|
| 20.1 catalogue | Partial | `catalog_items` and `prices` built (versioned, immutable, no-overlap). Only Membership seeded. No sponsor programme items. |
| 20.2 subscriptions off | Differs from spec | `subscription_plans` retired 2026-09-02. Six Paystack Plan codes still need disabling by hand in the dashboard. No admin-audited "enable" object to satisfy the acceptance test. |
| 20.3 no auto-renew | Built | No `auto_renew` column; proved structurally. |
| 20.4 discount, cohort, hardship | Missing | Legacy `promo_codes` is from the old platform and is not order-linked. |
| 20.5 price books | Missing | Analogues: employer packages, payer plans. |
| 20.6 what is included | Built inside the shop | `description_key` and `included_keys`; no per-item route. |
| 20.7 two institutional products | Missing | |
| `price-quote`, `price.changed` | Missing | `create_order` takes the current price with no sponsor, cohort, points or discount layer. |

### Module 21: partner network and commerce (S74)

| # | Status | Gap |
|---|---|---|
| 21.1 labs | Built (S27, applied) | Panels, results state machine, own-order write rule, sensitive-positive tier in the DB. Missing: home test kits, `LabResultsSource`. Ranges are PROPOSED and unsigned (OQ-176). |
| 21.2 pharmacies | Partial (S28, S28c) | Collection code, partial dispense, batch and expiry. No price list (OQ-283, by decision), no verified sourcing, no pharmacist chat, no mobile collection screen. Licence verification and a login needed before first send (OQ-274). |
| 21.3 clinics | Partial | `provider_org_*` tables exist. Booking calendar and practice software not evident. |
| 21.4 HMO | Missing, constrained | Eligibility and billing not built. Capitation banned (I8). |
| 21.5 device shop | Partial, conflicted | Catalogue is guidance. No `shop_orders`, delivery or warranty. |
| 21.6 partner portal | Partial | Bookings and results yes. No partner-facing invoicing or settlement screen. |
| 21.7 quality rules | Partial | Licence tracking and lab turnaround alerts exist. No `partner_quality`, no removal by rule, no events. |
| Settlements | Missing | S30 and S31 cover clinicians only. `payouts_enabled` is off. |

### Module 22: outcomes and analytics (S75)

| # | Status | Gap |
|---|---|---|
| 22.1 baseline and follow-up | Partial | BP only, 90-day report. No 180-day report, HbA1c, weight, PHQ-9, GAD-7. |
| 22.2 adherence, engagement | Partial | Stored beside BP, never inside it. No retention or completion metric. |
| 22.3 risk stratification | Built | Deterministic `risk_scores` with reasons, worklist, override, fairness page. No ML `risk-model`. 0 scores in production (nobody is a current member). |
| 22.4 accuracy dashboard | Built, empty | Measures agreement with the automatic grade, not accuracy against outcomes (OQ-255). |
| 22.5 monthly report | Built | Write-once, Care Circle `monthly` block, neutral notice. |
| 22.6 sponsor dashboards | Built | Cohorts, consent, frozen monthly figures. Min-cell not single-point (finding 6). |
| 22.7 response times | Not delivered by S38 | S36e SLA dashboard may cover part; verify. |
| 22.8 data quality | Partial | Block inside the BP report only. |
| 22.9 exports | Built | Audited CSV. No separate renewal-report product. |

---

## 3. Comparison to full competitor products

### Module 18

| Product | What the full product does | Tarragon today | Verdict |
|---|---|---|---|
| Withings (recall) | Own connected BP cuffs, scales, watches with cleared ECG, one app, a clinical remote-monitoring arm. | BLE for standard GATT devices only. | Behind on the closed ecosystem, ahead on openness. Adopt the Withings API as a second route after Health Connect, not before. |
| Omron Connect (verified) | Companion app; data from Omron devices can be shared to Health Connect. | Reads Health Connect. | Best Nigeria path: patients buy Omron locally, Omron app writes to Health Connect, Tarragon reads it. No BLE pairing needed. Make this the headline route. |
| DarioHealth (recall) | Plug-in glucose meter, coaching, B2B outcomes-based contracts. | Manual and BLE glucose. | Sells hardware plus a programme. Tarragon cannot copy the hardware. |
| Oura, WHOOP, Garmin, Fitbit (recall) | Passive sleep, recovery, HRV scores. WHOOP reportedly received an FDA warning over a blood-pressure feature. | Adapters built, no credentials. | Keep wellness wearables informational. Do not derive clinical claims. Existing "Wearable estimate" badge is right. |
| Levels, Stelo, Lingo (verified) | Levels about $15 a month plus about $89 sensors; Stelo $99 for two sensors; Lingo about $49 per sensor. | Dexcom import only. | Naira price, import duty and sensor supply are the unknowns. A paid programme cannot exist until a sensor can legally and affordably reach the patient (decision D8). |
| KardiaMobile (recall) | Cleared single-lead ECG with its own AF result. | PDF upload plus extraction. | Our upload path already matches "show the device's own result, route abnormal to a clinician". Vendor API access is partner-gated (unverified). |
| Propeller Health (recall) | Inhaler sensors for adherence and attacks. | None. | Defer: asthma is not a core pathway, and no Nigerian distributor exists. |

Where Tarragon already leads: source-lock trigger, plausibility flags, granular per-category consent and delete-my-data, clinician-cleared validation flags.

### Module 19

| Product | What the full product does | Tarragon today | Verdict |
|---|---|---|---|
| Paystack (verified) | Card, bank transfer ("Pay with Transfer" account numbers), USSD for several banks. | Paystack wired; channels not set explicitly. | Set channels per order, show a clear "pending" state for transfer and USSD. |
| mPharma mutti+ (verified) | Subscription of about ₦1,000 a month, free consultations and tests, 150 medicines, interest-free "heal-now-pay-later". | Membership at ₦100,000 a year, dormant. | Price anchor to bear in mind. Instalments are expected in this market, so 19.10 matters for adoption. |
| Reliance HMO (verified) | Monthly, quarterly or yearly plans from ₦3,500 to ₦148,500, 24/7 telemedicine. | No HMO integration. | Eligibility needs a manual or partner route; no public API is known. |
| Omada, Personify (recall) | Employer-paid access shown as covered; wellness incentives. | Sponsor cohorts for reporting, not payment. | Sponsor-paid (19.5) completes the loop S38e started. |
| Insight Timer (spec reference) | Free tier supported by community. | None. | Access Fund is a custom design; no competitor to copy. |

Where Tarragon already leads: order-linked refunds with GL reversal, no stored balance, a supporter-pays flow with patient consent for gifts.

### Module 20

Omada sells per-member-per-month contracts with outcome reporting (recall). Calm and MyFitnessPal run self-serve subscriptions (recall). Tarragon's Membership model sits between. The lesson from both is clarity of "what is included" and no dark-pattern renewal, which Tarragon already enforces structurally. Gap: contract-grade institutional price books and a quote function that explains each line.

### Module 21

| Product | What the full product does | Tarragon today | Verdict |
|---|---|---|---|
| Doctolib (verified, partner docs) | Partner API for calendars, visit reasons, slot search, reservation, patient management. | Clinic org tables, no calendar API. | Model the clinic booking interface on a calendar and slot contract, but keep it behind a Tarragon adapter. |
| Practo, Helium Health (recall) | Practice software plus patient marketplace. | None. | Practice software is a different product. Offer clinic partners a booking calendar only. |
| mPharma (verified) | 320+ facilities, membership, chronic price certainty. | Pharmacy flow with no prices shown (OQ-283). | Not a gap to chase until a price decision is made. |
| Everlywell, LetsGetChecked (verified, LGC) | Kit shipped, self-collect, lab analysis, results online with clinician follow-up. | Scaffold only. | Kit logistics need a logistics partner and D-06 treatment. Start with one kit only. |

### Module 22

| Product | What the full product does | Tarragon today | Verdict |
|---|---|---|---|
| Omada (recall) | Client reporting from standard dashboards to executive reviews, outcome claims for employers and insurers. | Frozen monthly sponsor figures, suppression, no causal claims. | Ahead on privacy discipline. Behind on breadth (one pathway). |
| Lark (recall) | Multi-condition coaching with published outcome studies. | BP only. | Add pathways only as fast as clinical sign-off allows. |
| Innovaccer, Health Catalyst (verified, Innovaccer) | Risk stratification and predictive models for care teams. | Deterministic, explainable scores, audited worklist. | Keep deterministic until 90 days of real data (founder decision). |
| Ada (recall) | Published validation studies. | Agreement review, not accuracy. | Do not market accuracy. Build outcome-linked accuracy (OQ-255) before any claim. |

---

## 4. Decisions needed before building

| ID | Decision | Recommendation |
|---|---|---|
| D1 | Device shop (21.5) vs the 2026-08-02 no-import decision and the 2026-09-10 "guidance, not commerce" migration. | Do not import or hold stock. Build `shop_orders` only for partner-fulfilled items where a distributor is seller of record, ships and warrants. Band stays paused; record D-22 in `DECISIONS.md`. |
| D2 | Points at checkout (19.9) vs OQ-08. | Points unlock a single-use, order-bound reduction on Tarragon's own service fee only, never a partner or clinician fee, never convertible to a balance. Remove the kobo conversion in the same session. |
| D3 | Instalments (19.10). | Use a licensed instalment partner who carries the credit risk, shown only where available. Tarragon never lends. Counsel to confirm. Do not use Paystack auto-charge plans (dark-pattern and INV-09 risk). |
| D4 | Access Fund legal vehicle and OQ-07. | Counsel opinion first (fund holder, tax status). Design so a donation is a restricted gift recorded against a grant for a named item, never a user balance. Public report uses the minimum-cell rule. |
| D5 | 20.2 subscriptions. | Do not rebuild `subscription_plans`. Satisfy the acceptance test with an admin-only, audited enable toggle on the Membership item and a go-live guard, and finish disabling the six Paystack Plan codes. |
| D6 | HMO eligibility (19.6, 21.4). | Adapter interface with a manual verification fallback that ops completes against the HMO portal. Store only a hashed member number. No capitation, no HMO billing. |
| D7 | Minimum-cell rule. | One database function used by every aggregate surface; retire the TypeScript-layer thresholds. Counsel to confirm 20 (OQ-233). |
| D8 | Paid two-week CGM programme (18.5). | Hold until sensor sourcing is decided (patient-supplied or partner-fulfilled), a price in naira is set, the CMO owns the protocol, and the existing "no auto glucose triage on CGM" choice is reviewed. |
| D9 | Photo capture (18.3). | On-device text recognition first (no data leaves the phone, works offline, no AI governance exposure). The user always confirms every number. Server-side vision only if on-device accuracy proves too low, and then through `runGovernedAi()`. |
| D10 | Cross-source dedup rule (18.9). | Match on patient, type, value and a time window. A clinical device or manual entry outranks a wearable estimate. Keep both rows linked, show one. |
| D11 | Partner settlement scope (21.6). | D-06 means labs owe nothing. Settlements apply only where Tarragon collects and owes a partner (sponsor-paid items, any pharmacy margin). Keep separate from S31 clinician payouts. |
| D12 | ECG (18.6). | Upgrade the existing report upload and add the HealthKit ECG classification read. Do not pursue a vendor API until one is offered. |

---

## 5. Build plan

Order of work is by risk, then dependency. Each session still follows its own prompt (research file, design note, build, prove, progress entry). Every new table gets RLS tests per role plus a sabotage step, and `is_test` filtering (INV-13).

### Pre-work (small PRs, start now)

| # | Item | Why | Proof |
|---|---|---|---|
| P1 | Fix OQ-192: restrict `create_order` payer and the old read paths to Care Circle members with the right permission. | Money and PHI exposure before real grants | DB test: a bare `profile_access` grantee is refused. |
| P2 | Remove the kobo conversion in wellness points (OQ-08 finish). | INV-09 | Test: no path turns points into kobo. |
| P3 | Record D-22 in `docs/DECISIONS.md`; add open questions for D1 to D12. | Decisions sit only in the spec | Doc check. |
| P4 | Confirm which S29c, S29d and S36g migrations are applied. | Audits could not tell | Read-only SQL. |
| P5 | Disable the six leftover Paystack Plan codes (founder action). | Retired plans still chargeable | Dashboard check. |

### S70: devices and wearables

Goal: make capture effortless and trustworthy; close the module's own acceptance tests.

1. **Cross-source dedup (18.9, acceptance test).** `private.link_duplicate_reading` on insert into `vitals_readings` (D10). A `duplicate_of` link, never a delete. Test: Health Connect and BLE copies of one reading show once and both rows persist.
2. **Events (module events).** Register `device.synced` (ids and counts only, no values) and `device.alert` in the S10 bus. ECG and abnormal device alerts emit `device.alert`, which creates a clinical task, not a patient diagnosis. Patient notice stays neutral (INV-07).
3. **DeviceSource interface.** Wrap the existing provider adapters behind one typed interface so Withings and Samsung are additions, not rewrites.
4. **Photo capture (18.3).** Mobile camera, on-device text recognition, a confirm screen showing the photo beside editable numbers, type picker. Saved as `source = 'device'` with a `photo_confirmed` flag, then through the normal plausibility and triage path. Low-light and seven-segment LCD fail gracefully to manual entry. Pidgin strings via `packages/i18n`.
5. **Recommended devices (18.2).** In-app screen from `device_catalog`: which Omron and Accu-Chek models work by Bluetooth, which via Health Connect, with the distributor name. Seed only founder-supplied distributors. Manual entry shown first-class.
6. **Wearables (18.4).** Withings through its API and Samsung via Health Connect (Samsung Health already writes to it). No credential is invented; flows stay "not yet available" until real keys exist.
7. **ECG (18.6).** Keep upload and extraction. Add HealthKit ECG classification read on iOS. Show only the device's own result text; abnormal or inconclusive goes to a clinician task. No algorithm of ours.
8. **CGM (18.5).** Add a clinician-reviewed 14-day summary (time in range, variability) as a document. The paid programme waits for D8.
9. **Inhaler (18.7) and band (18.8).** Not built. Add the `DeviceSource` slot and record why (no distributor; D-22).
10. **Real-device test.** Buy one UA-651BLE and one Accu-Chek Guide and pair with an EAS build before the supported list is published (existing rule).

Acceptance: duplicate readings de-duplicated; irregular rhythm creates a task and no patient-facing diagnosis; device values triaged like manual ones; devices never required.

### S71: checkout and payments, part 1 (19.1 to 19.7)

1. **Catalogue breadth (19.1).** Add consultation, lab panel and home kit items to `catalog_items` as the founder prices them. Route the legacy per-domain checkouts through `create_order` as a later, separate step (OQ-23).
2. **Channels (19.2).** Pass `channels` explicitly (card, bank transfer, USSD, Pay with Transfer). Show an honest "waiting for your bank" state; reconcile sweep already exists. Tested with Paystack test keys.
3. **Itemised fee (19.7).** Seed components as clinician or partner fee, Tarragon service fee, processing estimate. A checkout summary that shows each line in plain words, and a test that the lines sum.
4. **Sponsor-paid (19.5).** New `sponsor_programmes` (sponsor, catalogue items, rules, budget in kobo) that issues an order-bound entitlement with no payment step. UI says "Covered by your employer" or the sponsor's name; never a payment screen. Event `sponsor_entitlement.granted`. Reuses S38e cohort codes and consent. This is the order-linked rebuild OQ-07 asked for; counsel before live use.
5. **HMO eligibility (19.6).** `hmo_eligibility_checks` (hashed member number with the HMAC pattern from OQ-223), adapter interface, manual ops verification fallback (D6). A pass grants a sponsor entitlement; a fail shows how to pay normally. No capitation.
6. **Pay for a loved one (19.4).** Already built; add the foreign-card fee line and test with a foreign test card.
7. **Guard.** Wire a `checkout_enabled` condition to the S37 go-live guards so the OQ-184 gap closes. Nothing is switched on.

Acceptance: a sponsor-paid item never shows a payment step; itemised lines sum; refused when v5 checkout is off.

### S72: checkout and payments, part 2 (19.8 to 19.13)

1. **Receipts and mobile (19.8).** Mobile receipts, history and refund request, matching web.
2. **Points (19.9).** Per D2, after P2.
3. **Instalments (19.10).** Provider hook behind a flag, per D3. If no partner is signed, ship the interface and leave it off.
4. **Community Access Fund (19.11).** `donations` and `access_fund_grants`, published criteria, an operations approval function, donation page, public report with minimum-cell suppression. A grant creates an order-bound sponsor entitlement. Event `donation.received`. Test: a donation cannot be spent as a balance by anyone, including the donor. Blocked on D4.
5. **Entitlements (19.12).** Add the sponsor and grant sources to the existing card; "valid for 60 more days" wording; mobile parity.
6. **Payment requests (19.13).** `payment_requests` (item, beneficiary, expiry, single use). The patient picks a supporter or shares a link through the phone's own share sheet. The link opens guest checkout showing only a generic item name and amount, never a condition (INV-07). Expires; cancellable; payer sees the itemised fee. Not a WhatsApp integration (removed, F-02).
7. **Close-out.** Confirm both module acceptance tests and the refund proof still pass.

### S73: pricing engine

1. **`price_quote()` in SQL**, with a thin edge wrapper (`price-quote`). Inputs buyer, beneficiary, item; order of application: base price, institutional price book, cohort or hardship, sponsor coverage, discount code, points. Never below zero, never below partner cost, one stacking rule documented, a line-by-line explanation returned. `create_order` calls it so quote and charge cannot differ.
2. **Versioning.** `price.changed` emitted by `set_item_price`; orders store the price version used (INV-16).
3. **`discount_codes`.** Order-linked, caps, expiry, per-person limits, audit. Retire legacy `promo_codes` after the OQ-173 removal session.
4. **`price_books`.** Institutional per-member rates for employers and HMOs, effective-dated, referenced by the sponsor programme.
5. **Cohort and hardship pricing.** Cohort via sponsor programmes; hardship only through Access Fund grants (depends on S72).
6. **Subscription toggle (D5).** Admin-only, audited enable on the Membership item plus a go-live guard; no new plan table.
7. **Institutional products (20.7).** Two catalogue kinds: protocol-only per covered life and concierge coordinator (off). Pricing in a price book, no free-text.
8. **What is included.** Standalone route per item built from existing keys, reachable from the order summary and share-safe.

Acceptance: enabling the subscription item needs the admin role and is audited; quote equals charge for 10 seeded scenarios.

### S74: partner network and commerce

1. **Quality engine (21.7).** `partner_quality` (turnaround target and actual, complaint count, licence expiry, score) with PROPOSED weights in versioned config; scheduled job; events `partner.quality_breach`. Removal by rule reuses the S20 `remove_ineligible_from_work()` pattern: automatic suspension from new work, CMO or ops reinstatement with a reason.
2. **Settlement (21.6, D11).** `settlements` and `settlement-run` monthly, `partner.settlement_due`. Partner-facing statement and invoice screen. No lab settlement (D-06). Separate from S31 payouts; a test that no row is paid twice across the two systems.
3. **Labs (21.1).** `LabResultsSource` interface with a manual-entry implementation and an API stub; one home-collection kit end to end (the scaffolded kit) after a partner and D-06 treatment are agreed. Confirm the cross-lab write refusal is asserted verbatim in a DB test.
4. **Pharmacies (21.2).** Verified sourcing flag (NAFDAC-registered source on the partner and on dispensed batches). Pharmacist chat in-app only. Price list stays off (OQ-283) unless the founder reverses it.
5. **Clinics (21.3).** Booking calendar contract for clinic partners (slots, reservation), no practice software.
6. **HMO (21.4).** Eligibility from S71; sponsored services via programmes. State in code and docs that capitation is out.
7. **Device shop (21.5, D1).** Partner-fulfilled `shop_orders` with delivery state and warranty claims, validated devices and CGM sensors only; the band row exists but stays hidden under D-22. Coordinate with the home-delivery removal session so no courier code returns.
8. **Portal.** One partner-facing view of bookings, results, invoices, statements.
9. **Hygiene.** Every new view filters `is_test`; partner reads of patient results are audited (INV-10).

Acceptance: a lab cannot enter results for another lab's order; breach thresholds suspend by rule; settlement totals tie to the ledger.

### S75: outcomes and population analytics

1. **Single suppression function.** `private.suppress_cell()` (counts, rates, complementary suppression, small-month rule) used by every aggregate surface; move the BP report, sponsor report, S38f held-back rule, risk distribution and corporate dashboards onto it. Reconcile `organisations.min_cohort_size` with `min_cell`. Add the acceptance test as a rolled-back proof with a sabotage step.
2. **Pathways (22.1).** Snapshot types for HbA1c change, weight change, PHQ-9 and GAD-7 change, plus the 180-day BP report. PROPOSED thresholds in config; CMO sign-off before display. Only pathways with real data are shown.
3. **Adherence and retention (22.2).** Retention and programme completion, kept in a separate family from clinical outcomes (waits on S26 entitlement data, which now exists).
4. **Response times (22.7).** Verify what S36e covers; add escalation and follow-up rates and clinician response times by tier, no per-clinician league table.
5. **Accuracy (22.4).** Outcome-linked measure: triage grade vs what the care team ultimately recorded (OQ-255). Label the current dashboard "agreement", not "accuracy". No marketing claim.
6. **Data quality (22.8).** Standalone missing-data report across snapshots, sources and sync lag.
7. **Sponsor reports (22.9).** A pilot and renewal pack (PDF plus CSV) with the evaluation-design note and "no causal claim" wording enforced; audited export.
8. **Risk model (22.3).** Stay deterministic. Revisit an ML `risk-model` after 90 days of real snapshots, through the AI governance registry.
9. **Legacy.** Fix OQ-39 (56 `analytics_*` RPCs ignoring `is_test`) or retire them.

Acceptance: aggregate view under the minimum cohort returns suppressed values, proven on every surface; no causal wording in any export.

---

## 6. Sequencing and parallelism

1. P1 to P5 now (independent, small).
2. Decisions D1 to D7 answered; D4 and D8 need outside input (counsel, sensor supply).
3. S73 first among the commerce sessions (its `price_quote()` is what S71 and S72 call), then S71, then S72.
4. S75 can run in parallel with any of the others (separate tables, separate worktree).
5. S70 is independent and can run in parallel. Its real-device test needs hardware purchase.
6. S74 after S71 (eligibility, sponsor programmes) and after the home-delivery removal merges.
7. All sessions depend on S40 (Stage 1 gate). Per project memory that gate is not yet closed, so these remain planning until `docs/BUILD-PROGRESS.md` starts with "Stage 1 complete".

Rough relative size (engineering only): S70 medium, S71 medium, S72 large (Access Fund, requests), S73 medium, S74 large, S75 small to medium. Items that need people, not code: counsel (OQ-07, Access Fund, instalments, min-cell), HMO and distributor contracts, CMO sign-off on new outcome thresholds and any CGM protocol, sensor sourcing, developer credentials for wearables.

## 7. Items to log in `docs/OPEN-QUESTIONS.md`

Check numbering first: OQ-180 to OQ-185 are used twice.
- D1 to D12 above.
- D-22 missing from `DECISIONS.md`.
- Minimum-cell rule has several enforcement points and two thresholds.
- Cross-source dedup absent (module acceptance test).
- CGM glucose skips red-flag assessment: confirm with the CMO.
- Points conversion code still present after OQ-08.
- Six Paystack Plan codes still live.
- No OQ yet for HMO eligibility, instalments, Access Fund, payment requests, price books, `shop_orders`, `partner_quality`, photo capture.

## 8. Limits of this review

- Code and migrations only. No live database state was checked beyond what BUILD-PROGRESS records; P4 matters.
- Some "Built" ratings come from migration names and grep, not full reads. S36e, S36g and S31 were not opened in detail.
- Web checks were thin. Withings, Dario, Kardia, Propeller, Omada, Lark, Ada and Practo claims are from recall and unverified. Pricing figures (Levels, Stelo, Lingo, mutti+, Reliance) are from public pages and may be out of date or in other currencies.
- No store pages or screenshots were opened. Design and UX comparisons are therefore not made.
- Peer sessions are analysing overlapping ranges (S66 to S70, S75 to S80); reconcile if their plans touch the same tables.
