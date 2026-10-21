# LSI-1 design note: emergency card as a lock-screen picture

Invariants in play: the S43 rule that the person decides what a stranger sees; the S47 rule that a hidden detail is "not shared", never "none recorded"; the S47d rule that a withheld reproductive or mental health medicine is counted, never named; INV-07 (nothing clinical in an audit row or file name). Research: `docs/research/LSI-1.md`. Migration `20261021000142_emergency_card_image_audit.sql` (additive: one function, no table). Not applied by this session.

## 1. Reused, not rebuilt
`emergency_card_fields` and its chooser (S43), `lock_screen_opt_in` (already in the table, off by default, with its shared-phone warning), `applyCardFieldChoices` and the sensitive-medicine and condition filters, `buildEmergencyQrText` and `emergencyTextQrSvg`, `loadEmergencyDatasetForPatient`, the Noto Sans PDF fonts, `next/og` `ImageResponse` (satori and resvg ship inside Next, so no dependency was added), the mobile bearer-token route pattern (`/api/mobile/verified-documents/[id]/pdf`) and `expo-web-browser`. The separate S09x "lock-screen pass" (CMO-signed field list, wallet guard) is a different feature and is untouched.

## 2. What was built
- `lib/emergency/lock-screen-image.ts` (pure): the picture's content model. `lockScreenChoices(chosen, minimum)` intersects the person's choices with the usual minimum, so the minimum can only narrow. Rows: blood (patient-reported marked as a caution), allergies (severe is an alert), medicines (withheld ones counted), conditions, emergency contact, an identity line, one "not shared by the patient" line, and a footer saying it does not update itself. Long lists are cut and say how many were left off.
- `lock-screen-image-view.tsx` and `lock-screen-image-response.tsx`: a 1170 x 2532 portrait PNG, clock zone left empty at the top, flashlight zone at the bottom, plain dark ground, Noto Sans (Yoruba marks print). Order: the person's own switch must be on (else 403, nothing read), then the audit door, then the facts. `Cache-Control: private, no-store`, file name `emergency-card-lock-screen.png`.
- `public.record_emergency_card_image(include_qr, minimum)`: active patient only, own switch only, one audit row holding two booleans. A picture cannot exist without its row.
- Routes: `GET /api/patient/emergency-card/lock-screen-image` (cookie session) and `/api/mobile/emergency-card/lock-screen-image` (bearer). Both need `confirm=1`; `qr=0` and `minimum=0` are explicit opt-outs (defaults are the safe side).
- Web: a card on the emergency card page, shown only when the option is on, with the warning, a required "anyone holding my phone can read this" tick, the minimum and QR options (both on), and a save link that exists only after the tick. Mobile: the same controls on the emergency card screen; the picture opens in the in-app browser and the person presses and holds to save (no new native module or permission). The help text beside the option no longer says nothing happens.

## 3. Go-live
No platform guard: nothing leaves the person's own record except to themselves, and the per-person option is off by default, needs an explicit tick every time, and is audited. If a platform kill switch is wanted it is one more guard key and a check in `lockScreenImageResponse` (OQ-LSI-1-2).

## 4. Not built
Saving straight to the photo library on mobile (that needs a native media-library module, so the in-app browser save is used; OQ-LSI-1-1). A dependant's card. Locales other than English. A wallet or live lock-screen widget (S09x, behind its own guard).

## 5. Part B
`research_export_enabled` and `symptom_checker_enabled` are already in `GUARD_KEYS` on `origin/main-dev` (added 2026-10-15); the constants test passes and no guard was changed.
