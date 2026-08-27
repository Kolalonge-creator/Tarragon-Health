# Clinical Network — Design Spec & Gap Analysis

> **Status: design document, not a build order.** This reconciles an incoming "Clinical Network"
> spec (§4.1–4.18 below) against what actually exists in the codebase as of 2026-08-27, and proposes
> a phased path. It does not itself authorise building the guardrailed pieces — see §3. Subordinate
> to `CLAUDE.md`, which remains authoritative on scope-gating language if the two ever conflict.
> Where this doc's phase labels disagree with `docs/Tarragon_Health_Master_Operating_Plan_v4.md`
> §7/§13 (they do, in places — see §3), treat the disagreement as a signal that the Master Plan
> itself has drifted behind shipped work, not as license to build past `CLAUDE.md`'s explicit
> guardrail without an explicit founder ask.

## 0. What this document is

A "Clinical Network" spec (§4.1–4.18, reproduced in full below) was handed in describing a generic
healthcare-marketplace supply layer: provider directory, credentialing pipeline, availability/
calendar, patient-facing discovery, algorithmic matching/ranking, controlled provider↔patient
messaging, encounter documentation, provider billing/payouts, performance monitoring, multi-location
organisation accounts, a structured service catalogue, referral integration, and capacity management.

Two things needed to happen before any of it could turn into a build plan: (1) find out what of this
already exists — a lot more than a blank slate, it turns out — and (2) check it against `CLAUDE.md`'s
standing guardrail on the specialist-matching pipeline, which several of these sections describe
close to verbatim. Both are done below.

## 1. How this fits the business, and the framing risk to watch

Tarragon's five business categories (`CLAUDE.md` "The Business") all touch this supply layer:
Chronic Disease Management and Prevention need Tier 1–5 doctor review and specialist referral;
Care Coordination *is* this layer (lab network, pharmacy network, specialist referrals, hospital
handoffs); B2B & Institutional needs organisation-level accounts; Platform Infrastructure is the
event pipeline underneath all of it. A well-built Clinical Network is genuinely the connective
tissue between all five — that's not in question.

**The framing risk:** §4.1 lists "doctors, nurses" as network participants alongside specialists and
allied health, and §4.3–4.8 describe verification → availability → matching → ranking → cost as if
every provider on the platform is an independently-onboarded, competitively-ranked marketplace
participant. That is **not** Tarragon's operating model for its own care team. Per
`docs/CLINICAL_TRUST_MODEL_SPEC.md` and the Clinical Tier Ladder in `CLAUDE.md`, Tarragon *employs*
its Tier 1–5 doctors and Care Coordinators; they are assigned to patients by care-team logic, not
discovered/ranked/priced like a marketplace listing. Reading §4.1–4.18 as "rebuild `clinical_staff`
into an open, priced, ranked marketplace" would directly contradict that model and the "Never
re-split the ACCOUNT role" / employed-doctor rules in `CLAUDE.md`.

The reconciliation that avoids that contradiction: **separate "how a provider is discovered/
represented" from "how a provider is employed/paid."** Tarragon's own Tier 1–5 doctors can and
arguably should get a real, structured provider profile (specialty, languages, photo, bio — most of
which `clinical_staff` already has) so patients can see *who* is on their care team, without that
profile ever being priced, ranked against competitors, or bookable outside Tarragon's own assignment
logic. The Clinical Network spec's competitive/marketplace machinery (verification pipeline with
suspension, availability/slots, algorithmic ranking, per-consult billing, provider payouts) maps
cleanly onto the **outer layer** the platform already treats this way: Tier 5 Partner Specialists,
the `specialist_providers` referral catalogue, and institutional partners (hospitals, labs,
pharmacies, HMOs). That outer layer is where §4.1–4.18 is genuinely new scope, not a request to
re-architect the employed care team.

## 2. Section-by-section reconciliation

Legend: 🟢 built and working · 🟡 partially built / schema-only · 🔴 not built · ⚠️ guardrail-adjacent

### 4.1 Network participants — 🟡
Primary care (doctors, nurses) and the 5-tier ladder: 🟢 `clinical_staff`
(`supabase/migrations/20260712191500_clinical_staff.sql` + follow-ons), scoped to Tarragon's own
employed staff — see the framing note in §1, this stays as-is, it is not the gap.
Specialists: 🟡 `specialist_providers` catalogue, 9 rows, all named `[Placeholder] ...` — real table,
no real partner contracts.
Allied health (dietitians, physiotherapists, psychologists): 🔴 no table, no `specialist_type` enum
values for these at all as far as the research found.
Healthcare organisations (hospitals/clinics/diagnostic centres/labs/pharmacies): 🟡 split across
`facilities` (directory, `hospital|lab|pharmacy|radiology|optician|vaccination_centre`), `lab_providers`,
`pharmacy_partners` — all static reference-data rows, admin-maintained, no self-service org account.

### 4.2 Provider profile — 🟡
`clinical_staff` has: name, credential_type/number, specialty, bio, photo, `doctor_tier`,
indemnity fields. **Missing:** subspecialty, qualifications, years_experience, languages, multiple
locations, telemedicine-availability flag, consultation fee/duration (deliberately absent for
employed staff — see §1), hospital affiliations. `specialist_providers` has: specialty, location
(single, not multi), consultation_fee_kobo, state, telemedicine/in-person flags, accepted HMOs,
languages[] — closer to spec shape but still single-location and unverified beyond the license
fields added 2026-07-31.

### 4.3 Provider verification — 🟢 (for employed staff), 🟡 (for partners)
This is the strongest existing piece. `clinical_staff` verification is DB-enforced, not app-layer:
a CHECK constraint blocks `active=true` without `license_verified_at`, a separate trigger blocks
self-verification, indemnity is enforced by tier with a granular exemptions table, and Health
Passport attestation has its own `credential_verified_at`. **Real gap:** no license *expiry* date
anywhere — only a point-in-time `license_verified_at` flag, so there is no re-verification cadence
or expiry-warning mechanism, which §4.3's "expired credentials should trigger warnings and
potentially suspension" explicitly calls for. Partner-side (`lab_providers`/`pharmacy_partners`/
`specialist_providers`/`home_visit_providers`/`logistics_partners`) got `license_type/number/
expires_at/verified_at/verified_by` columns in `20260731011319_partner_regulatory_license_tracking.sql`
— the *columns* exist, but nothing reads `license_expires_at` to warn or suspend yet, and there is
no multi-step onboarding pipeline (identity → registration → qualification → licence → scope →
approval) for any provider type — onboarding today is a manual admin insert.

### 4.4/4.5 Provider availability & calendar — 🟢 (minimal, working), 🔴 (recurring/leave)
Real and functional for Tarragon's own doctors: `consult_availability_slots` +
`book_video_consult_slot` RPC (row-locked, no double-booking), `AvailabilityManager` UI at
`(dashboard)/clinician/availability/`. **Missing:** recurring-availability rules, leave/blocked-time
concepts, per-service duration/buffer config, multi-location slots. The old `appointments` table
(`20260705211129_chronic_disease.sql`) is dead code — confirmed zero references in `apps/web/src` —
do not resurrect it; extend the slot-based system instead.

### 4.6 Patient provider discovery — 🟡
`FacilitySelector` (state/city/geolocation/nearest-first, verified badge) covers facilities
(hospitals/labs/pharmacies/etc.) for lab-test and vaccination booking — genuinely good UX, but not
doctors. `ChooseReferralSpecialist` is the closest analogue for clinicians, but only reachable after
a clinician has already opened a referral, and only surfaces specialty/state/city/telemedicine/HMO
filters — price/gender/language exist as data but aren't exposed as filters in that component.
**Gap:** no general-purpose, patient-initiated "find a specialist" page independent of an existing
referral.

### 4.7 Intelligent provider matching — ⚠️ guardrail, see §3
### 4.8 Provider ranking — ⚠️ guardrail, see §3

### 4.9 Provider communication — 🟢
This one is already a hard platform rule, not just a feature: per-`CLAUDE.md`, all patient↔care-team
conversation is in-app only via `care_messages`/`care_message_threads`
(`MessagesFlow`/`CareMessageThread` patient-side, `/clinician/messages` staff-side), never WhatsApp
— exactly the "controlled Tarragon channels, avoid uncontrolled personal messaging" principle §4.9
asks for, already enforced platform-wide rather than needing new work.

### 4.10 Provider documentation — 🔴
Confirmed clean gap: no structured encounter/SOAP note (reason for encounter, history, exam,
assessment, diagnosis, medication, investigation, referral, follow-up) exists anywhere. What exists
are narrow free-text fields bolted onto workflow tables (`escalations.reason`/`resolution_note`,
`specialist_referrals.referral_reason`/`treatment_plan_note`) and `case_briefs` — an AI-drafted,
read-only, assistive summary card with no write path back into any clinical table, not documentation
of record. This is real, valuable, low-risk-to-build scope with no guardrail conflict — see §4.

### 4.11 Provider billing — 🟢 (infrastructure), 🔴 (provider payout)
Substantial and real: `payment_transactions` (Paystack + Stripe, idempotent, webhook-logged),
`booking_origin` unifying one-off charges across lab/pharmacy/referral bookings, `commissions` — a
trigger-driven ledger auto-recording the moment an order hits `payment_confirmed`, and (Synlab
specifically) a full liability/reconciliation/settlement/refund pipeline
(`partner_billing_collect_and_liability/_transmit/_reconcile_settle_refund`). **Missing:** an actual
payout mechanism to a doctor/specialist per consultation — irrelevant for salaried Tier 1–4 (they
don't get per-consult payouts), a real gap for Tier 5 Partner Specialists and referral-network
`specialist_providers`, which have fee/commission fields but no settlement pipeline analogous to
Synlab's.

### 4.12 Provider performance — 🟡
`analytics_doctor_performance` RPC covers Tarragon's own doctors well (assigned patients,
escalations reviewed, SLA-met %, response log). Lab partners get a real scorecard, including a
self-facing one the `lab_partner` login can see
(`20260730215234_lab_turnaround_sla_stats.sql`). **Gap:** no equivalent for pharmacies,
`specialist_providers`, `home_visit_providers`, or `logistics_partners` — Synlab is the only partner
type with performance tracking today, despite `docs/FEATURE_SPEC.md` §8 naming this for all partner
types.

### 4.13/4.14 Network organisations & organisation administration — 🔴 (for external institutions)
This is the biggest structural gap. `organisations` exists but is Tarragon's own multi-tenancy/RLS
boundary, not a partner-facing account — and a migration comment
(`20260805234029_admin_create_institution_org.sql`) explicitly states clinic/lab/pharmacy partners
are deliberately *not* modeled through it. Only `corporate` and `hmo` org types get real self-service
dashboards today, and those are aggregate/population reporting only (roster, cohort analytics — no
patient-level access, by design, per the I9 founder rule). Labs and pharmacies get a single narrow
login each (`lab_partner`/`pharmacist` roles, three SECURITY DEFINER RPCs scoped to their own orders)
— not a hierarchy where an org admin manages multiple staff, multiple locations, and a self-service
catalogue. Building `Hospital A → doctors/clinics/locations` exactly as §4.13's diagram shows is real
net-new scope, not a small extension.

### 4.15 Network service catalogue — 🟡
`facility_services` (facilities directory) and `lab_tests`/`pharmacy_medications`/`panel_bundles`
(with per-item commission config) already give structured, priced catalogue entries for labs/
pharmacies/facilities. `specialist_providers` has one consultation_fee_kobo per row, not the
telemedicine-vs-physical/duration-vs-price matrix §4.15's example shows. No catalogue exists yet for
allied health services.

### 4.16 Specialist referral compatibility — 🟡, ⚠️ guardrail-adjacent, see §3
### 4.17 Provider capacity management — 🔴
No shortage/capacity dashboard exists (average wait time, overloaded specialties, slot utilisation).
`useWaitlistedReferrals` shows a live per-referral count of matching active providers, which is a
useful primitive to build this from, but there is no aggregate ops view. This is admin-facing
analytics, not patient-facing matching — see §4 for why that keeps it outside the guardrail.

### 4.18 Acceptance criteria — reframed in §4 below as a phased checklist, not a single bar.

## 3. The guardrail — read this before writing any matching/ranking code

`CLAUDE.md` is explicit, twice:

> "Never build functional code (not just schema scaffolding) for the full referral-matching
> pipeline, patient-initiated wellness testing, or Employer/HMO risk dashboards without an explicit
> ask."

> "Explicitly Phase 2/3, not initial launch (confirmed 2026-07-15 — do not build functional code for
> these without an explicit ask): full specialist-matching engine + 8-stage referral-status
> pipeline..."

`docs/Tarragon_Health_Master_Operating_Plan_v4.md` §7 gates the same thing as "Level 5b, Phase 2,
metric-gated."

**What the research found, and why it matters for scoping §4.7/4.8/4.16 specifically:** the
guardrail has held *at the algorithm level* — `useMatchedSpecialistProviders` does a plain
`.eq(specialist_type).eq(is_active)` filter plus a trivial 3-bucket client-side locality sort,
explicitly commented as acceptable only "since the provider list is small (9 placeholder rows
today)." No scoring, no weighting, no clinical-suitability-first ranking of the kind §4.8 asks for
(1. clinical suitability → 2. availability → 3. credentials → 4. location → 5. preference → 6. cost).
That line has not been crossed.

But the guardrail has been **partially outpaced at the schema/workflow level**, and whoever picks up
§4.7/4.8/4.16 next needs to know this isn't a clean slate: the `referral_status` enum already has
all 8 stages the Master Plan calls Phase 2 (`pending_payment → payment_confirmed → pending →
waitlisted → booked → confirmed → completed → declined`), urgency capture and clinical-summary
JSON exist, a full waitlist + interim-management-plan workflow is live, and — most notably — patients
can already pick their own `specialist_provider` via `ChooseReferralSpecialist`, which the sprint
archive itself flags with a self-check comment: *"Not the guardrailed full specialist-matching
engine (master plan Phase 2/3) — reuses the existing catalogue/column as-is."* That comment is the
line to hold: **filtering an existing catalogue is fine, scoring/ranking it is not**, until a founder
explicitly asks for it.

**Do not, without an explicit founder ask:**
- Add any scoring/weighting to `useMatchedSpecialistProviders` or its equivalents (§4.7, §4.8).
- Build "Tarragon recommends" language or an automated best-match suggestion (§4.7).
- Build the full capacity-aware, insurance-aware, preference-aware matching engine §4.16 describes
  ("Tarragon should immediately identify suitable network options" reads as automated matching).

**Safe to build without a new ask** (filtering/discovery, not ranking — see §4 for the concrete list):
better filters on the existing catalogue (price/gender/language, all already columns), a
patient-initiated "find a specialist" entry point reusing the existing filtered query, capacity/
shortage *reporting* for ops (§4.17) since it's an internal dashboard, not a patient-facing
recommendation.

## 4. Proposed phasing

### Phase 1 — safe to build now, no new ask needed
Foundational, additive, filter-not-rank, matches patterns already in the codebase:
1. **Encounter/consultation documentation schema** (§4.10) — genuine clean gap, no guardrail
   overlap, high clinical value (currently nothing captures a structured assessment/plan).
2. **`clinical_staff` profile enrichment** (§4.2) — subspecialty, qualifications, years_experience,
   languages[], hospital_affiliations — pure additive columns, same pattern as existing fields,
   never priced/ranked, stays inside the employed-care-team model from §1.
3. **License expiry tracking + renewal warning** (§4.3) — add `license_expires_at` alongside the
   existing `license_verified_at` pattern on `clinical_staff`, and a scheduled check that surfaces
   an expiring/expired credential to admins (warn, and per §4.3 potentially auto-suspend `active`) —
   the columns already exist partner-side (`20260731011319`), this closes the same gap for
   `clinical_staff` and wires up the read side nobody built yet.
4. **Unify "find a provider" discovery UX** (§4.6) — extend `ChooseReferralSpecialist`'s existing
   filters (price/gender/language are already columns, just not exposed) and add a standalone
   patient-initiated entry point that reuses the same filtered query — explicitly filtering, not
   ranking, so it stays inside the guardrail per §3.
5. **Capacity/shortage reporting for ops** (§4.17) — an admin-facing rollup (specialty × state
   provider counts, slot utilisation, `useWaitlistedReferrals`-style live match counts aggregated)
   — internal analytics, not a patient-facing recommendation, so it doesn't trip the matching-engine
   guardrail.
6. **Allied health as a real `specialist_type`** (§4.1) — dietitians/physiotherapists/psychologists
   currently have no representation at all; adding them as catalogue rows is the same shape as the
   existing 9 placeholder specialist rows, not new architecture.

### Phase 2 — needs an explicit founder ask before functional code
1. **Institutional organisation accounts** (§4.13/4.14) — `Hospital A → staff/clinics/locations`
   self-service. This is a real new commitment (who administers it, what it costs to build/support,
   whether it duplicates the existing `corporate`/`hmo` aggregate-account pattern) — scope it with
   the founder rather than assuming the diagram in §4.13 is the final shape.
2. **Provider matching/ranking algorithm** (§4.7/§4.8) — per §3, explicit ask required by
   `CLAUDE.md` directly.
3. **Provider payout/settlement for Tier 5 + referral-network specialists** (§4.11) — extends the
   Synlab liability/reconciliation pattern to a new provider type; real money movement, wants
   founder sign-off same as the Synlab build did.
4. **Recurring availability + leave/blocked-time** (§4.4/§4.5) — a real scheduling-engine rebuild,
   not a small addition to the current slot picker; worth scoping once Phase 1 items prove the
   simpler model is actually the bottleneck.

### Phase 3 — capacity-dependent, revisit once Phase 1/2 data exists
Full §4.16 "Tarragon should immediately identify suitable network options" automated referral
routing, and any provider-facing self-service catalogue/pricing editing — both want real provider
volume and real usage data (the current 9-placeholder-row catalogue can't validate an algorithm
against), so building them earlier would be designing against fake data.

## 5. Open questions for the founder

- **Does "Clinical Network" mean opening the platform to independent/contracted providers beyond
  Tier 5 Partner Specialists** — i.e. a real marketplace layer alongside the employed care team — or
  does §4.1's "doctors, nurses" just mean "represent our own care team well"? This changes whether
  §4.2–4.5 (profile/verification/availability) is scoped for external onboarding or stays internal.
- **Institutional self-service accounts** (§4.13/4.14) are a materially bigger commitment than
  today's admin-maintained catalogue rows — worth sizing against the existing `corporate`/`hmo`
  aggregate-dashboard pattern before committing to the full org-hierarchy shape in the spec.
- **When is there enough real provider volume to responsibly build §4.7/4.8's ranking algorithm?**
  The current catalogue is 9 placeholder rows — any ranking logic built against it today would be
  designed against fake data, independent of the guardrail question.

## 6. Original spec, for reference

The incoming spec text (§4.1–4.18) is preserved as received, since it's the source-of-truth ask this
document reconciles against — see the task history / PR description for the verbatim text rather
than duplicating it here a second time.
