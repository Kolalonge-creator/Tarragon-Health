# Partner Ecosystem & Healthcare Marketplace — Design Spec & Gap Analysis

> **Status: design/reconciliation doc, not a build order.** This reconciles an incoming "Partner
> Ecosystem & Healthcare Marketplace Platform" spec (module 95, §95.1–95.19, plus a cross-module
> "how modules 91–95 fit together" section — full text preserved in the PR description this doc
> shipped with) against what actually exists in the codebase, and proposes a phased path. It does
> not itself authorise building the guardrailed pieces — see §3. Subordinate to `CLAUDE.md`, which
> remains authoritative on scope-gating language if the two ever conflict. Heavily overlaps
> `docs/CLINICAL_NETWORK_SPEC.md` (provider directory, verification, availability, discovery,
> matching/ranking, org accounts) — this doc builds on that one rather than re-deriving its
> findings; §2 below cross-references it directly rather than duplicating the analysis.
>
> **2026-08-30 — first pass, nothing built yet.** This is pure reconciliation: what module 95 asks
> for, section by section, against real file/migration citations. No founder decision has been
> sought on any of the Phase 2/3 items in §4 yet.

## 0. What this document is

Module 95 describes a generic healthcare-marketplace supply layer sitting underneath Tarragon's
clinical care: partner onboarding (application → due diligence → contract → go-live), a partner
capability/service catalogue, provider discovery, quality scoring, SLAs, performance monitoring,
suspension, marketplace economics (subscription/platform-fee/service-fee models), provider
settlement, a partner API, a partner portal for smaller providers, a partner sandbox, an internal
partner trust score informing routing, and network-optimisation analytics (demand-vs-capacity gap
detection → "recruit a partner" signal). The cross-module summary frames this as the commercial/
operational layer sitting *underneath* the clinical layer, with a worked hypertension-patient
example and an explicit institutional-privacy rule ("the employer sees an aggregate count, never
an individual diagnosis").

Two things needed to happen before this could turn into a build plan: (1) find out what already
exists, and (2) check it against two standing platform facts that materially change how much of
module 95 is genuinely new scope — both are done below.

## 1. Two framing corrections before this spec is actionable

**"Marketplace" is not the current operating model — it is one deliberate, narrow exception.**
The 2026-08-03 founder pivot ("self-arranged fulfilment") stopped Tarragon booking and billing
labs and pharmacies by default: patients use any lab/pharmacy themselves and upload results, at
₦0 to Tarragon. Synlab Nigeria is the sole contracted exception — a real accounting backend has
existed since 2026-08-21, but even its own patient-facing "let us bill it" entry point is
currently unmerged (see §2.11/2.12). Every other row across `lab_providers`, `pharmacy_partners`,
`specialist_providers`, `home_visit_providers`, and `logistics_partners` remains an inactive
placeholder. Module 95's §95.9–95.12 (performance monitoring, SLAs, settlement) describe
mechanics for an active multi-partner network that, today, is one partner deep. Building any of
this now means building *for* a network that doesn't exist yet, not automating one that does —
worth sizing accordingly before committing engineering time.

**§95.7 (quality scoring "to inform routing") and §95.16 (a composite trust score "to inform
routing decisions") are guardrail territory, not open scope.** `CLAUDE.md` and
`docs/CLINICAL_NETWORK_SPEC.md` §3 explicitly forbid adding scoring, weighting, or ranking logic
to partner/provider selection without an explicit founder ask — the guardrail exists precisely
because this is the marketplace-ranking pattern it names. A composite score that feeds routing is
exactly what it prohibits, regardless of which partner type it scores.

**Where module 95 already matches how Tarragon actually operates, worth naming as confirmation
rather than a gap:** the "no owned clinics, partners not owned assets" framing matches the
platform's real architecture rule; the employer-sees-aggregate-only worked example in the
cross-module section matches the I9 founder rule (institutions get aggregate-only access, ever,
only superadmin may drill into an individual) — already shipped, not something this spec is
asking for.

## 2. Section-by-section reconciliation

Legend: 🟢 built and working · 🟡 partially built / schema-only · 🔴 not built · ⚠️ guardrail-adjacent

### 95.2 Partner profile — 🟡
Same finding as `docs/CLINICAL_NETWORK_SPEC.md` §4.1/4.2: split across `lab_providers`/
`pharmacy_partners`/`specialist_providers`/`home_visit_providers`/`logistics_partners`, admin-
maintained, static reference-data rows. Regulatory license columns (`license_type/number/
expires_at/verified_at/verified_by`) were added 2026-07-31 to all five tables, but only
`home_visit_providers`/`logistics_partners` currently gate assignment on `license_expires_at` via
a BEFORE-trigger — lab/pharmacy/specialist use RPCs instead and were flagged as an unclosed
follow-up in that same migration. A nightly `private.queue_partner_license_expiry_alerts()` cron
warns admins across all five, though.

### 95.3 Partner onboarding pipeline — 🔴
Confirmed not built, still true as of today. Every partner-manager admin UI (`labs-manager.tsx`,
`pharmacies-manager.tsx`, `specialists-manager.tsx`, `logistics-partners-manager.tsx`) is pure
CRUD with a single `is_active` boolean toggle — no stage field, no due-diligence/contract/
technical-integration/certification concept anywhere in the schema. All five partner tables share
the same minimal shape (`name`, domain fields, `is_active`, `created_at`) — see
`supabase/migrations/20260705211315_care_coordination.sql` and
`20260715230120_home_visit_and_logistics_partners.sql`. The only `contract_status` enum in the
codebase (`draft/submitted/approved/rejected/paid/active`,
`20260705211343_b2b_billing.sql`) belongs to B2B employer/HMO subscription billing, not partner
onboarding — do not confuse the two if extending either. Today, "onboarding a partner" means a
manual admin insert with `is_active = false`, flipped to `true` by hand when ready.

### 95.4/95.5 Partner capability & service catalogue — 🟡
Same finding as `docs/CLINICAL_NETWORK_SPEC.md` §4.15: `lab_tests`/`pharmacy_medications`/
`panel_bundles` are real, structured, priced catalogues with per-item commission config; partner
self-service *availability* editing (not pricing — deliberately admin-only, a financial-control
decision) shipped 2026-08-27. `specialist_providers` has one flat `consultation_fee_kobo` per
row, not the telemedicine-vs-physical/duration-vs-price matrix §95.5 implies. No catalogue exists
for allied health services (dietitians, physiotherapists, psychologists) — no table, no
`specialist_type` values for them at all.

### 95.6 Provider discovery — 🟡
Same finding as `docs/CLINICAL_NETWORK_SPEC.md` §4.6: `FacilitySelector` covers facilities
(labs/pharmacies/vaccination) well; specialist discovery (`ChooseReferralSpecialist`) is only
reachable after a referral is already open, with price/gender/language present as data but not
exposed as filters. No standalone, patient-initiated "find a specialist" entry point.

### 95.7 Quality scoring — 🟡 / ⚠️
Only per-metric, and only for one partner type: `lab_provider_turnaround_stats`/
`lab_partner_turnaround_stats` (`20260730215234_lab_turnaround_sla_stats.sql`) compute turnaround
time only — no compliance, security, or complaints dimension, and nothing aggregates into a
single score. Pharmacies, `specialist_providers`, `home_visit_providers`, and `logistics_partners`
have no scorecard at all. Per §1/§3, using any such score to influence routing/matching is
guardrail territory, not a plain build task.

### 95.8 Partner SLAs — 🟡
No formal SLA-definition table (response-time targets, incident-reporting requirements) exists
for any partner type. Synlab's transmit/reconcile pipeline has implicit timing windows baked into
its functions, but nothing structured or partner-visible as an "SLA."

### 95.9 Partner performance monitoring dashboard — 🟡
Real and good for Tarragon's own doctors (`analytics_doctor_performance`) and for labs
specifically (the turnaround SLA stats above, including a self-facing view the `lab_partner`
login can see). Nothing exists for pharmacies, `specialist_providers`, `home_visit_providers`, or
`logistics_partners` — Synlab is the only partner with real performance tracking today.

### 95.10 Partner suspension — 🔴
`is_active` is a bare admin toggle with zero process around it — no status enum, no investigation/
notes field, no corrective-action tracking, no reactivation approval step. The one real
precedent, `facilities_suspended_pending_accreditation`
(`supabase/migrations/20260803160537_...sql`) plus its follow-up
`20260803163135_suspend_all_facilities_and_vaccination_booking.sql`, is a one-off hand-run
`UPDATE ... SET is_active = false` with inline assertions — not a function, not an RPC, nothing
reusable for the next suspension event. `clinical_incident_near_miss_log`
(`20260826225518`) does have a real `corrective_action` column and could be a useful pattern to
extend, but it's scoped to clinical staff/care incidents today, with no FK to any partner table.

### 95.11 Marketplace economics — 🟡 (mixed, several pieces removed by design)
What's actually implemented, not aspirational:

| Model | Status | Citation |
|---|---|---|
| Patient/sponsor subscriptions | 🟢 Live | `subscription_plans`/`subscriptions` (`20260705211343_b2b_billing.sql`), Paystack/Stripe sync (`20260712201431`, `20260715142500`) |
| Care Voucher sponsor fees | 🟢 Live | `20260731215012_care_vouchers_core_tables.sql` + purchase/layaway/redemption/GL follow-ons; year-of-plan SKU `20260803141409_subscription_care_vouchers.sql` |
| Synlab contracted-partner margin split | 🟡 Live on the backend, patient UI unmerged | `20260821191942_partner_billing_collect_and_liability.sql` (2700 liability / 4100 margin, agent/IFRS-15 treatment), `..._transmit.sql`, `..._reconcile_settle_refund.sql`, `20260821193144_switch_on_synlab.sql`. The trigger UI (`PartnerLabBillingOption`) exists only as an untracked file in worktree `practical-rhodes-b874e1` / branch `claude/goofy-diffie-0a55c5` — confirmed via `git log --all`, it's on no branch |
| Legacy per-order commission | 🟡 Dormant | `commissions` table (`20260705211315_care_coordination.sql`); explicitly disabled for Synlab-billed orders to avoid double-counting margin; dormant elsewhere since those partners are inactive |
| Corporate/employer contracts | 🔴 Dead code | `corporate_contracts` table referenced nowhere outside its own creation migration |
| HMO/payer capitation | 🔴 **Removed by explicit founder decision — do not reintroduce** | I8, `20260729122912_remove_hmo_capitation_i8.sql` |
| Fee-at-risk outcomes contracts | 🔴 Schema stub only | `outcomes_contracts` (`20260714130000`), select-only for org staff, no admin UI |
| Employer roster | 🟡 Attribution only, not billing | `20260715162958_employer_roster_members.sql`'s own header notes there is no capitation-style bypass in the schema — employees still pay individually |

**§95.11's "should not incentivise unnecessary clinical utilisation" principle has a disclosure,
not a control**: `20260730221139_terms_of_service_commission_disclosure.sql` tells patients
Tarragon earns a commission on lab/pharmacy/referral bookings. No algorithmic or protocol-based
cap on utilisation exists anywhere. Flagging this as a genuinely open, unaddressed risk — not
something quietly solved.

### 95.12 Provider settlement — 🔴 for partners, 🟢 for Tarragon's own ops
Substantial ops-side infrastructure, but the partner never sees any of it themselves:
- `lab_partner` is explicitly excluded from `private.is_org_staff()`
  (`20260729234618_harden_is_org_staff_exclude_lab_partner.sql` — "employee of a PARTNER LAB, not
  of Tarragon"). Its entire surface is three SECURITY DEFINER RPCs
  (`lab_partner_orders/_order_patient/_upload_result`, `20260729234509_lab_partner_surface.sql`)
  plus `acknowledge_lab_order` — none return `total_kobo`, `partner_cost_kobo`, or any amount.
  `apps/web/src/app/(dashboard)/lab-partner/*` has a worklist, own-price catalogue, facilities,
  and turnaround stats — no revenue or settlement page.
- `partner_statements`/`partner_statement_lines` (the real Synlab ledger) is RLS-gated to
  `is_org_staff(organisation_id)` only (`20260821192256`) — since `lab_partner` is excluded from
  that predicate, **Synlab's own login cannot see its own statements or variances.** 100%
  ops-facing.
- `pharmacist` follows the same pattern: zero financial fields, and no billing pipeline exists to
  show anyway (pharmacy stays fully self-arranged).
- **A real payout mechanism does exist**, just Tarragon-side: `approve_partner_statement()`
  creates/finds a `finance_vendors` row, raises a `finance_bills` bill (Dr 2700 / Cr 2500 via
  `finance_create_bill`/`finance_approve_bill`), later paid via `finance_pay_bill` — gated on
  `finance.vendors.manage`. Tarragon genuinely pays Synlab out; the partner just can't see it.
- Tier 5 `specialist_providers` need no payout mechanism today —
  `20260803142941_self_arranged_specialist_referrals.sql` enforces `referral_fee_kobo=0` on
  self-arranged referrals, and all specialist rows remain placeholder/inactive.

### 95.13 Partner API — 🟡, but for a different partner category
A real, externally-callable, API-key-authenticated REST surface exists: `public.api_keys`
(`20260721163131_partner_integration_api_keys.sql`, SHA-256-hashed `th_live_...` bearer tokens,
scoped via `api-key-scopes.ts`) backs `/api/protocol-api/v1/{bp-triage,cv-risk,diabetes-risk}`.
This targets the `protocol_partner` organisation type
(`20260802205326_protocol_partner_organisation_type.sql`) — external institutions licensing
Tarragon's triage algorithms (e.g. a state PHC board) — **not** the supply-side
`lab_providers`/`pharmacy_partners`/`specialist_providers`/`home_visit_providers`/
`logistics_partners` this spec's §95.13 describes. Those five have no API keys, no
partner-registered webhooks, and are reachable only via internal SECURITY DEFINER RPCs behind a
`lab_partner`/`pharmacist` login. The `api_keys` hash+prefix+scope+revocation pattern is the more
reusable design if a true supply-partner API is ever built — worth reusing rather than
reinventing.

### 95.14 Partner portal — 🟡
`lab_partner`/`pharmacist` self-service exists and is real: worklist, own-price/availability
catalogue editing (shipped 2026-08-27), facilities, turnaround stats. Matches §95.14's "smaller
providers via a Tarragon web portal" intent, but narrowly — no financial visibility (§95.12) and
no equivalent portal for specialists/home-visit/logistics partners at all.

### 95.15 Partner sandbox — 🔴
No sandbox, staging environment, or certification process exists anywhere — for the Protocol API
surface or for a hypothetical supply-partner API.

### 95.16 Partner trust score — 🔴 / ⚠️
Not built, and per §1/§3, building a composite score to inform routing needs an explicit founder
ask first — same guardrail as §95.7. No `trust_score`/`risk_score` column or RPC exists anywhere
in the schema today.

### 95.17/95.18 Network optimisation / service gaps — 🟡, halves not joined
The demand side is real: `get_geo_health_aggregates()`
(`20260827202439_geo_health_intelligence.sql`) rolls up `profiles.state` × overdue
`screening_schedules` (plus hypertension/diabetes/CVD risk tiers) into a small-cell-suppressed,
state-level table surfaced in `PopulationDashboard`'s "Overdue screenings" column. The capacity
side has matching geography — `lab_provider_locations.state`, `pharmacy_partner_locations`,
`logistics_partners.regions` — but **nothing joins the two sides**, and this is explicit rather
than accidental: the migration's own header comment states that "service shortages" and
"engagement differences" would need facility-coverage data the function doesn't touch, and defers
that as follow-up work. No test-type-specific demand signal exists either (e.g. HbA1c
specifically) — `screening_schedules` only tracks generic overdue status, not which test is
overdue.

### 95.19 Acceptance criteria
Reframed below in §4 as a phased checklist rather than a single bar, matching the pattern in
`docs/CLINICAL_NETWORK_SPEC.md` §4.18.

## 3. The guardrail — read this before writing any scoring/routing code

Unchanged from `docs/CLINICAL_NETWORK_SPEC.md` §3, and it applies to §95.7 and §95.16 exactly as
written there:

> "Never build functional code (not just schema scaffolding) for the full referral-matching
> pipeline, patient-initiated wellness testing, or Employer/HMO risk dashboards without an
> explicit ask." — `CLAUDE.md`

**Do not, without an explicit founder ask:** add any scoring/weighting to partner selection for
any partner type (labs, pharmacies, specialists, home-visit, logistics — the guardrail is not
specialist-referral-specific, it's about the pattern); build a composite trust/quality score used
to gate or rank partners (§95.16); build "Tarragon recommends this partner" language.

**Safe to build without a new ask:** onboarding-stage tracking (§95.3) with no scoring attached;
formal SLA definitions (§95.8) as data, not routing input; performance dashboards extending the
existing lab-turnaround pattern to other partner types (§95.9) as internal ops reporting; a
reusable suspension workflow generalising the `facilities` precedent (§95.10); joining the
already-built demand and capacity data (§95.17/95.18) into a single ops-facing gap report — none
of this recommends or ranks anything to a patient or clinician, it's operational visibility.

## 4. Proposed phasing

### Phase 1 — safe to build now, no new ask needed
1. **Partner onboarding stage tracking** (§95.3) — an `onboarding_status` enum (applied →
   under_review → contracted → integrated → live, or similar) added to all five partner tables,
   same additive-column pattern used for the 2026-07-31 license-tracking columns. *Not built yet.*
2. **Reusable partner suspension workflow** (§95.10) — generalise the `facilities` one-off into a
   real function/RPC (status + reason + investigator + reactivation path), reusing the
   `clinical_incident_near_miss_log.corrective_action` pattern's shape rather than inventing a new
   one. *Not built yet.*
3. **Extend performance scorecards beyond labs** (§95.9) — apply the existing
   `lab_partner_turnaround_stats` pattern to pharmacies/specialists once any of those partner
   types goes active; premature to build against zero live rows today. *Not built yet.*
4. **Join demand and capacity data for ops reporting** (§95.17/95.18) — a single admin-facing
   function joining `get_geo_health_aggregates()`'s state-level demand against
   `lab_provider_locations`/`pharmacy_partner_locations` state counts, explicitly the follow-up
   the 2026-08-27 migration already deferred. Internal reporting only, not a patient-facing
   recommendation. *Not built yet.*
5. **Formal SLA definitions as data** (§95.8) — a table capturing response-time/incident-
   reporting terms per partner, informational only. *Not built yet.*

### Phase 2 — needs an explicit founder ask before functional code
1. **Merge the Synlab patient-facing billing UI** (§95.11/95.12) — `PartnerLabBillingOption` is
   already built and was end-to-end verified live against the real DB
   (worktree `practical-rhodes-b874e1`, branch `claude/goofy-diffie-0a55c5`) — this is a merge
   decision, not new engineering, but it does turn on real patient billing for a live partner, so
   it wants a founder go-ahead the same way the original Synlab contract did.
2. **Partner-facing settlement visibility** (§95.12) — giving `lab_partner`/`pharmacist` logins
   read access to their own `partner_statements`/revenue, currently blocked by
   `is_org_staff()`'s deliberate exclusion of those roles; real money-visibility change, wants
   sign-off.
3. **A true supply-partner API + sandbox** (§95.13/95.15) — reusing the `api_keys`
   hash+scope+revocation pattern for `lab_providers`/`pharmacy_partners`/etc., if partners are
   ever expected to integrate their own systems rather than use the Tarragon portal.
4. **Composite partner trust/quality score** (§95.7/95.16) — per §3, explicit ask required by
   `CLAUDE.md` directly. *Not built — guardrail unchanged.*
5. **Corporate/employer marketplace contracts** (§95.11) — `corporate_contracts` is dead code
   today; deciding whether to build real billing on top of it or remove it is a founder call, not
   an engineering default.

### Phase 3 — capacity-dependent, revisit once Phase 1/2 data exists
Full network-optimisation "recruit a partner" automation (§95.17/95.18 beyond the ops-facing join
in Phase 1) and any patient-facing partner ranking/matching want real partner volume and real
usage data — the current one-active-partner network can't validate an algorithm against, so
building either earlier would be designing against a fake network. *Still not built, guardrail
unchanged.*

## 5. Open questions for the founder

- **Is module 95's marketplace vision the actual near-term direction, or a longer-horizon idea
  source** (same distinction the top of `CLAUDE.md` draws for the v3 spec)? Given the whole
  self-arranged-fulfilment pivot was a deliberate step *away* from Tarragon booking/billing
  partners, building out onboarding pipelines, SLAs, and settlement portals for a network that's
  one partner deep is worth sizing against how soon more partners are actually expected to go
  live.
- **Should the unmerged `PartnerLabBillingOption` branch (§95.11) be prioritised on its own**,
  independent of the rest of this spec? It's already built and verified — the only thing standing
  between "Synlab accounting is real" and "patients can actually use it" is a merge decision.
- **Does the "don't incentivise unnecessary utilisation" principle in §95.11 need an actual
  control**, not just the existing ToS disclosure — e.g. capping referral/lab-order volume
  triggerable by commission-earning staff, or a periodic audit metric? This is open regardless of
  how much of the rest of module 95 gets built.

## 6. Original spec, for reference

The incoming module 95 spec text (§95.1–95.19, plus the "how modules 91–95 fit together"
cross-module section) is preserved as received in the PR description this doc shipped with, since
that's the source-of-truth ask this document reconciles against — see the PR description rather
than duplicating the full text here a second time.
