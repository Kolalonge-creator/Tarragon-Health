# RCPT-1 design note: consent receipts as a one-page PDF

Invariants in play: INV-10 spirit (the download is audited), INV-07 (nothing clinical in the output), the S42 rule that wording counsel has not approved is marked as placeholder, the S04b-2 rule that receipts are append-only evidence. Research: `docs/research/RCPT-1.md`. Migration `20261020232611_consent_receipt_data.sql` (additive, later than the newest file on `origin/main-dev` and newest live version). Not applied by this session.

## 1. What exists (reused)
`consent_matrix_events` (S42, append-only, data type x purpose), `consent_matrix_cells` (wording keys and `wording_status`), `patient_consents` + `patient_consent_receipts` view (S04b-2: exact words, version, fingerprint, channel, who), `my_consent_matrix`, the privacy page with a receipts panel and the matrix history, `@react-pdf/renderer` routes under `/api/patient/*/pdf`, `private.log_audit`, the `consent.*` i18n keys.

## 2. What was built
- `public.consent_receipt_data(scope, ref)`: scope `matrix_event`, `document_event` or `all`. The caller is `auth.uid()`; there is no patient argument; only an active patient-role account may call it (the gate `set_consent_cell` uses). Another person's id is "not found", the same as a made-up one (no oracle, no audit row). One audit row per successful call (`consent.receipt_downloaded`, scope and ref only), written in the same function as the read, so a receipt cannot be produced without it. `my_consent_matrix_history` now also returns each entry's id.
- `GET /api/patient/consent-receipt/pdf?scope=all|matrix_event|document_event&id=`: zod-validated, 401 signed out, 404 for a refused role or someone else's id, 400 bad input, 503 on error or a malformed answer (never a shorter receipt). File name `consent-receipt-YYYY-MM-DD.pdf`, no person or choice in it. `Cache-Control: private, no-store`.
- `lib/consent/consent-receipt.ts` (zod parse + plain-language view) and `consent-receipt-document.tsx` (A4, black on white, no logo image, no colour). Strings under `consent.receipt.*`, English only, no em dashes.
- Screens: "Download my current choices (PDF)" and a per-entry "Download receipt (PDF)" in the matrix history; a per-receipt link in the agreements receipts panel.

## 3. What a receipt shows
A change: what kind of information, what it can be used for, agreed or withdrew, when (Lagos), how it was recorded, the wording version, whether the wording is placeholder or approved, the exact words (matrix wording, or the agreement text with its fingerprint), how to change it. The whole picture: every kind of information with each purpose on or off, needed-for-care marked, last changed date, and the agreements accepted. Placeholder wording is marked in the heading of its section and in a boxed note. A record from before receipts existed says "not recorded at the time" and shows no fingerprint.

## 4. Safety rules (each has a test)
Own rows only; refused roles (clinician, admin, caregiver, signed out, anon, inactive patient) get nothing and write no audit row; no clinical value in the source or the page; a malformed response is an error; the audit row holds ids only; the audit cannot be removed without a test failing (sabotage); the own-rows filter and the role gate likewise.

## 5. Not built
Mobile: the app has no way to fetch a session-authenticated PDF from the web route (the existing mobile document flows use their own bearer routes), so the mobile privacy screen is unchanged (OQ-RCPT-1-1). A guardian downloading a dependant's receipts (own rows only was the brief). Locales other than English.
