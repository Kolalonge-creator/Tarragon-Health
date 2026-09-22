# HL7 FHIR / Generic Encounter Model / Analytics Warehouse — Build Plan

> A design/reconciliation doc, not a build order. `docs/MASTER_ARCHITECTURE_BLUEPRINT_GAP_ANALYSIS.md`
> (an earlier audit) already flagged all three of these as genuine architecture gaps (lines 84–85 for
> the warehouse and encounter model; it never mentions FHIR at all, which this doc corrects). This file
> is the "how to close each gap, in phases" companion to that audit — written 2026-09-18 after a fresh
> code-level investigation of each area (not from the older doc's summary). Each section ends with a
> phase gate: Phase 1 is additive and safe to build now; later phases need review or an explicit founder
> ask before functional code, per this repo's standing guardrail pattern (see `CLAUDE.md`'s Clinical Tier
> Ladder / "What Claude Must Never Do" sections for the general form of this rule).
>
> **Status, 2026-09-18: Phase 1 shipped for all three sections** (same-day, `worktree-data-architecture-gaps-phase1` branch) —
> the missing FHIR import route + clinician review worklist, the additive `clinical_encounters` summary
> table with sync triggers on all 9 source tables, and the `analytics.rpc_snapshots` warehouse-lite layer
> with `analytics_business_summary` as the proof-of-pattern RPC. Verify each section's own "Phase 1 —
> shipped" note before assuming a later phase is also done — Phase 2/3 items remain open per their own
> gates (partner onboarding, FHIR export, empirical materialisation of the other ~44 analytics RPCs,
> the hard-supertype encounter-model question).
>
> **`/code-review high` was run on the full Phase 1 diff before opening the PR, per this repo's own
> Definition of Done, and found real bugs — fixed same-day, before merge, not after:** the analytics
> snapshot's refresh function was accidentally written against a stale, pre-2026-09-02 shape of
> `analytics_business_summary()` (reverted `paid_purchases`/`paying_patients` back to the retired
> `total_subscriptions`/`active_subscriptions` fields — caught by cross-checking the live function body,
> not trusting the migration file that inspired it, exactly the discipline this file's own CLAUDE.md
> warns about); the FHIR import route could mask a partial-write failure as a successful retry, drop a
> resourceless Bundle entry without recording it, and 500 on a genuine concurrent-duplicate race instead
> of the graceful idempotent response; the Immunization parser compared a partner's FHIR-standard
> vaccine code against this platform's own internal catalogue slug (near-guaranteed to never match) and
> its substring-name fallback could silently pick the wrong vaccine; and the medication parser wrote the
> same raw dosage string into both `dose` and `frequency`. All fixed, tested (124→138 passing tests), and
> live. The `analytics_business_summary()` payload also gained `_computed_at` and a manual "Refresh now"
> action on `/analytics/business`, closing a related finding that the switch from live-aggregation to a
> nightly snapshot had no staleness signal anywhere.
>
> **Known Phase 1 limitations, surfaced by the same review and deliberately NOT fixed now (design-level,
> not correctness bugs) — real fast-follow candidates, not silently accepted:**
> - The 9 `clinical_encounters` sync trigger functions are hand-written per source table, not
>   config/data-driven. A 10th encounter-shaped table (there will be one eventually) means a 10th
>   hand-copied function rather than a one-line config addition — this codebase has a working precedent
>   for exactly this shape of generic-trigger-over-many-tables (`private.audit_row_change()`,
>   `20260812030853_row_change_audit_triggers.sql`) that a future pass should consider reusing here.
> - **Closed 2026-09-22 — the LOINC-code-to-`vital_type` map (Observation only).** Moved to
>   `public.fhir_loinc_vital_type_mappings` (migration `20260922182613`), mirroring
>   `public.vaccination_catalog`'s own shape exactly — a global reference table, any `authenticated`
>   reads, only `private.is_admin()` writes. `parseObservation` (`parse-resource.ts`) now queries it
>   instead of a static object; widening it for a real partner's locally-common LOINC variant is an
>   admin data change, not a code deploy. This did NOT require a real FHIR partner or a warehouse — it's
>   a pure architecture correction to code that already ships. **Deliberately NOT moved**: the BP-panel/
>   systolic/diastolic LOINC constants (structural — "this Observation is shaped as a two-component
>   panel", not a per-partner terminology choice) and the allergy-severity map (a direct 1:1 mirror of
>   FHIR's own fixed `mild`/`moderate`/`severe` valueset, not something a partner's local usage varies) —
>   both stay as code on purpose, not an oversight.
> - `/clinician/fhir-review`'s confirm/dismiss are two near-identical server actions and could be one
>   parameterized action; not merged now to keep this diff's diff-of-behavior easy to review, but worth
>   collapsing before a third status (`modified`) gets its own UI.

## 1. HL7 FHIR interoperability layer

### Current state (verified against live code, 2026-09-18)

The **import side is already substantially built and just never wired to a route.** Three migrations
(`20260807020405_fhir_import_provenance_enums.sql`, `20260807084925_fhir_interop_import_review.sql`,
`20260807085049_fhir_import_fk_indexes.sql`) created a real, non-trivial review pipeline:

- `fhir_import_batches` — one row per received FHIR Bundle (`raw_bundle jsonb`, `resource_counts`,
  `skip_reasons` for unsupported resource types — nothing is silently dropped). Written only by
  service-role; org staff get SELECT only.
- `fhir_import_proposed_resources` — one row per resource inside a bundle, born `proposed` (clinically
  inert). Supports Observation, AllergyIntolerance, MedicationStatement, MedicationRequest, Immunization
  only. A SECURITY DEFINER trigger (`private.enforce_fhir_import_resource_attribution`) derives the
  confirming clinician server-side from `auth.uid()`, blocks `care_coordinator` tier and unset-tier
  staff, and performs the destination-table INSERT itself in the same transaction on confirm/modify.
  Terminal states are immutable; a correction supersedes rather than edits.
- Confirmed target tables: Observation → `vitals_readings`, AllergyIntolerance → `patient_allergies`,
  MedicationStatement/MedicationRequest → `medications`, Immunization → `vaccination_records`.

**What's actually missing:** the API route the migration's own header promises
(`apps/web/src/app/api/integrations/fhir/import`) doesn't exist, and there is **no review UI** — no
worklist anywhere lets a clinician see a `proposed` resource and confirm/dismiss it. The schema, the
authority/attribution logic, and the audit trail are done; the surface area that would let a partner
actually use any of it is not. There is no FHIR export (read) capability at all, no FHIR/SMART-on-FHIR
library in any `package.json`, and no OAuth2 client flow — the only auth mechanism referenced
(`fhir_import_batches.api_key_id`) is this platform's existing `api_keys` table, not SMART-on-FHIR.

No spec doc (`ARCHITECTURE.md`, `CLINICAL_NETWORK_SPEC.md`, `PARTNER_ECOSYSTEM_SPEC.md`) names FHIR or a
trading partner for it. The two dormant platform modules that might seem adjacent — module 27 (payer)
and module 28 (provider-org), both gated off via `platform_modules` — are explicitly scoped to
administrative/claims data only ("no individual clinical data to the payer, ever," per module 27's own
migration header), so they are not a plausible FHIR-import counterparty by design. The import migration's
own comment instead frames the counterparty as "an HMO or hospital that already holds a Tarragon partner
API key" — i.e. labs and hospital/HMO clinical arms, not the payer/provider-org modules.

### Phase 1 — SHIPPED 2026-09-18 (additive, no new tables, no new external surface)
`POST /api/v1/fhir/import` and `/clinician/fhir-review` are both live — see
`apps/web/src/lib/integrations/fhir/`, `apps/web/src/app/api/v1/fhir/import/route.ts`, and
`apps/web/src/app/(dashboard)/clinician/fhir-review/`. Deliberately narrower than the plan below in one
respect: the route lives at `/api/v1/fhir/import` (a `fhir:import`-scoped key via the shared
`runGateway` pipeline), not `/api/integrations/fhir/import` as the original 2026-08-07 migration header
guessed — that guess predates `lib/integrations/gateway.ts`, which is now this codebase's documented
convention for "any future partner endpoint." The parser (`parse-resource.ts`) supports a specific,
tested set of common LOINC codes for Observation and a best-effort catalogue match for Immunization —
an unrecognised code or an unmatched vaccine name is recorded in `skip_reasons`, never guessed at. The
review worklist supports confirm and dismiss-with-reason; it does not yet expose an edit-before-confirm
form for the `modified` status path the schema already supports (a real fast-follow, not a structural
gap — the DB enforces `confirmed_payload` correctly whenever a UI is built for it). What was already
half-built before this pass:
1. `POST /api/integrations/fhir/import` — validates a FHIR R4 Bundle against an existing `api_keys`
   credential, writes `fhir_import_batches` + `fhir_import_proposed_resources` rows. This is a pure
   consumer of schema/logic that already exists and was already designed to be safe (review-gated,
   immutable, attributed) — the main new work is the FHIR Bundle parser/validator itself.
2. A clinician review worklist (mirrors the existing pattern used for lab-result review or referral
   worklists) listing `proposed` resources per patient, with confirm/modify/dismiss actions calling the
   existing trigger-enforced RPC path. No new authority model needed — `enforce_fhir_import_resource_attribution`
   already does the gating.
3. Both pieces stay inert until a real partner has credentials — there's no patient-facing surface, so
   this carries none of the "don't build ahead of a real counterparty" risk the Partner Ecosystem spec
   warns about elsewhere.

### Phase 2 — needs review before turning on
- Confirm the real first trading partner (a specific lab or hospital, not a hypothetical) before issuing
  a production `api_keys` credential for FHIR import — this is a partnership/business decision, not an
  engineering one.
- Decide whether the 5-resource-type scope is sufficient for that partner's actual data, or needs
  extending (e.g. Condition, DiagnosticReport) — each addition needs its own target-table mapping and
  trigger case, same shape as the existing 5.

### Phase 3 — needs an explicit founder ask (new capability, new risk surface)
- **FHIR export** (a patient's record leaving the platform in FHIR shape) does not exist in any form and
  is a materially different risk profile from import: it's an outbound PHI-sharing capability, not an
  inbound review-gated one. It must respect the same `profile_access_categories`/emergency-access model
  that gates every other clinical read on this platform (see `CLAUDE.md`'s reproductive-health access-
  category notes for how easy it is to get this wrong by copying an existing pattern without re-deriving
  it) — an export endpoint that bypasses category scoping would be a platform-wide PHI leak, not a local
  bug. Needs founder sign-off and likely NDPA/legal input before any code, per this repo's standing rule
  that regulatory-adjacent scope needs an explicit ask.
- SMART-on-FHIR/OAuth2 (vs. the existing static API-key model) is a separate, larger piece of work — only
  worth it if a real partner specifically requires it.

## 2. Generic clinical-encounter model

### Current state (verified against live code, 2026-09-18)

Confirmed absent, and the codebase says so itself: `20260827201621_clinical_encounter_notes.sql`'s own
header states "no structured clinical-encounter/SOAP note exists anywhere" — but that migration
deliberately scopes itself to a documentation layer only (`clinical_encounter_notes`, three *optional*
links out to `video_consultation_id`/`async_consult_id`/`escalation_id`), explicitly leaving
medication/lab/referral data "exactly where they already live." It never proposes a hard unifying model.

Nine tables are genuinely encounter-shaped and genuinely independent: `video_consultations`,
`escalations`, `medication_reviews`, `annual_health_checks`, `annual_reviews`, `async_consults`,
`case_briefs`, `postnatal_checkins`, `weight_management_checkins`. They don't even agree on an actor
column shape — `video_consultations`/`escalations` point their actor columns at `profiles`,
`medication_reviews`/`annual_health_checks`/`annual_reviews`/`async_consults` point at `clinical_staff`,
and `case_briefs`/`postnatal_checkins` have no actor column at all. Blast radius if any of these were
force-migrated into a shared supertype is uneven: `video_consultations` has 11 inbound FKs and
`escalations` has 6 (including from `clinical_encounter_notes` itself), while `medication_reviews`,
`case_briefs`, `annual_health_checks`, `postnatal_checkins`, and `weight_management_checkins` have **zero**
inbound FKs — a hard rewrite would be high-risk for the first two and comparatively cheap for the rest.

`patient_timeline` (an append-only log with a generic `source_table`/`source_id` text+uuid pointer, no
enforced FK) is the closest thing to a soft unification layer already in production — but only 2 of the
9 tables (`escalations`, `clinical_encounter_notes`) actually write to it today. There is no
supertype/subtype (shared-PK parent+children) precedent anywhere in this schema; the codebase's default
is fully independent tables per workflow, with `patient_timeline`'s soft pointer as the one precedent for
polymorphic-without-referential-integrity modeling.

### Phase 1 — SHIPPED 2026-09-18 (additive, zero schema changes to the 9 existing tables)
`public.clinical_encounters` is live (migration `20260918091341_clinical_encounters_unification.sql`),
backfilled from all 9 source tables and kept current by one `AFTER INSERT OR UPDATE` trigger per source
table (`private.sync_clinical_encounter_*`). Staff-only `SELECT` via `private.is_org_staff`; no
INSERT/UPDATE/DELETE grant to `authenticated` at all — every write happens inside a SECURITY DEFINER
trigger function, so the table is genuinely read-only from the application's perspective. **Deliberately
NOT done in this pass, and not silently implied by "shipped" above:** wiring these same 9 tables into
`patient_timeline` (still only `escalations` and `clinical_encounter_notes` write there) — doing both in
one migration risked duplicate timeline entries for `escalations` and made the diff harder to review; a
real fast-follow, tracked here rather than forgotten. A hard schema unification (making all 9 tables inherit from or get replaced by one `encounters` table)
is not proposed for Phase 1 — the blast radius on `video_consultations`/`escalations` alone (17 combined
inbound FKs, RLS, triggers) makes that a Phase 3 decision at best, not a default. Instead:
1. Introduce one new **additive header table**, e.g. `clinical_encounters` (patient_id, organisation_id,
   `encounter_type` enum naming which of the 9 source tables it summarizes, `source_table`/`source_id`
   following `patient_timeline`'s existing soft-pointer convention, `occurred_at`, and the same dual
   nullable `actor_profile_id`/`actor_clinical_staff_id` pattern `clinical_encounter_notes` already uses
   to paper over the profiles-vs-clinical_staff split). This is purely additive — no existing table's
   schema, RLS, or triggers change.
2. Give each of the 9 source tables a trigger that upserts its own summary row into `clinical_encounters`
   on insert/update — the same shape of work as extending `patient_timeline` wiring, which is already a
   proven, low-risk pattern in this codebase (used for `escalations` and `clinical_encounter_notes`
   today). This closes the "only 2 of 9 tables are timeline-visible" gap as a side effect.
3. Point analytics/reporting queries that currently have to union or separately query multiple encounter
   tables (case-cockpit, CMO caseload views, any future analytics-warehouse rollups from §3) at this one
   table instead — a real simplification with no migration risk to existing data.

### Phase 2 — partially shipped 2026-09-18
- **Shipped, scoped down from the original description above:** `clinical_encounter_notes` gained a
  `clinical_encounter_id` column (migration `20260918100746_clinical_encounter_notes_link_unified_encounter.sql`),
  backfilled and kept current by a trigger — but ADDITIVE, alongside the three original link columns, not
  instead of them as first planned. Checked before building: `apps/web/src/lib/queries/consultation-video.ts`
  and `encounter-notes.ts` both read/write `video_consultation_id` directly in the live video-consult flow
  — replacing the three columns outright is real app-layer surgery across a sensitive path, not a pure DB
  migration, and wasn't attempted. A future pass can retire the three original columns once those two app
  query sites are migrated to read `clinical_encounter_id` instead.
  **Two successive `/code-review high` passes, both before this reached a PR, found and fixed 4 real bugs**
  (migrations `20260918101643` and `20260918103547`, proof script `packages/db/tests/clinical_encounter_note_link_bugs.sql`):
  a `row()` type-mismatch that crashed every real note write with a link column set; an undocumented
  cross-table trigger-firing-order race for `async_consults` that could leave a note permanently unlinked;
  a client-writable bypass of the column's own "never client-supplied" comment; and — found only by a
  *second* review pass on the fix for the second bug — a regression where the fix itself could abort an
  entirely unrelated, session-less source-table write (e.g. a Zoom webhook completing a video
  consultation). Worth internalising as a pattern: a fix for a real bug is itself new code and deserves
  the same scrutiny as the original change, not a pass on the strength of "it's just a fix."
- Decide whether `postnatal_checkins`/`weight_management_checkins` (which currently have no status
  column, only a completion timestamp) should gain one to fit the header table's lifecycle concept, or
  whether the header table tolerates encounter types with a simpler lifecycle. Not done.

### Phase 3 — needs an explicit founder ask
- Retrofitting doctor/CMO worklist UI to query through the unified table instead of per-type tables is
  real product-surface change, not backend-only — needs sign-off same as any clinician-facing workflow
  change.
- Whether to eventually collapse the 9 tables' own status/actor columns into the header table (true
  supertype/subtype) rather than keeping them as a parallel summary is an open architectural question
  that should only be decided once Phase 1's summary table has been live long enough to show whether the
  soft/additive version is actually sufficient.

## 3. Analytics / BI warehouse

### Current state (verified against live code, 2026-09-18)

Confirmed absent as a separate system, and the existing `MASTER_ARCHITECTURE_BLUEPRINT_GAP_ANALYSIS.md`
already calls this "a legitimate absence for a pre-revenue/pilot-stage platform" (lines 255–257) — worth
repeating here because it bears directly on how big Phase 1 should be. All ~26 dashboards under
`(dashboard)/analytics/` go through one client library (`apps/web/src/lib/analytics/queries.ts`, ~45
React Query hooks), and every hook calls a `SECURITY DEFINER` Postgres RPC (gated by `private.is_analyst()`,
returns aggregates only, never raw PHI rows) that does live `COUNT`/`SUM`/`GROUP BY`/`date_trunc`
aggregation against the transactional tables at request time — 15 of ~30 analytics-RPC migrations contain
real multi-table `JOIN`s. None of it is materialized or cached (no `MATERIALIZED VIEW` exists anywhere in
`supabase/migrations/`, and Upstash Redis — already used for rate-limiting — is never touched by anything
under `lib/analytics/`).

One precedent already exists and works well: `20260730153159_public_impact_metrics.sql` builds a genuine
summary table (`public.public_impact_metrics`) populated nightly by a `pg_cron`-scheduled refresh function
(`cron.schedule('public-impact-metrics-refresh-daily', '20 3 * * *', ...)`), with small-cell suppression
built in. It's currently a one-off for a single public marketing page, but it is architecturally exactly
the "warehouse-lite" shape this gap needs — and `pg_cron` is already proven at scale here (74 scheduled
jobs across the platform today). Vercel cron (18 jobs, all daily — consistent with the "sub-daily crons
block deployment" constraint noted elsewhere in this repo) and Supabase's own `pg_cron` are the two real
scheduling surfaces available; no Railway worker config exists in-repo despite Railway being named in the
platform's stack list.

Given the codebase's own "Stack A — Final, Do Not Relitigate" rule (Supabase Postgres is the canonical
DB) and the pre-revenue/pilot scale this repo's own audit doc already documents, standing up a genuinely
separate OLAP system (Snowflake/BigQuery/ClickHouse + dbt) is very likely premature — that's real
infrastructure cost and ops burden with no evidence yet that the live-RPC approach is actually too slow
for anyone. Introducing a second database technology is itself the kind of architecture decision the
Stack A rule exists to gate, not something to build speculatively ahead of a founder decision.

### Phase 1 — SHIPPED 2026-09-18 (additive, reuses a proven in-repo pattern, no new infrastructure)
The `analytics` schema and `analytics.rpc_snapshots` are live (migration
`20260918091524_analytics_warehouse_snapshot_layer.sql`), proved on exactly one RPC
(`analytics_business_summary`) rather than all ~45 pre-emptively — which RPC needs this next is the
empirical question Phase 2 below still poses. Neither the schema nor the table is reachable by
`anon`/`authenticated` directly (schema `USAGE` and table grants explicitly revoked); every read/write
goes through a `SECURITY DEFINER` function, same posture as `public_impact_metrics`. Generalized that
pattern rather than inventing a new one:
1. A dedicated Postgres `analytics` schema (parallel to the existing `public`/`private` split) holding
   rollup/summary tables — one per dashboard or metric family, matching the shape of the ~45 existing
   RPCs' outputs.
2. `pg_cron`-scheduled nightly (or, per dashboard, more/less frequent — pg_cron isn't subject to the
   Vercel-cron daily-only constraint) refresh functions that populate them, following
   `refresh_public_impact_metrics()`'s existing shape almost exactly.
3. Repoint the analytics RPCs to read from the summary tables instead of live-aggregating, starting with
   whichever of the 15 join-heavy RPCs are actually slow or most-used (investor/executive/business
   dashboards are the likely candidates, but confirm with real query timing before prioritizing).
This is "warehouse-shaped" — a separate schema, materialized summary data, scheduled refresh, a real
metrics layer — without adding a new database technology, new ops burden, or new cost, and it directly
extends a pattern this codebase has already built and proven once.

### Phase 2 — needs review
- Which RPCs actually need materialization is an empirical question, not a design one — instrument first
  (query timing, `pg_stat_statements`) rather than materializing everything preemptively.
- **Checked 2026-09-18, before doing more materialization work: the platform has 50 total `profiles` rows.**
  Every one of the ~15 join-heavy analytics RPCs runs in single-digit milliseconds at this scale regardless
  of join count — there is currently zero empirical signal that materializing any of them would help
  anything. Doing so now would be exactly the "materializing everything preemptively" this section already
  warns against. Re-run this check (real query timing, not a guess) once there's real usage volume before
  picking the next RPC to materialize — don't take "more materialization" as a default next step just
  because the pattern from Phase 1 exists and is easy to repeat.
- Refresh cadence per metric (nightly is fine for most dashboards; anything investor-facing or
  operationally time-sensitive may need a tighter cadence than `pg_cron`'s daily default elsewhere in
  this repo suggests).

### Phase 3 — needs an explicit founder ask, and only once real scale justifies it
- A genuine external warehouse (logical replication from Supabase into BigQuery/Snowflake/managed
  ClickHouse, or adopting Metabase/Looker for BI) is a real infrastructure and cost commitment that
  should wait for evidence the Phase 1 approach is insufficient — either real usage volume the audit doc
  says doesn't exist yet, or a BI/investor-reporting tooling need Phase 1's Postgres-native approach can't
  serve. This is squarely a founder infra/cost decision, not an engineering default, and per the Stack A
  rule it would need to coexist with — not replace — Supabase as the transactional source of truth.
