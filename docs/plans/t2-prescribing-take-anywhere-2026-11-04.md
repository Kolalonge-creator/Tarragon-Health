# T2-11: take the signed prescription to any pharmacy (2026-11-04)

Founder decision, given in chat as CMO: "prescription should be open and this should generate a PDF form of prescription that patient
can take to a pharmacy, this need to be active". Recorded as T2-11 in `docs/DECISIONS.md`.

## 1. Audit findings (main-dev, 2026-11-04, read from a local replay of every migration, not from migration comments)

**Most of the take-anywhere path was already built.** What blocked it was the gate, not the product.

| Piece | Where | State before this change |
|---|---|---|
| Signing | `public.prescribe_medication` / `amend_medication` call `private.issue_signed_prescription` (draft, then signed). `private.enforce_prescription_rules` refuses draft to signed with `prescribing_guard_off` unless the `prescribing_enabled` master is on (or both accounts are test accounts). | Built, closed by the master. |
| Safety rules | `private.has_prescribing_authority` (Senior Medical Officer or CMO), tie to the patient (S05f), `private.check_prescription_safety` (controlled medicine hard stop, allergy match, empty allergy list, duplicate), quantity and duration required, signed content frozen, forward-only state machine. | Built, not behind the master, untouched here. |
| Patient copy | The signed prescription is projected into `public.medications` (source `clinician`) with `rx_number`, `verification_code`, `public_token` and `expires_at`. Patient medicines list shows `PrescriptionDownload` (Rx number, code, validity, PDF button). Mobile medicine cabinet has the same PDF via `/api/mobile/prescriptions/[id]/pdf`. | Built. |
| PDF | `/api/patient/prescriptions/[medicationId]/pdf` (and bundle, mobile, clinician reprint). `lib/prescriptions/prescription-document.tsx`: letterhead (trading name, legal name, RC number), patient name, patient number, date of birth, age, sex, drug, dose, route, frequency, duration, quantity, repeats, indication, instructions, prescriber name and MDCN credential, signature image, date, Rx number, verification code, QR to `/verify-rx/[token]`. Issuing rules refuse a non-clinician, stopped, superseded or expired row, a missing identifier, an unverified or placeholder prescriber credential, and a controlled medicine. Every download is audited (`prescription.pdf_downloaded`); a failed audit write refuses the download. | Built. |
| Verification | `/verify-rx/[token]` calls `public.verify_prescription_public` (anon): status, medicine, repeats and supplies used, prescriber credential only when the licence is verified. A pharmacist can record a supply there (`record_prescription_supply_public`); the phone desk can verify and record too. Not behind the master. | Built. |
| Partner collection | `patient_choose_pharmacy`, `patient_collection_pharmacies`, pharmacist lists, counter checks, supplies and questions, all behind `private.pharmacy_collection_on()`, which was just the master. | Built, optional. |

**The gaps found:**

1. **The master could never open with zero partners.** `prescribing_enabled`'s conditions were five pharmacy facts (an active partner, a
   verified licence and location, collection rules confirmed, the pharmacy notification sender) plus the safety case and the CMO switch.
   Tarragon has no contracted pharmacy, so signing (and therefore the PDF) could never go live.
2. **The patient screen offered "Choose where to collect" for every signed prescription**, whether or not any partner existed, leading to
   a dead end and implying a contracted pharmacy.
3. **A clinician signing while the master is off saw "We could not save this medication just then. Please try again."** (add form) or the
   raw `prescribing_guard_off` (amend form). Retrying cannot help.
4. **T2-09 (Phase 4) dropped two Membership inclusion lines**: written questions between calls, and prescriptions the care team signs.

## 2. What changed

Migration `20261104233059_t2_11_prescribing_take_anywhere.sql`:

- `prescribing_enabled` (still a `master`, still `switch_role = 'cmo'`, still OFF) now has three conditions: at least one active senior
  doctor with a verified, unexpired registration and a real credential number (`private.prescriber_ready_count()`; the PDF refuses to
  print without one), the clinical safety case (attestation), and the CMO pressing the switch. Added at the top of
  `private.go_live_conditions` by the anchored-insert pattern; the old pharmacy branch further down the wrapped chain is now unreachable.
- Partner collection keeps every condition it had, as its own check: `private.pharmacy_partner_collection_ready()` (a choosable partner
  pharmacy, the collection rules confirmed for the active `pharmacy_config` version, or the newest one when none is active, so the S28
  "no active config" fallback keeps working, and the pharmacy notification sender attested). `private.pharmacy_collection_on()` is now the
  master AND that readiness, so with zero partners it is false whatever the master says.
- `public.partner_pharmacy_collection_available()` (authenticated only) tells the patient screen whether to offer "Choose where to collect".
- The guard's `blocks`, `condition_text`, `enforced_in` and `not_enforced_in` text says the above.
- `catalog_items.included_keys` for the Membership gains `incl.4` and `incl.5`.

App: `PrescriptionDownload` offers the collection choice only when a partner is ready (fails closed while loading or on error) and says
"Take this to any licensed pharmacy you choose and pay the pharmacy there"; both prescribing forms show a plain sentence for the closed
master; the marketing `MEMBERSHIP_INCLUDES` list and `packages/i18n/src/en.ts` carry the two restored lines.

## 3. What the founder does to switch prescribing on

1. Make sure at least one senior doctor's `clinical_staff` row has a verified, unexpired licence and a real MDCN number (the go-live page
   shows the count on the `prescriber_registration_verified` line).
2. As CMO, record the clinical safety case for prescribing on the go-live page (`clinical_safety_case_current`, naming the document,
   version and signer). This is a CMO judgement; no agent records it.
3. As CMO, switch `prescribing_enabled` on from `/clinician/go-live` with a note.

Partner pharmacy collection stays off until a real partner pharmacy is onboarded, its collection rules are confirmed and the notification
sender is attested. Nothing else needs to change for it.

## 4. Not done here

- The older prescribing branch in the wrapped condition chain is left in place (dead code), as G-01 section 7 does for feature branches.
- No live verification: nothing was applied to the production database. The PDF route was not exercised in a browser; it was already
  covered by its own tests and is unchanged.
