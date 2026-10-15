# P5 credentialing: competitor and regulator research (2026-10-13)

Method: standard web searches on 2026-10-13, search snippets and a few vendor or regulator pages. No page was a signed contract, a vendor sandbox or a legal opinion. Tags: [V] vendor claim, [P] peer reviewed, [G] guideline or regulator, [NV] not verified. "Adopted" means the idea shaped our design or code; nothing was copied.

## 1. Primary source verification of the licence (Q14)
- MDCN names DataFlow as its primary-source verification (PSV) provider for registered doctors, expatriates and foreign-trained Nigerian graduates; the applicant starts it on DataFlow's portal and pays there; a customer reference sheet lists about USD 180 to 265 depending on package (dated 2025) [G, V]. No public MDCN register API was found [NV].
- Older ECFMG/EPIC pages still say MDCN registration needs EPIC verification for foreign graduates; which one applies today is unclear [NV].
- US practice: NCQA-style credentialing verifies at the source before a clinician is approved, with a bounded window (90 to 120 days reported; vendor blogs, not NCQA text) [V, NV]. Wheel, OpenLoop, Teladoc: staffed credentialing operations, details not public [NV].
- Adopted: a first-class check kind `primary_source` with route (DataFlow, written MDCN confirmation, register check), reference, date, verifier and an evidence file; a reference cannot vouch for two people; maker-checker retained (the verifier of any check cannot approve). Code: `record_credential_check`, `clinician_primary_source_verifications`, `private.psv_satisfied`.
- Unsuitable for Nigeria as copied: US-style automated feeds do not exist here, so the route is a person reading a report, and DataFlow is applicant-initiated and may not cover locally trained doctors. We therefore accept three routes instead of mandating DataFlow.

## 2. Continuous monitoring and re-check (Q15)
- NCQA-style programmes monitor licence status monthly against board feeds [V, NV]. UK GMC publishes a register patients and employers can check, with revalidation on a five-year cycle built from annual appraisals [G]. Nigeria has no feed, so monitoring means a person looking again.
- Adopted: a daily sweep (`private.credential_recheck_sweep`, 05:37) opens a work item six months after the last verification, tells reviewers once, flags overdue once to reviewers and the CMO hub, and never suspends. Suspension stays driven by the licence and cover dates (`credential_expiry_sweep`).
- Not adopted: monthly checks (no source to check against) and automatic suspension on a missed re-check (a late reviewer would pause a safe doctor).

## 3. New-clinician early review (Q16)
- Joint Commission: a period of focused professional practice evaluation (FPPE) for every new privilege, no exemption for experience; the process must be predefined and applied consistently; ongoing evaluation (OPPE) is periodic, often yearly [G, V]. Whether OPPE is mandated by that name is disputed between sources [NV].
- Adopted: `sampling.new_clinician_full_review_cases = 20` in `quality_config` v2 (PROPOSED, a design choice not a guideline figure): every one of a clinician's first 20 red or prescribing cases is audited, then the existing sample applies. Code: `private.consider_task_for_audit`, `private.new_clinician_case_ordinal`, mirrored in `auditReason`.
- Kept: red events and titrations were already 100 percent audited; this extends full review to other prescribing work.

## 4. Patient-facing verified clinician profile (Q17)
- Zocdoc: credentials are checked at onboarding but there is no credential badge on the profile; the visible badges are "verified patient" on reviews and a performance badge [V]. Practo shows "Medical Registration Verified" with no public criteria [V, NV]. Doctolib verifies practitioners with ID, liveness and a register number before listing, deletes the ID image after the check, and tightened rules after fake practitioners appeared [V, press]. Celo shows a verified-profession mark [V].
- Adopted: one shared, null-gated component `LicenceVerifiedBadge`, fed only by `clinician_licence_verified_on()`; it shows "Licence verified on <date>" and nothing else, and only while the stored record exists and the licence on file is in date. Used on the doctor profile, care message author line, booking and the consultation room.
- Unsafe or unsuitable: Practo-style unexplained labels (no criteria shown is a trust claim we cannot back); showing the folio number (forgery and misuse risk). Note: `clinical_staff_directory` already exposes `credential_number` to any signed-in user in the organisation; that is a pre-existing exposure to review (closeout, OQ).

## 5. Identity verification vendors
- Dojah documents a BVN or NIN plus selfie call and a free sandbox [V]. Prembly lists BVN with face and NIN with face methods and liveness [V]. Youverify returns a face match confidence score against a threshold and offers a liveness SDK [V]. Smile ID documents NIN and BVN lookups; face match for Nigeria not confirmed in this search [V, NV]. Prices were not found except Dojah's wallet top-up [V]. NIN lookup outages at the data source are reported [V, NV].
- Adopted in code: the adapter returns outcome only (found, face match decision, score, liveness), the vendor reference and the last four digits; it takes an opaque subject id and a consent id; an empty or malformed input is refused; the number and image never appear in a result or error (contract test). A failed or inconclusive check is information for a human, never an auto-reject.
- Not done: no vendor, no key, no real call (decision waits for the DPO and counsel).

## 6. NDPA and GAID on storing government ID
- The NDPA 2023 is implemented by the GAID 2025 (issued March 2025, in force September 2025 per one source) with data protection impact assessments for high-risk processing such as sensitive data and systematic monitoring [G, secondary]. Biometric and national ID data are generally treated as sensitive [NV for NIN and BVN specifically]. Retention periods for NIN or BVN were not found [NV].
- Adopted: data minimisation by construction (see section 5) and a documented follow-up for the DPO: a DPIA before any pilot, and a written retention rule for the ID document files already collected (document purge stays OFF).

## 7. Folding the two credential ladders (OQ-100)
- Mature credentialing systems keep one expiry process and one grace concept; we have the S15 sweep (suspend at expiry after an audited grace) and the older CMO-signed section 29.7 ladder (`provider_restrictions`, warning, grace, service restriction, suspension, which restricts new bookings only). Plan is in the design note, section 9. Needs the CMO.
