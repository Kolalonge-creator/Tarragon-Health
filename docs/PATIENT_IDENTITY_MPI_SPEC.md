# Patient Identity & Master Patient Index — Design Spec & Gap Analysis

> **Status: design/reconciliation doc, not a build order.** This reconciles an incoming "Patient
> Identity & Master Patient Index" spec (§82.1–82.14 below) against what actually exists in the
> codebase and proposes a phased path. It does not itself authorise building the guardrailed pieces
> (§4). Subordinate to `CLAUDE.md`, which remains authoritative if the two conflict.
>
> **2026-08-29 — first pass, research only, nothing built yet.** Findings below come from a direct
> read of the schema (`supabase/migrations/`) and `apps/web/src`, not from memory of past sprints.

## 0. What this document is

An incoming "Patient Identity & Master Patient Index" spec (§82.1–82.14, reproduced in full in §6)
describes the standard healthcare-IT MPI problem: preventing one real patient from becoming several
system records, giving every patient a stable identifier, verifying who they actually are, detecting
and merging duplicates, protecting against wrong-patient clinical actions, and supporting proxy
access (parent/caregiver/authorised representative) without ever confusing the proxy for the patient.

Two things needed to happen before this could turn into a build plan: (1) find out what already
exists — considerably more than a blank slate — and (2) untangle one framing trap the research
surfaced immediately (§1). Both are done below.

## 1. How this fits the business, and the framing risk to watch

**The trap: do not conflate "proxy identity access" with the removed ParentCare billing tier.**
`CLAUDE.md` records that "individual enrolment only (no family plans, no ParentCare), ever" was
confirmed shipped 2026-07-29 (item I9). Reading that line in isolation could suggest §82.10's
parent→child / caregiver→elderly proxy-identity ask is out of bounds. **It isn't, and the codebase
itself makes the distinction explicit.** `supabase/migrations/20260729143514_individual_enrolment_only.sql`
deletes only `family_plan_members` — the *billing bundle* (Family Lite/Plus/Premium, ParentCare as a
subscription tier) — and its own header states: *"Two orthogonal models were tangled here and only
one is a billing construct... `profile_access` is consent-based and independent of payment... That is
the dependant model; it needed no billing relationship and it does not acquire one now."* The
migration's closing assertion block hard-fails if `profile_access` or its RLS policies don't survive
intact. So: **ParentCare-as-a-subscription-product is gone and should stay gone; `profile_access`-as-
proxy-identity is a live, separate, and actually fairly mature system** (§2, §82.10). Every mention of
"proxy" below is about the latter, never a request to revive the former.

**A second trap worth flagging early, since it surfaces in §82.4's identity-verification ask:**
`supabase/migrations/20260807163417_passport_registration_verification.sql` sounds like patient
identity verification but is not — "Health Passport" there is an international medical-record
document, and that migration verifies a *clinician's* MDCN registration number, not a patient's
identity. See §2, item 82.4.

Beyond those two traps, this spec's territory is squarely inside Care Coordination and Platform
Infrastructure (`CLAUDE.md` "The Business" categories 3 and 5) — it's foundational plumbing every
other category depends on, not a new product line.

## 2. Section-by-section reconciliation

Legend: 🟢 built and working · 🟡 partially built / schema-only / narrow · 🔴 not built · ⚠️ named-alike but actually something else

### 82.1 Purpose — narrative, not a build item
The "four names, one patient" risk the spec opens with is real and directly explains why the
identifier scheme below (`profiles.id` as the true key, never a name/phone match) matters.

### 82.2 Master Patient Index — 🟡
No standalone identity service or separate MPI table exists. `public.profiles`
(`supabase/migrations/20260705211044_core_auth_multitenancy.sql:74-86`) *is* the identity record —
`id uuid primary key references auth.users(id)`, plus contact details, demographics
(`date_of_birth`, `sex`), and (§82.3) a human-facing patient identifier. What the spec's diagram
calls "external identifiers" and "linked records" has no dedicated modelling: there's no external-ID
crosswalk table (e.g. an HMO's own member number, a hospital's own MRN) and no "linked records" concept
beyond the proxy graph in §82.10. Verdict: the *shape* of an MPI exists as one well-formed table with
a real unique identifier, but the specific MPI capabilities the spec lists under this heading
(external-identifier linking, a dedicated identity service boundary) are not separately built.

### 82.3 Tarragon patient identifier — 🟢
`profiles.patient_number text unique`, format `TH-NNNNNN`, added in
`supabase/migrations/20260715003255_reference_numbers_specialist_catalogue_commission_rate_types.sql:38-56`
via `private.next_reference('TH-', 'private.patient_number_seq'::regclass)`, assigned by a
`BEFORE INSERT OR UPDATE` trigger guarded on `role = 'patient'`. Architecturally identical to the
spec's `TRG-P-000000123` example, different prefix. Genuinely patient-facing, not just schema:
rendered on `apps/web/src/app/(dashboard)/account/page.tsx:58-59` ("Patient ID"),
`apps/web/src/app/(dashboard)/patient/(sections)/profile/page.tsx:20-23`, and the clinician-facing
patient list (`apps/web/src/app/(dashboard)/clinician/patients/page.tsx:58-64,173-177`), plus the
emergency-card dataset. **Not based on phone number** — confirmed independently in §82.5. Staff carry
a deliberately separate namespace (`profiles.staff_number`, `EMP-NNNNNN`,
`supabase/migrations/20260806115636_profiles_staff_number.sql`, explicitly excluded from the roles
`patient_number` applies to) — worth knowing so the two ID schemes aren't conflated in future work.

### 82.4 Identity verification — 🟡
- **Phone:** no verification gate at signup. `apps/web/src/app/signup/actions.ts:50-76` is
  email+password via `supabase.auth.signUp()`; phone rides in as `user_metadata` and is backfilled
  onto `profiles.phone` unverified. A separate phone-OTP flow exists
  (`apps/web/src/app/login/actions.ts:68-136`) but it's an alternate *login* method (Supabase Auth's
  `auth.users.phone_confirmed_at`), not an identity-verified flag on `profiles`.
- **Email:** Supabase Auth's built-in confirmation link only (`auth.users.email_confirmed_at`); no
  custom `profiles.email_verified` column.
- **Government ID (NIN/BVN) and document verification:** real, substantial build, but optional and
  currently inert for lack of live credentials. `supabase/migrations/20260716182000_identity_verification.sql`
  adds `profiles.identity_verified_at` and `public.identity_verifications`
  (`method`: `nin`/`bvn`/`document`, `status`: `pending`/`verified`/`failed`), NDPR-conscious — only
  `id_last4` is ever persisted, never a full NIN/BVN. `apps/web/src/app/onboarding/actions.ts:159-241`
  (`submitIdentityVerification`) inserts `pending` and calls out to
  `apps/web/src/lib/identity/provider.ts`, a real Dojah adapter (never-throws/5s-timeout, same
  contract as `packages/shared/ml-client.ts`) that returns `unavailable` when
  `IDENTITY_PROVIDER`/`IDENTITY_API_KEY`/`IDENTITY_APP_ID` aren't set — which, as of this doc, they
  aren't. RLS blocks the patient's own session from ever self-asserting `verified`; only the
  service-role path can. UI: `apps/web/src/app/onboarding/identity-verification-card.tsx`, explicitly
  labelled "(optional)". **Gap within the gap:** the Zod schema gating that form
  (`apps/web/src/lib/validation/onboarding.ts:40-46`) only accepts `method: z.enum(["nin", "bvn"])` —
  even though the DB enum includes `'document'`, there is no UI path to submit one. Document
  verification is schema-only.
- **Biometric:** 🔴 not built — zero references anywhere in the codebase.
- ⚠️ **Named-alike, not this:** `supabase/migrations/20260807163417_passport_registration_verification.sql`
  verifies a *clinician's* MDCN registration for the Health Passport document feature, not a
  patient's identity — see §1.

### 82.5 Phone number change — 🟢
`profiles.phone` has no unique constraint, only a format check
(`supabase/migrations/20260705211044_core_auth_multitenancy.sql:86`). The only phone-based lookup is
`public.find_profile_by_phone()` (`supabase/migrations/20260712202559_find_profile_by_phone_same_org.sql:11-24`),
a narrow same-org convenience RPC for the "add a family member" flow — the actual link it produces is
stored as a UUID FK, not the phone. `employer_roster_members` has a phone-uniqueness index, but that's
a separate pre-registration HR roster table (corporate "claim your account" flow); once claimed, the
real identity is the UUID FK, not the phone. **Identity is carried by `profiles.id` everywhere; phone
is a contact/lookup convenience, never a join key.** Caveat: there's no patient-facing phone-change UI
today (only `emergency_contact_phone`/`next_of_kin_phone` are editable on the profile page), so this
correctness is architectural rather than exercised by a live flow — worth keeping true if a phone-
change flow is ever added.

### 82.6 Duplicate detection — 🔴
Confirmed exhaustively, not a search miss: zero migrations, zero RPCs, zero UI reference "duplicate"
in a patient-record sense (every hit is unrelated — duplicate allergy entries, duplicate wearable
readings). No admin surface for patient-record management exists at all
(`find apps/web/src/app -path "*admin*patient*"` returns nothing). This is a real, total gap.

### 82.7 Duplicate merge — 🔴
Same result: zero matches for `merge_patient`/`merge_profile`/`merge_account` anywhere. The only
"merge" migrations in the repo (`20260705211611_merge_nurse_into_clinician.sql`,
`20260803005139_merge_doctor_into_clinician.sql`) merge account *roles*, unrelated to patient-record
deduplication. **Sizing note for whoever scopes this:** `profiles.id` is a hard FK target for dozens
of clinical tables (medications, vitals, encounters, lab orders, screenings, escalations, and more) —
a real merge feature needs a considered repoint-or-union strategy per table plus an audit-preserving
design, not a quick delete-one-keep-other script. This is the single largest build in this whole spec.

### 82.8 Wrong-patient prevention — 🟡
No `layout.tsx` exists under `clinician/patients/[patientId]/` — all clinical panels render as tabs
inside one `page.tsx` (`patient-record-tabs.tsx`), so there's no cross-route persistence gap to begin
with; whatever header exists is structurally present on every tab. What it actually shows
(`apps/web/src/app/(dashboard)/clinician/patients/[patientId]/page.tsx:347-364`) is **name and phone
only** — no DOB, no photo, no `patient_number`, even though `date_of_birth`/`sex` are fetched in the
same query (line 56) and `profiles.avatar_url` exists
(`supabase/migrations/20260826214216_patient_avatar.sql`) and is already wired into the *clinician
patient-monitoring grid* — just not into this page's header. **Patient/org-boundary validation is
genuinely solid**, spot-checked across three action files (`page.tsx`, `blood-profile-actions.ts`,
`screening-result-actions.ts`): every one relies on an RLS-scoped `.eq("id", patientId)` select
against `private.is_org_staff()`, so a cross-org patient simply returns zero rows at the Postgres
level, not an app-layer check. A real, live read-audit exists too:
`supabase/migrations/20260812034612_clinician_patient_record_view_audit.sql`'s
`log_patient_record_view()`, called on every chart open (`page.tsx:80-85`), ACL-hardened per
`CLAUDE.md`'s standing "anon EXECUTE" lesson. **The gap is specifically the visual confirmation UX**
the spec asks for — no DOB/photo/second identifier in the persistent header, no "you are now viewing
patient X" step when switching.

### 82.9 Patient switching prevention — 🟡
Same evidence as §82.8 — the RLS/org-boundary enforcement that prevents a clinician from *reading*
another org's patient is solid, and read access is logged. What's missing is the same visual
guard: no interstitial or re-confirmation when navigating from one patient's chart to another's.

### 82.10 Proxy identities — 🟢
A real, current, non-billing proxy mechanism, built across three layers (see §1 for why this is
distinct from the removed ParentCare tier):
- **Core grant:** `public.profile_access` (`supabase/migrations/20260706084848_profile_access.sql`) —
  `profile_id`, `grantee_user_id`, `permission_level` (`view`/`manage`), owner-controlled RLS.
- **Two-sided consent:** `care_access_requests`
  (`supabase/migrations/20260730025553_care_access_requests.sql`) — the counterparty must accept
  before a grant is created, covering both next-of-kin (view) and eldercare (manage) directions.
- **Child vs. adult dependant disambiguation:** `profiles.is_dependent_account`
  (`supabase/migrations/20260730025603_profiles_is_dependent_account.sql`) distinguishes a
  no-login child (synthetic email, provisioned via `addChildDependentAction`) from an adult who
  separately accepted an eldercare grant — both produce an identical `profile_access` row, so this
  column is the only disambiguator.
- **Sponsor vs. patient are orthogonal:** `supabase/migrations/20260801100000_supporter_and_patient_are_independent.sql`
  adds `profiles.receives_care`, replacing an earlier exclusive enum — a supporter and a patient
  identity can coexist on one account.
- **Sponsor clinical read-access is a second, separate, patient-controlled opt-in:**
  `profile_access.clinical_access` (default `false`, owner-only to flip, enforced by trigger) gates
  SELECT-only RLS on 11 clinical tables via `private.can_read_clinical()`
  (`supabase/migrations/20260731181143_sponsor_clinical_access_consent.sql`,
  `20260731185243_sponsor_clinical_access_results_and_escalations.sql`) — **financial sponsorship
  never implies clinical read access** by default, and the second migration's own assertion block
  bans ever gating a *write* policy on this flag.
- **"Acting for" is not impersonation:** `apps/web/src/lib/acting/acting-for.ts` +
  `supabase/migrations/20260801110000_acting_for_someone_you_support.sql` let a `manage`-level
  supporter open a beneficiary's account (`th_acting_for` cookie, 2-hour expiry), but `auth.uid()`
  never changes and every write is stamped `logged_by_profile_id` server-side — scoped to INSERT-only
  on `vitals_readings`/`symptoms`, no UPDATE/DELETE anywhere.
- **UI:** `apps/web/src/app/(dashboard)/patient/family/` (dependants list, adults-you-manage,
  care-access-requests, care-visibility toggle) and `.../patient/supporting/`.
- **Consolidation view:** `public.my_care_graph()`
  (`supabase/migrations/20260807010837_care_graph_unification.sql`) unifies grants, requests, care
  vouchers, and care-team assignment into one "who is around this person" query — and its own commit
  closed a real hole where `care_vouchers_select` had admitted any grantee to voucher SKU names
  (health information) without the `clinical_access` consent check.

### 82.11 Identity permissions — 🟡
Graduated, but coarse — two named levels (`view`/`manage`) plus one orthogonal read-only clinical
toggle (§82.10), not a fine ladder. A `manage` grant is itself scoped narrow (INSERT-only on two
tables via "acting for," never a blanket write grant). **No "emergency access" tier exists at all** —
`private.can_read_clinical()`'s two OR-branches (the `clinical_access` flag, or `manage` + dependant)
have no time-boxed/break-glass override branch. Revocation is bilateral (`revoke_care_access` lets
either party end a grant) and a `manage → view` downgrade immediately ends any active "acting for"
session.

### 82.12 Adolescent transition — 🔴
Confirmed not built, exhaustively. `ageFromDateOfBirth` appears in ~20 call sites — every one is
clinical/eligibility logic (vaccination-schedule ceilings, CV-risk formulas, cohort analytics), none
touch `profile_access` or `is_dependent_account`. No trigger, RPC, or cron references age-of-majority
concepts. `addChildDependentAction` provisions a child once, with a permanent parental `manage`
grant, and nothing in the codebase ever revisits that grant as the child ages — no re-consent prompt,
no downgrade, no path to an independent account.

### 82.13 Identity audit — 🟡
`supabase/migrations/20260812030853_row_change_audit_triggers.sql` covers **writes** on 21 tables
including `profiles` — account creation, verification-status changes, and identity-field edits do
produce audit rows (changed-column-names + a row hash, deliberately never old/new *values*, to avoid
flattening every table's narrower RLS onto the audit log's uniform read policy). **`profile_access`
and `care_access_requests` are not in that 21-table list** — proxy-relationship changes (who was
granted access to whom, when a grant or clinical-access toggle was revoked) are **not currently
audited as writes at all**. **Reads are explicitly out of scope for the general trigger** (its own
header: *"a trigger cannot fire on SELECT... read-access logging needs a different mechanism... left
as a follow-up,"* and confirms `pgaudit` is a dead end on the current Supabase tier — matches
`CLAUDE.md`'s standing lesson about that function). One narrow exception exists:
`log_patient_record_view()` (§82.8) covers exactly one read path — a clinician opening a chart —
described by its own migration as "deliberately narrow." Merges have nothing to audit because merge
doesn't exist (§82.7). `docs/PATIENT_HEALTH_RECORD_ARCHITECTURE.md` already flags durable general
read-audit as open, independently corroborating this finding.

### 82.14 Acceptance criteria — evaluated against the above
*"Who is this person?"* — **yes, with high confidence**, for the core case: `profiles.id` +
`patient_number` is a real, stable, non-phone-based identifier, org-boundary lookups are RLS-enforced
at the Postgres level, and there's genuine (if optional) NIN/BVN identity verification. The honest
caveats: nothing catches the "four names, one patient" scenario from §82.1 before it happens (no
duplicate detection), and the clinician-facing UI answering this question in the moment (the header)
shows less than what the system already knows about the patient.
*"Which health information belongs to them?"* — **yes for the patient's own record**, and **yes,
carefully, for proxy access** — the `profile_access`/`clinical_access` split is a genuinely
well-reasoned answer to exactly this question for family/caregiver access. The gap is auditability:
Tarragon could not currently produce a full "who was granted access to my mother's record, and when
was it revoked" report, because grants/revocations aren't in the write-audit table.

## 3. Risk framing — why §82.6/§82.7 and §82.4's biometric item are not "just build it"

Unlike the specialist-matching engine (`CLAUDE.md`'s explicit guardrail), nothing here is blocked by a
standing platform rule. But two items carry real blast radius and shouldn't be scoped as ordinary
feature work:

- **Merge (§82.7)** touches the FK graph of the entire clinical record. A bad merge (wrong match,
  partial repoint, lost audit trail) is a patient-safety incident, not a bug — this needs a design
  review and a rehearsed rollback path before any code is written, not just an implementation PR.
- **Biometric verification (§82.4)** is regulatory-sensitive in a way the rest of this spec isn't.
  `CLAUDE.md`'s standing follow-ups list NDPC registration and DPO appointment as still-open items —
  adding biometric collection before those close would be building a new class of sensitive-data
  handling on top of an already-open compliance gap.
- **Duplicate detection (§82.6)**, on its own, is lower-risk than merge (flagging is reversible,
  merging isn't) but still wants an explicit decision on match-confidence thresholds and who's
  authorised to act on a flagged pair before it's built, not just a fuzzy-match algorithm dropped in.

## 4. Proposed phasing

### Phase 1 — safe to build now, no new ask needed
1. **Enrich the persistent patient-identity header** (§82.8/§82.9) — add DOB, `patient_number`, and
   `avatar_url` (all three already fetched or available elsewhere) to
   `clinician/patients/[patientId]/page.tsx`'s header. Small, additive, closes the most concrete gap
   in this doc. *Not built yet.*
2. **Enable the document-verification UI path** (§82.4) — the DB enum already supports `'document'`;
   only `identityVerificationSchema` in `apps/web/src/lib/validation/onboarding.ts` blocks it. Pure
   additive fix to an existing inconsistency. *Not built yet.*
3. **Add `profile_access`/`care_access_requests` to the write-audit trigger list** (§82.13) — same
   `private.audit_row_change()` pattern already applied to 21 other tables; closes the proxy-grant
   audit gap without inventing new audit machinery. *Not built yet.*

### Phase 2 — needs an explicit founder ask before functional code
1. **Duplicate detection / flag-for-review tooling** (§82.6) — needs a founder decision on match
   fields/confidence and who reviews flags before implementation, per §3.
2. **Patient-record merge** (§82.7) — the largest build in this spec; needs a design review before
   any scoping conversation, per §3.
3. **Adolescent transition state machine** (§82.12) — a genuine product decision (what triggers it,
   whether it's automatic or human-initiated) that doesn't yet have a founder answer.
4. **Biometric verification** (§82.4) — regulatory-sensitive, likely wants to wait on NDPC/DPO items
   closing first, per §3.
5. **"Emergency access" proxy tier** (§82.11) — needs a product definition of what "emergency" means
   operationally before it's a schema change; see the open question below.

### Phase 3 — none identified
Nothing in this spec is naturally data-volume-gated the way the referral-matching engine's ranking
algorithm is (`docs/CLINICAL_NETWORK_SPEC.md` §4/§5) — duplicate-detection tuning would benefit from
real patient volume, but that's a Phase 2 implementation detail, not a reason to defer the whole item.

## 5. Open questions for the founder

- **Keep `TH-NNNNNN` or rename to match the spec's `TRG-P-000000123` shape?** The current scheme is
  already live and patient-facing in three UI surfaces — a rename is a real migration plus a reprint
  of anything patients have already seen (emergency card, account page), not a pure cosmetic change.
- **What match confidence counts as "flag as possible duplicate," and who's authorised to act on a
  flag?** Given the founder-solo/near-solo operating model (see the `user_founder_context` memory
  note), the honest default answer may be "the founder, manually, at current patient volume" rather
  than an automated workflow — worth confirming before scoping any UI for it.
- **Is document-based identity verification worth enabling now, or should it wait for real Dojah
  credentials?** The provider adapter is real; nothing is configured yet.
- **What does "emergency access" mean operationally here?** The platform already has a working
  "acting for" model (2-hour session, INSERT-only, fully attributed) — is a genuine emergency tier a
  new consent flow, or a fast-track through the existing `care_access_requests` accept step?
- **Is adolescent transition a near-term priority?** The current child-dependant model is opt-in
  (a parent adds a child), which limits exposure — worth confirming this isn't blocking anything real
  before it's scoped as Phase 2 work.

## 6. Original spec, for reference

The incoming spec text (§82.1–82.14) is preserved as received below, since it's the source-of-truth
ask this document reconciles against.

> **82.1 Purpose**
> One of the biggest risks in a multi-provider healthcare ecosystem is having the same patient
> represented as multiple people. Example: Kola Longe / Kola A Longe / K. Longe / Kola Adekolawole
> Longe — these could incorrectly become four separate patients.
>
> **82.2 Master Patient Index**
> Tarragon needs a central identity service: IDENTITY → Tarragon ID, Verified identity, Contact
> details, Date of birth, Demographics, External identifiers, Linked records.
>
> **82.3 Tarragon patient identifier**
> Every patient receives a unique internal identifier. Example: `TRG-P-000000123`. This should not be
> based on phone number.
>
> **82.4 Identity verification**
> Depending on service/risk level, support: phone verification, email, government identity
> verification where appropriate, document verification, biometric verification where legally and
> operationally appropriate.
>
> **82.5 Phone number change**
> Patient identity should remain stable if a phone number changes.
>
> **82.6 Duplicate detection**
> System identifies potential duplicates using combinations of: name, DOB, phone, email, identity
> information.
>
> **82.7 Duplicate merge**
> If two records are determined to belong to one patient: Record A + Record B → Verified merge →
> Unified patient. The merge must preserve audit history.
>
> **82.8 Wrong-patient prevention**
> Before clinical actions — prescription, investigation, referral, consultation, medication change —
> the system should clearly identify the patient.
>
> **82.9 Patient switching prevention**
> Clinicians should not accidentally continue entering data into another patient's record.
>
> **82.10 Proxy identities**
> Support: parent → child, caregiver → elderly patient, authorised representative — without treating
> the proxy as the actual patient.
>
> **82.11 Identity permissions**
> A proxy may have: Full access where appropriate; Limited access, for example appointments,
> medication, monitoring; Emergency access where permitted and appropriately governed.
>
> **82.12 Adolescent transition**
> As patients mature: Parent-managed → Shared access → Increasing patient autonomy → Independent
> account.
>
> **82.13 Identity audit**
> Track: account creation, verification, changes, merges, proxy relationships, access.
>
> **82.14 Acceptance criteria**
> Tarragon should be able to answer with high confidence: Who is this person? and: Which health
> information belongs to them?
