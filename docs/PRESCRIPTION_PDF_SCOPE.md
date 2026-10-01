# Prescription PDF for the patient: scope (2026-10-01)

Status: a scoping document, not a build order. Nothing here is built. Founder decisions are listed in section 7; none is assumed.

## 1. The gap

A clinician can prescribe, confirm a refill and amend a prescription (S05f, verified live on 2026-10-01). The patient then sees the prescription on the medication card (drug, dose, "Signed by", valid-until, the Rx number) and is notified by email. There is no document the patient can take to a pharmacy:

- no prescription PDF exists anywhere in `apps/web` or `apps/mobile` (PDFs exist for lab results, referral letters, vaccination certificates, verified documents, the health passport and reports);
- the **verification code** (`medications.verification_code`) is shown to nobody. The pharmacist verify form (`/pharmacist/verify`, `verify_prescription(rx_number, code)`) needs both, and its own comment says "a patient's prescription shows" them. No screen does.
- `verify_prescription` only answers a logged-in pharmacist. The four `pharmacy_partners` rows are all inactive. The platform's stated model is that patients buy from any pharmacy, so the pharmacy that receives the paper will not have an account.

So today a patient cannot present a complete, checkable prescription. Everything needed to build one already exists in the data model.

## 2. What already exists (build on it, do not duplicate)

| Piece | Where | Note |
|---|---|---|
| Prescription fields | `medications` (`source = 'clinician'`) | drug, dose, frequency, route, quantity, duration_days, repeats_allowed, indication, instructions, `rx_number` (`TRG-RX-<year>-<6-digit sequence>`), `verification_code` (6 hex characters), `expires_at`, `version`, `previous_version_id`, `superseded_at`, `added_by` (the signing clinician) |
| Lifecycle | `private.stamp_prescription_lifecycle` | assigns the three identifiers on insert; expiry is 6 months for repeats, `duration_days` plus 30 for a one-off course, else 90 days. The migration itself calls these policy defaults, not legal citations |
| Amendment | `amend_medication` | creates v2 with a NEW Rx number and marks v1 superseded, so an old paper can be recognised as superseded |
| Status logic | `verify_prescription` | returns `active`, `superseded`, `expired` or `cancelled`, plus repeats used (approved repeat requests) |
| PDF pattern | `app/api/patient/verified-documents/[id]/pdf/route.ts`, `lib/verified-documents/verified-document.tsx`, mobile route under `app/api/mobile/verified-documents/` | `@react-pdf/renderer`, cookie-session RLS route for web, bearer route for mobile, issuer fetched through `clinical_staff_directory` (the safe-column view) |
| QR | `qrcode` is already a dependency | |
| No-login verification pattern | `app/verify-report/page.tsx`, `emergency_card_by_token`, `health_passport_by_serial` | bare anon client, two codes required, never returns content beyond proof |
| Signing UX | "Review & sign prescription" attestation on the chart | the clinician already attests before it is issued |
| Patient notification | "Patient notified, email sent at time of prescribing" on the card | |
| Prescriber identity | `clinical_staff.credential_type/credential_number`, `license_verified_at` | note: some live staff carry placeholder numbers such as `MDCN-PENDING-...` |

The v5 `prescriptions` table (items jsonb, `collection_code`, state, `pharmacy_partner_id`) exists with 0 rows and no application writer. It is the intended future multi-item model. This scope does NOT write to it (that would create a second source of truth); the PDF is generated from the live `medications` rows.

## 3. Goals and non-goals

Goals
1. The patient (and a caregiver with `view_medication`) can download or open a PDF of any current clinician prescription, from web and mobile.
2. The PDF carries everything a dispensing pharmacist needs and a way to check it is genuine and still valid.
3. A superseded, expired or cancelled prescription cannot be presented as current: its PDF is refused, and a stale printed copy verifies as not current.

Non-goals (this scope)
- Pharmacy ordering, delivery or any pharmacy-network integration (partners are inactive).
- Recording that a pharmacy dispensed (see phase 3).
- Controlled-substance prescribing (see decision D5).
- Sending the PDF over WhatsApp or SMS. Those channels remain notification-only; the PDF is an in-app download. A patient may share it themselves.
- Writing the v5 `prescriptions` table.

## 4. Design

### The document (one PDF per prescription row)
Letterhead (TarragonHealth wordmark, locality-level headquarters only; no street address, no invented clinic). Then: patient name, patient number, date of birth and age; drug, dose, route, frequency, quantity, duration, repeats allowed; indication and patient instructions where present; prescriber name, credential type and number, and "Electronically signed on <date and time>" (no drawn signature image); **Rx number and verification code in clear text**; valid-until date; version number ("Version 2, replaces TRG-RX-...-000365" when amended); a QR code to the verification page; a footer line: "Check this prescription is genuine and current at <verify URL> before dispensing."

### Issuing rules (enforced server side, in the route and a tested pure builder)
- Only `source = 'clinician'`, `is_active`, not superseded, not expired.
- Only if the prescriber has a verified licence (`license_verified_at` set) and a real credential number. A `...-PENDING-...` placeholder must refuse with a clear message, never print.
- The caller is the patient, or a caregiver admitted by the same rule the medication list uses (`view_medication` or the medications category grant).
- Every download writes an audit row.

### Verification (phased)
- Phase 1: the existing logged-in pharmacist verify keeps working. The PDF's code is what makes it usable.
- Phase 2: a no-login page `/verify-rx` with an anon RPC returning proof only: status (active, superseded, expired, cancelled), the drug name and dose (so the pharmacist can match it to the paper), repeats remaining, and the prescriber's name. It never returns patient name, date of birth or contact details. See D2 for the code strength problem.

## 5. Phases

| Phase | Scope | Size |
|---|---|---|
| 1 | Pure PDF data builder with Jest tests; `GET /api/patient/prescriptions/[medicationId]/pdf` (web) and a bearer route (mobile); react-pdf document; "Download prescription" on the patient medication card (web and mobile) for eligible rows; audit row; refusal cases; a DB proof only if a new function is needed | about one session |
| 2 | No-login verification: stronger public token (D2), anon RPC with rate limiting, `/verify-rx` page, QR points to it, proof with sabotage that the RPC cannot return patient data | about one session, after D2 |
| 3 | Dispensing record and repeat control: a logged-in pharmacist marks dispensed, or a patient "I collected this" (the receipt-confirmation table exists), decrementing repeats; blocks reuse | depends on pharmacy partners going live; do not start before then |
| 4 | Clinician side: reprint in the chart; automatic patient notice when an amendment makes their saved PDF stale; expiring-soon reminder | small, any time after phase 1 |

## 6. Risks and how the design answers them

- **A PDF can be edited.** A printed or edited copy proves nothing alone. The control is the QR and code check against the live record, which is why phase 2 matters; phase 1 alone is "a good record plus a checkable code for logged-in pharmacists".
- **Reuse at several pharmacies.** Until dispensing is recorded (phase 3) nothing stops it. State this plainly in the product copy and the document footer; do not claim single-use.
- **Guessable identifiers.** The Rx number is a visible sequence and the code is only 24 bits. Safe behind a pharmacist login; not safe for a public endpoint (D2).
- **PHI on devices and in shares.** The PDF holds name, date of birth and a drug list. Treat as the patient's own copy, add a short "personal medical document" footer, log downloads, and never attach it to a notification.
- **Wrong or placeholder prescriber identity.** Issuing rules above; the live data already contains placeholder credential numbers, so this guard is not hypothetical.
- **Amended prescriptions.** v1's PDF stops downloading; a saved v1 verifies as superseded.
- **Regulatory validity.** Whether an electronic, QR-verified document is accepted by Nigerian pharmacies and consistent with Pharmacists Council of Nigeria and MDCN expectations is not established. This is the same open founder item as the tier-ladder regulatory confirmation.

## 7. Decisions needed (recommendation first)

| ID | Decision | Recommendation |
|---|---|---|
| D1 | Build phase 1 now, or wait for D2/D3? | Phase 1 now: it closes the visible gap, is low risk, and works for any pharmacy that accepts a printed copy |
| D2 | Public verification: allow no-login checks? | Yes, proof-only, with a new high-entropy public token (not the 6-character code) and rate limiting; phase 2 |
| D3 | Dispensing record and repeat control before partners are live? | No; wait for partner onboarding |
| D4 | Does the PDF show the patient's address and phone? | No by default (not stored reliably); name, patient number and date of birth are enough for matching |
| D5 | Controlled or opioid drugs (the drug-safety rules already recognise tramadol, codeine, morphine, pethidine and similar) | Refuse a PDF for these until counsel confirms the paper-form requirement; show "collect a paper prescription from your care team" |
| D6 | One PDF per drug, or all active prescriptions in one document? | One per drug now (matches the data); an "all active" bundle later if wanted |
| D7 | Counsel review of electronic-prescription validity in Nigeria | Yes, before marketing it as pharmacy-ready; not a blocker for building phase 1 |

## 8. Test plan

- Jest: the builder (eligibility matrix: patient-sourced, superseded, expired, cancelled, placeholder credential, missing licence), route statuses (401, 404, 403, 200 with a PDF content type), audit call.
- Live click-through: tied clinician prescribes then the patient downloads; amend then the old download is refused; caregiver with and without the grant; an untied clinician gets no PDF; scan the QR; verify through the pharmacist screen using the printed code.
- Phase 2 proof: the public RPC returns the same answer for "no such prescription" and "wrong code", cannot return patient fields, and is rate limited.
