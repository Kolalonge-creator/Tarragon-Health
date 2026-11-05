# Verified laboratory and imaging directory: Phase 0 audit and design

Date: 2026-11-04. Status: design only. Nothing in this document has been built, applied or switched on.
Source: the founder's "Verified Laboratory and Diagnostic Centre Directory" specification and its "Diagnostic Provider
Safety, Verification and Quality Assurance Framework" (pasted in chat 2026-11-04). This document gives the deliverables
that specification asks for before implementation (its §22, items 1 to 13).

Audited against `origin/main-dev` at 0f28a51dc and the live project `koiplnmbgnqnbywhpjlf` on 2026-11-04.

---

## 0. Decisions (DIR-1 to DIR-3 decided 2026-11-04, see DECISIONS.md; DIR-4 follows the recommendation)

| # | Question | Why it blocks | Recommendation |
|---|----------|---------------|----------------|
| DIR-1 | Do patients see a "Tarragon Preferred Partner" badge, and are eligible partners placed first? | Conflicts with founder brief 2.0 §8.1 ("no distinction in patient-facing service functionality between contracted partner laboratories and other listed laboratories"; "Partner status is an internal operational attribute"), with `CLINICAL_NETWORK_SPEC.md` §3 ("filtering ... is fine, scoring/ranking it is not") and `PARTNER_ECOSYSTEM_SPEC.md` §3. | Allow it, with the safeguards in §10: eligibility first, partner placement only among eligible branches within the patient's chosen radius, a separate badge that never looks like accreditation, and a patient-facing explanation that placement is commercial. Record it as a new decision that supersedes brief §8.1. |
| DIR-2 | Abandon the half-built `feat/t2-phase6-lab-directory` work? | It is uncommitted in worktree `agent-aff5448f0012b23d1` (stopped 17:01 today). It adds a fourth location model (`lab_directory_labs/branches/branch_tests/claims`), with free-text test names, labs only and no imaging. It also assumes `directory_enabled` is OFF; live, it is ON. | Yes. Keep only its listing rules (no price stored, verified by a named person, ISO 15189 needs an identifier, issuer, scope and source). Build on the existing branch tables instead (§5). |
| DIR-3 | Include imaging in the first build, or labs first? | Imaging needs a different regulator path (NNRA plus state licence) and has no admin UI today. | Build both in the same model from the start. Seed and verify Lagos and Abuja laboratory branches first, then imaging. |
| DIR-4 | Who does the verification work, and at what depth at launch? | Tarragon cannot check staff, equipment or EQA records remotely without documents or a site visit. | Launch with listing level 1 (regulator registration plus branch-level service confirmation, §8). Add level 2 ("quality-assured service") only once a document review process and an owner exist. |

---

## 1. Existing provider architecture

There are seven separate provider or branch tables today:

- `facilities`: a flat list of places with no branches, `services text[]`, coordinates and S65 directory columns. All rows were suspended on 2026-08-03. There are 9 rows, and `facility_services` has 0.
- `lab_providers` (4 rows, 1 active: Synlab Nigeria) and its branches `lab_provider_locations` (39 rows, all with coordinates).
- `imaging_providers`, `imaging_provider_locations`, `imaging_equipment` and `imaging_provider_staff`: all present, all with **0 rows**, and no admin UI.
- `provider_org_locations` and its related tables hang off `organisations`, with no foreign key to the branch tables.
- `pharmacy_partner_locations` and `specialist_provider_locations` are out of scope.

Licence columns (`license_type`, `_number`, `_expires_at`, `_verified_at`, `_verified_by`) exist on 6 partner tables. They are **provider-level only**. S27h will not activate a lab without them.

Freshness is already modelled:
- S36g/S80: `directory_verification_config`, the append-only `directory_verifications`, `directory_freshness`, the `tier` column (`seed_only`/`phone_confirmed`/`licence_checked`), a hide-stale rule, `directory_chase_list` and the admin pages under `admin/ops/directory-*`.
- Live, `directory_verifications` has 0 rows and `credential_verifications` has 0 rows.

**Rule `resolve_lab_order_provider` must keep:** when an order names no provider, it falls back to "the single active laboratory". A second `is_active` lab would break that fallback. A directory listing therefore must not be made `is_active` (see §5).

## 2. Existing laboratory directory

- `list_lab_test_locations(p_test_code, p_state)` matches an exact test code and provider, filters by state, and sorts by name. It has no distance and no ranking. Its patient screen is titled "Contracted lab branches".
- `directory_search` (S65b) covers only `facilities` and specialists. It uses a hand-written haversine distance and radius, and a substring service match.
- `list_annual_bundle_labs/towns` filters by state and town.
- Reviews exist twice: `lab_location_reviews` and `facility_ratings`.

## 3. Existing investigation catalogue

- `lab_tests` (56 active) is **per provider, not per branch**. Every Synlab branch is assumed to offer every Synlab test, which breaks the specification's branch-level rule.
- `screen_types` holds the canonical lab test definition (specimen, preparation, units, explainer).
- `imaging_studies` is per provider and has `modality`, but no body-region column.
- Search tooling exists, but nothing uses it for investigations:
  - None of these catalogues has synonyms, abbreviations, full-text or trigram search.
  - That tooling lives in `reference_concepts` and `reference_concept_synonyms` (24 synonyms live, `pg_trgm` GIN indexes, LOINC concepts such as HbA1c 4548-4).
  - These tables are linked only to result readings, not to orderable tests.

## 4. Existing doctor request workflow

- `lab_orders` has `fulfilment` (`partner`/`self_arranged`), `facility_id`, `provider_id`, `location_id` and statuses up to `resulted`.
- `imaging_orders` has `location_id`, `fulfilment` and statuses `ordered`→`booked`→`attended`→`performed`→`reported`→`result_returned`→`reviewed`.
- **A doctor does not choose a place today.** The lab order form says "No provider is chosen here", and the imaging form takes only the study, urgency and indication.
- A lab request PDF exists (`generate-lab-request-pdf.ts`). No imaging request PDF exists.
- Results come back through the upload engine (T2 Phase 1, S27 `submit_lab_result`) and imaging report documents (AI-016).

## 5. Proposed data model

The principle: one investigation identity, two existing branch tables, one new service table and one new credential table. No fourth location model.

**Investigation identity.**
- Reuse `reference_concepts` as the single investigation identity. Add `kind = 'investigation'` with:
  - `category`: lab section, ultrasound, mammography, X-ray, CT, MRI, cardiac, endoscopy, physiology
  - `modality`: typed with the existing imaging modality enum (the type of `imaging_equipment.modality`), so there is one list of modalities, not a third
  - `body_region`, `laterality_applicable`, `patient_description`
  - `is_ambiguous_parent`, with child concepts for the clarification step
- Link `screen_types.concept_id` and `imaging_studies.concept_id` to it, so ordering, results and directory search share one identity.
- Synonyms, abbreviations, misspellings and Nigerian expressions go in `reference_concept_synonyms`, with a new `term_kind` (abbreviation / lay / misspelling / clinical).
- An ambiguous term ("breast scan", "heart scan", "pelvic scan") is a synonym of the ambiguous parent concept. Search then returns the children for the user to choose from, with "I am not sure" for patients.

**Listings that are not contracts.**
- Add `directory_status` (`draft` / `listed` / `suspended` / `deactivated`) to `lab_providers` and `imaging_providers`, separate from `is_active`.
- `is_active` keeps meaning "contracted, routable, billable". The routing, settlement and never-sell-below-cost code reads only `is_active`, so a non-partner listing can never be billed or routed.
- **P2 must first list every reader of `lab_providers`, `lab_provider_locations`, `imaging_providers` and `imaging_provider_locations` that does not filter on `is_active`.** This covers admin partner pickers, the `facilities.lab_provider_id` link, settlement and cost-basis screens, partner dashboards and `region_service_available`. Each reader gets an `is_active` filter or a stated reason. A DB proof inserts a listed, inactive provider and asserts it reaches no ordering, billing, settlement or partner-picker path.
- A diagnostic centre that offers both labs and imaging gets one row in each table, joined by the existing `organisation_id` claim column.

**Branch fields.** Add to `lab_provider_locations` and `imaging_provider_locations`:
- `lga`, `town`, `neighbourhood` (labs already have `town`), `email`, `website`
- `location_verified_at/by`, `hours_verified_at/by`, `directory_status`

Coordinates already exist on both tables.

**New `diagnostic_branch_services`** (the core table). One row per branch per investigation:
- `branch_kind` (lab/imaging), `branch_id`, `concept_id`
- `availability`: available / temporarily_unavailable / by_appointment / external_referral / awaiting_confirmation / discontinued
- `performed`: onsite / other_branch_same_provider / external_facility, plus `performing_branch_kind/id`, required unless onsite
- `appointment_required`, `preparation_note`, `equipment_note`
- `confirmed_at`, `confirmed_by`, `evidence_source`, `next_confirm_due`
- An append-only `diagnostic_branch_service_history` for status changes
- **No price column.**

`lab_tests` stays as the partner ordering and price list. For the partner, branch rows are created from it only after a person confirms each branch.

**New `diagnostic_credentials`**:
- Subject (provider or branch), `regulator`:
  - `mlscn_registration`, `iso15189` (with `accreditation_body`), `nnra_authorisation`, `state_facility_licence` (with `state`), `rrbn`, `mdcn`, `other`
- `identifier`, `scope_concept_ids` (which investigations it covers), `issued_on`, `expires_on`, `source_url` or evidence document, and `recorded_by`
- `status`: the specification's 10 values (verified_current, pending, registered_accreditation_unverified, accreditation_verified, scope_partially_verified, expired, suspended, withdrawn, failed, unverified)
- `verified_by/at`, `next_verify_due`, `reason`
- An append-only history

The existing provider licence columns are backfilled into this table. S27h then reads the new table in a later step, so there is one source of truth.

**New `diagnostic_credential_requirements`**: a versioned, admin-maintained operational setting, not a CMO signature under G-01. Each row says which regulators a service of a given category or modality needs, optionally per state. Examples:
- Lab test → MLSCN registration
- X-ray, CT or mammography → NNRA plus the state licence
- Ultrasound → the state licence only
- MRI → the state licence

**Incidents and suspension.**
- Reuse S74 `partner_quality` / `partner_work_status` for partners.
- For any listing, add a `diagnostic_listing_incidents` table (complaint → risk assessment → decision → corrective action → reinstatement approval), scoped to provider, branch or service.
- A credible serious concern suspends the affected scope immediately.

**Patient context.**
- `profiles` already has `state`, `city`, `area` and `lga`.
- Add an optional saved `search_location` (label plus coordinates from address geocoding). It is never required. Browser location is used only on request.

## 6. Investigation taxonomy (first seed)

The seed is the specification's §6 list:
- **Lab:** haematology, chemistry, endocrine, lipids, renal, liver, microbiology, serology, immunology, molecular, histopathology, cytology, tumour markers, urinalysis, reproductive, infectious disease.
- **Ultrasound:** 15 studies.
- **Breast:** mammography (screening, diagnostic, uni- and bilateral) kept separate from breast ultrasound and breast MRI.
- **X-ray:** by region.
- **CT:** 8 studies.
- **MRI:** 9 studies.
- **Cardiac:** ECG, echo, Holter, ABPM, stress test.
- **Endoscopy and physiology:** upper GI endoscopy, colonoscopy, spirometry, PFT, audiometry, sleep study.

Each concept carries a LOINC code (or the RadLex/LOINC radiology playbook code for imaging) where one exists. The seed is reference data, not a clinical rule, so it needs no CMO signature. The patient-facing descriptions do go through the normal content review.

## 7. Search and synonym architecture

Search runs in Postgres and is deterministic, with no external AI:
1. Normalise the term with the existing `private.normalise_term`.
2. Match in this order: exact concept name, exact synonym or abbreviation, full-text, then trigram similarity at or above a versioned threshold (proposed 0.35, kept in `packages/shared/src/proposed-config`, not written into SQL).
3. Return the matched concepts with a `match_kind`.
4. If the best match is an ambiguous parent, return `needs_clarification` with its children instead of results.

One RPC, `search_diagnostic_services(p_concept_id, p_lat, p_lng, p_state, p_lga, p_radius_km, p_filters, p_page)`, supersedes `list_lab_test_locations`. The old function becomes a wrapper so existing screens keep working, and it carries over the hide-stale and freshness guards.

Different callers see different columns. Patients get public fields only. Clinicians additionally get the last confirmation and the regulator detail. Internal notes, contracts and partner commercial terms are never returned.

## 8. Regulatory verification strategy

Verification has two levels; partnership sits apart from both.

**Level 1, "Verified":** listed and eligible. All of the following must hold:
- the provider's identity is confirmed;
- every credential that `diagnostic_credential_requirements` names for that service is `verified_current` and unexpired, at the right level (branch-level where the regulator licenses branches);
- the branch address, phone and location were checked by a named person;
- the service row was confirmed within its cadence;
- the actual performing facility is known and itself eligible.

**Level 2, "Quality-assured service":** per service. Documented evidence of quality control and external quality assessment, the staff licence for the reporting professional (MDCN radiologist, MLSCN scientist), and the equipment QA record. This is offered only once there is a document-review owner.

**"Preferred partner"** is a commercial relationship, recorded separately at branch level, and never implied by either level.

Sources per regulator:
- MLSCN: the registered and approved laboratories list, and the MLSCN Accreditation Service for accreditation and its scope.
- NNRA: Safe-X-Rays authorised facilities.
- Lagos HEFAMAA, and the equivalent licensing body in each other state, which has to be identified state by state.
- RRBN and MDCN for the professionals.

None of these offers an API we know of. Every check is a manual verification, recorded with its source URL or document, the person who checked and the date. Nothing is scraped and then published as verified. A provider-submitted claim stays `pending` until staff review it.

## 9. Geolocation architecture

PostGIS is not installed and is not needed at this size. We expect thousands of branches, not millions.
- Reuse the haversine expression from `directory_search` (pull it out into `private.distance_km`).
- Pre-filter with a latitude/longitude bounding box on a btree index.
- Radii: 5, 10, 20 and 50 km, plus "anywhere in my LGA/state". The radius values are versioned config.
- Distance is shown as "about N km in a straight line", never as a travel time.
- Directions open Google Maps with the branch coordinates.

A doctor's search defaults to the **patient's** saved location, never the doctor's. The location used is shown and can be changed. Reconsider PostGIS only beyond roughly 50,000 branches.

## 10. Ranking algorithm (subject to DIR-1)

**Stage 1, eligibility** (server-side, `private.diagnostic_service_eligible`): exact concept match; availability in (available, by_appointment); the Level 1 conditions in §8; no open suspension at provider, branch or service scope. Expiry takes effect when the function is evaluated, so a credential that expires drops out with no cron. The existing `credential_expiry_notices` warn staff at 90, 60 and 30 days.

**Stage 2, groups**, all within the chosen radius. Let *d0* be the distance to the nearest eligible branch.
1. Eligible preferred-partner branches within the **partner band**, ordered by distance. The band is *d0* plus a versioned margin (proposed 3 km, in `proposed-config`).
2. All other eligible branches, partner or not, ordered by distance. This includes a partner that falls outside the band.
3. Branches whose service is `awaiting_confirmation` or `external_referral`, labelled and shown only below the others. They are never presented as normal recommendations.

Example: in Lekki, the nearest eligible mammography branch is 2 km away. A partner at 4 km is listed first. A partner in Ikeja at 18 km is not: it sits in group 2 at its own distance, below the 2 km branch. The founder spec's rule, that a far partner must not top the list, therefore holds at every radius.

Two more safeguards:
- Within a group, ties break by verification recency, then by name. There is no quality score and no payment weighting.
- The band margin is an operational setting, so any change to it is versioned and audited.

If the founder keeps brief §8.1 (DIR-1 = no), drop group 1. The rest stands unchanged.

## 11. Data collection and verification workflow

1. A master spreadsheet with the specification's §15.4 columns. A template will be added under `docs/plans/`.
2. An admin import RPC lands every row as `draft`, with its source. It never lists anything.
3. A verifier works a queue, reusing `admin/ops/directory-queues`: confirm identity, check each required credential against its regulator source, phone the branch to confirm each service and whether it is done onsite, and geocode the address.
4. Listing becomes possible only when the eligibility function returns true. The listing action is attributed to a named person.
5. Re-verification follows the existing S36g cadence: services and contacts every 3 months, credentials before expiry, QA evidence yearly. These are internal controls, not regulator inspection intervals.
6. Later phase: provider self-service claiming. Submitted changes stay `pending` until staff approve them.

The first coverage target is Lagos and Abuja, for roughly the 30 most-requested investigations. Synlab's 39 branches go first, because Tarragon has a relationship to confirm them through. They are not copied in as verified.

## 12. Phased plan

| Phase | Content | Gate |
|------|---------|------|
| P1 | Investigation concepts, synonyms, ambiguity, search function. Link `screen_types` and `imaging_studies`. | Proofs plus search tests (§13) |
| P2 | `directory_status`, branch fields, `diagnostic_branch_services`, `diagnostic_credentials`, requirements config, eligibility function, admin screens for listing, verification and incidents. | Sabotage-tested proof that an unverified or expired listing never appears |
| P3 | `search_diagnostic_services` with location and radius. The old function becomes a wrapper. | Location tests |
| P4 | Partner placement and badges (only if DIR-1 = yes), plus the commercial-transparency explainer. | Ranking tests |
| P5 | Doctor picks a recommended branch on lab and imaging order forms, an imaging request PDF, a patient "viewed" timestamp, and results through the existing upload engine. | Clinical referral tests |
| P6 | Patient search page and branch profile. Replace the "Contracted lab branches" and "Partner labs" copy. | Browser check |
| P7 | Data collection: Lagos and Abuja first, then more states and provider claiming. | Coverage metrics, not row counts |

**P3 as built (2026-11-04):** `search_diagnostic_services` returns two groups, `eligible` and `unconfirmed` (group 3 in §10); the partner band is P4. `list_lab_test_locations` was **not** turned into a wrapper: it feeds the paid lab booking picker, which must only offer contracted branches, while the directory deliberately lists uncontracted ones. Radius choices and page size are versioned config (`directory.diagnostic_search`), passed by the caller. `directory_search` keeps its own haversine; the new search uses `private.distance_km`.

**P4 as built (2026-11-05):** `diagnostic_branch_partnerships` holds the commercial relationship per branch (dated, admin-only, ended rather than edited). A commission partnership cannot be recorded without a legal review reference, which is how the §Known limits legal-review requirement is enforced without a new guard. Search adds the `partner` group (eligible partner within d0 + `partner_band_km`, config v2, 3 km) and `is_partner`. An unconfirmed row is never badged, and a state search without a point has no band. Patient copy for the badge and explainer is in `diagnostic-search-copy.ts`, pending CMO and DPO review.

**P7 as built (2026-11-05):** `/admin/ops/diagnostic-directory/import` stages a CSV (template and guide in `docs/plans/diagnostic-directory-import-*`). Every row is checked in the database; a verifier applies good rows one at a time, which creates drafts only (tests `awaiting_confirmation`, credentials `pending`). Partner, record-status and verification-date columns are kept for reference and never applied. Contracted providers are refused. The data collection itself (Lagos and Abuja first) is people's work, not code.

**P5 as built (2026-11-05):** a doctor suggests a place per open lab or imaging order (`diagnostic_order_suggestions`, kept apart from the order tables and their triggers; it changes nothing on the order). The suggestion must be recommendable for that test when it is made, and it is re-checked on every read. The search uses the patient's saved state and LGA. The patient opens it in the app, and the first open is the "viewed" timestamp. A new imaging request PDF exists, with the folio kind `imaging_request`. **Neither PDF names a place**, because of the 2026-09-10 guidance-only rule for Tarragon stationery. Two things are left for the founder: (1) caregivers cannot yet open the suggestion (patient and staff only); (2) the lab request PDF says Tarragon takes no commission on the test, which stays true only while no commission partnership exists. Mobile shows neither yet.

P1 to P3 are additive, and nothing becomes patient-visible until a branch is listed by a person. `directory_enabled` is already ON, so verification is the gate. No new guard is needed, per G-01.

## 13. Test plan

DB proofs live in `packages/db/tests/` and are registered in `ci.manifest`. Each has a sabotage step.

- **Search:** mammogram, mammography, breast scan (asks to clarify), abdo USS, abdominal ultrasound, HbA1c, kidney function, misspellings (mamogram, hba1), and a test no nearby branch offers.
- **Location:**
  - Lekki versus Ikeja for mammography.
  - Abuja for abdominal ultrasound.
  - A patient changes location.
  - A patient with no saved address.
  - A doctor search uses the patient's location.
  - Nothing within the radius.
  - A partner farther away than a non-partner.
- **Eligibility and partner:**
  - A partner without the test.
  - A partner whose service is unverified.
  - A partner whose credential has expired.
  - A partner's service is temporarily unavailable.
  - Two partners offer the same test.
  - A much closer non-partner.
  - Partner status removed.
  - An outsourced service with an unknown or unverified performer.
  - A suspended branch while sibling branches stay listed.
- **Referral:**
  - A doctor orders and picks a branch, and the patient sees it.
  - The patient picks another eligible branch.
  - An upload links back to the order.
  - The doctor reviews.
  - Opening the request does not mark it complete.
- **Security:**
  - A patient cannot read credentials, evidence, incidents or internal notes.
  - A provider account edits only its own claimed listing.
  - A doctor sees only permitted patients' requests.
  - Only an admin changes partner status.
  - `anon` cannot execute the search function.

## Known limits

- No regulator offers a verification API we know of, so every check is manual and needs staff time. The directory will start small.
- Tarragon cannot confirm staff or equipment quality without documents or a visit. Level 2 waits for an owner.
- The state licensing bodies outside Lagos still have to be identified state by state.
- If commissions are taken from a partner, the arrangement needs legal review before group 1 ranking goes live.
