# Decisions waiting on you — 2026-09-05 audit

Everything in this list was found during the platform audit and **deliberately not
changed**, because each needs your judgement (clinical, financial, or product) rather
than an engineering fix. Each entry states what was verified, what the options are, and
what happens if nothing is decided.

Engineering fixes from the same audit are on `fix/platform-audit-20260905` (PR #489).

---

## A. Clinical, needs a Clinical Director

### A1. The active escalation SLA config contradicts itself
`escalation_slas` v7 is the one active row and drives `sla_due_at` on every
abnormal-result alert on the platform. It has `is_active = true`, `approved_by` set and
`approved_at = 2026-09-04 21:27`. Its own `notes` column ends: *"Unsigned draft: not in
force until a Clinical Director signs it."* Several entries **inside** that active config
also still read "DRAFT, needs Clinical Director sign-off" (`spo2_vitals_red_flag` red and
amber, `temperature_vitals_red_flag` red and amber).

Either it was properly signed and the notes were never updated, or it was activated by a
path that bypassed signing. Only you can say which. **Nothing was edited**: a sign-off
represents a human's judgement and altering one is exactly what the governance module
exists to prevent.

*If nothing is decided:* the platform keeps running on a config whose own record says it
is not in force, which is the worst state for an audit.

### A2. The BP emergency threshold is less sensitive than your own signed pathway
Live `private.classify_bp_level` sets emergency at `diastolic >= 120 OR systolic >= 200`.
The Hypertension pathway (`guideline/Tarragon_Health_Hypertension_Pathway_Gap_Closure_Plan.md`,
from TH-CP-HTN-001 §15) specifies **>=180/120** as EMERGENCY, and
`packages/lifestyle-engine/src/adapters/htn.ts:25` implements the guideline value. So this
is drift between two live implementations, not a reading error.

**The gap is systolic 180-199 with diastolic 100-119.** A patient logging 190/110 is
classified `red`, not `emergency`, so no `emergency_events` row is created: no
acknowledge-gated hospital guidance, no emergency-contact notify, no follow-up check-in.

Either move the classifier to 180, or record a signed clinical rationale for deviating
from your own pathway. This was not changed because it is a clinical threshold.

### A3. Red-flag symptoms never reach the emergency safety net
Live `private.handle_symptom_red_flag` raises a `clinician_alerts` row only. It never
inserts into `emergency_events`. The hypertension pathway requires "any red-flag symptom
at any BP → EMERGENCY". So a patient logging chest pain at severity 10 gets a Priority 1
clinician alert, and **no** patient-facing emergency dialog, no emergency-contact notify,
no follow-up.

Note the one-touch danger checklist and the triage engine both DO write `emergency_events`
correctly, so this handler is the outlier. Whether a self-reported symptom should trigger
the full emergency net is a clinical call.

### A4. The vitals red-flag thresholds are live and unsigned
`docs/protocol-drafts/vitals-red-flag-thresholds.md` is ready to paste and its tables match
the live DB classifiers exactly. No signed record exists. The draft's own words call this
"the highest-consequence unsigned logic on the platform".

### A5. Two SLA pathways need signing
- **`pulse_vitals_red_flag` is registered in no version of `escalation_slas`.** An unsigned,
  inactive draft is queued on this branch (v8) transcribing the handler's own hardcoded
  60 min / 4320 min. Until signed, pulse alerts notify on the default push/whatsapp/sms
  ladder and cannot hop further. A signed config was deliberately not retired to make room.
- **`symptom_triage` was registered by draft v6, but signed v7 was built from v5 and dropped
  it.** `private.handle_symptom_triage_assessment` calls
  `escalation_sla_minutes('symptom_triage', ...)`, which raises. Masked only because the
  symptom checker is off; it breaks the moment you switch it on.

### A6. The first real BP emergency alert cannot be acknowledged by anyone
`htn_alert_attestation_gate` is live and enabled, and `pathway_attestations` has **zero
rows platform-wide**. Any clinician acknowledging a BP-sourced `clinician_alerts` row is
rejected. It has not fired only because no BP-sourced alert has ever existed.

### A7. A PSA result cannot be recorded without a pre-existing shared-decision record
`private.enforce_psa_sdm_gate` refuses the insert if no `patient_shared_decisions` row
exists. A patient who had a PSA done privately and brings back 45 ng/mL cannot have it
recorded until someone back-fills an SDM row. A gate that is right *before ordering* is
being applied *after the result physically exists*.

### A8. Severe hyperglycaemia without ketones has no database backstop
`private.handle_glucose_emergency_backstop` fires only on `< 3.0` or `>= 11.0` with raised
ketones. The `>= 20.0` very-high tier exists only in TypeScript, whose `emergency_events`
insert is unchecked and whose "latest glucose" is the newest row by `taken_at`, so a
backdated device or CGM reading is evaluated against a newer one and the dangerous new
value is skipped.

### A9. Emergency dedup can swallow a deteriorating reading
Every emergency insert is suppressed when an `active` same-source event exists within 6
hours (3 for glucose). SpO2 85 raises an event; two hours later SpO2 70 produces no new
event, no re-notification and no escalation. The patient still sees the standing dialog,
but the care team never learns it worsened. Clinically this is a judgement call about
re-alerting versus alert fatigue.

---

## B. Financial

### B1. Refund reversals post to the wrong accounts
`private.finance_post_from_payment`'s refund branch always posts **Dr 4900 (contra-revenue)
/ Cr 1020 (cash)**, regardless of what the original charge posted. For plain revenue that
is defensible. For charges whose original credit was a **liability**, it is not:

| Original charge | Credit left standing after a refund |
|---|---|
| Care voucher | Cr 2100 customer prepayments |
| Partner-billed lab order | Cr 2700 partner lab funds payable |
| Partner-billed pharmacy order | Cr 2710 partner pharmacy funds payable |
| Service purchase with a duration | Cr 2000 deferred revenue |
| Sponsored purchase with a duration | Cr 2000 deferred revenue |

Worst is the deferred-revenue group: the charge also creates a
`revenue_recognition_schedules` row, and the monthly recognition cron keeps releasing
2000 → 4020 **after the money has gone back to the patient**. Nothing in the refund path
touches that table.

The books balance; the accounts are wrong. Which accounts a reversal should hit, and
whether a refund should cancel or prorate the recognition schedule, is your call. The new
idempotency key embeds the original charge reference, so the branch can now correlate back
to what it is reversing once you decide.

### B2. Four screening products are priced but unsellable
`cancer_screen_cervical_under30` ₦62,000, `cancer_screen_cervical_30plus` ₦222,500,
`cancer_screen_men_45plus` ₦310,500, `cancer_screen_women_45plus` **₦432,500**. All active,
all publicly priced through the anon `public_price_list()` RPC, **referenced by zero code**,
inserted 2026-09-03 by PR #469 which is still open. They also contradict the public "you
pay the lab, Tarragon takes no cut" promise.

For scale: ₦432,500 is about 6.6x a full annual Avon HMO premium and roughly 6.8 years of
the average Nigerian's entire out-of-pocket health spending. The driver is a single
outlier in the source price list, where FIT alone is ₦161,600 (37% of that package).

The pricing page no longer claims to be a complete list. Whether these SKUs should exist
is a product decision.

### B3. The AI Coach pass loses money on every sale
`ai_coach_daily_pass_30d` sells 100 Claude-backed messages a day for 30 days at ₦5,000.
At the token profile in your own `docs/AI_COST_ANALYSIS.md`, 3,000 turns costs roughly
₦21,300. Break-even is about **23 messages a day, a fifth of what is advertised**. Meter
it, cut the cap to 30/day, or price it at ₦20,000.

### B4. A video visit has two live prices
`service_products.video_visit_credit` says ₦5,000; `video_visit_prices` says ₦10,000. Which
one a patient pays depends on which of two booking paths they take, and the two paths do
not share a credit, so a patient can buy the credit and then be charged again. Lagos market
for a 15-minute private visit is about ₦16,000. Pick one.

### B5. Retired subscription plans are still active at Paystack
7 `subscription_plans` rows are still `is_active`, 6 with live `paystack_plan_code`s. A
migration deactivating the rows is on this branch, but **Paystack has no delete for a
Plan** — the Plan objects themselves need disabling in the Paystack dashboard, which only
you can do.

---

## C. Product

### C1. Programme buyers will now get an annual review
Fixing the doctor-time entitlement meant deciding where `annual_review` belongs. It went
with the doctor-time features, so 12-week programme buyers will have one opened for them.
It was previously bundled into the retired Complete Care and was orphaned: it appeared in
neither the free nor the paid list, so `private.queue_annual_reviews` scheduled nothing for
anyone and `/clinician/annual-reviews` would have drained to zero permanently. Confirm the
new placement is what you want.

### C2. A patient cannot buy the recurring product
`useEnrolChronicProgramme` carries its own comment that enrolment is clinician-initiated
because the insert RLS is org-staff-only, and the ₦50,000 upsell only renders once a
clinician has already enrolled someone on the free track. With one doctor, that funnel has
never fired. `chronic_programme_enrolments` has zero rows.

Separately, no `chronic_condition_programmes` row has a `price_kobo`, so the
`programme_purchases` route is unpurchasable; the working route is `service_purchases`.

### C3. Patient-uploaded lab results raise no alert unless the patient has paid
`private.handle_lab_result_document` computes review access from a non-cancelled
`lab_orders` row or an active `programme_purchases` row. If neither exists it sets
`clinician_alert_id := null` and raises **no alert**, and a `source='patient'` upload gets
no patient-facing notification either. Under the self-arranged-fulfilment model, uploading
a PDF from any lab is the expected path for most patients.

The document does still appear in `/clinician/results-inbox`, so it is not lost, but it is
an untimed, unprioritised list entry rather than an alert. If the paid gate is intended,
say so at upload time rather than silently no-oping. If not, always raise the alert and
gate the *reply*.

### C4. No clinician has a phone number
0 of 7 clinician profiles (in fact 0 of 38 profiles of any role) carry one. Push and in-app
paging now work after this branch's fixes, but every WhatsApp and SMS hop below them in the
critical ladder is a no-op until these are filled in.

---

## D. Known-broken, low risk, listed so it is not rediscovered

- **`public.run_patient_duplicate_detection()`** gates on `current_user <> 'service_role'`
  inside a SECURITY DEFINER function owned by `postgres`, where `current_user` is the
  owner. Its service-role cron caller is therefore locked out, which is the exact failure
  its own migration was written to prevent.
- **`packages/db/tests/red_flag_handlers_notify_phoneless_clinicians.sql`** aborts against
  live because it filters the entitlement product on `is_active`, and every pack was
  retired on 2026-09-02. It is in `ci.excluded` for that reason.
- **`.env.local` has a malformed `xport VOYAGE_API_KEY=` line**, so the key never loads and
  RAG retrieval silently no-ops locally. Your file, not edited.
- **165 proof scripts in `packages/db/tests/` still do not run in CI**, listed in
  `ci.excluded` with the reason. Seven now run on every push. Moving more up is a backlog,
  a few at a time, each confirmed against a fresh `supabase db reset`.
