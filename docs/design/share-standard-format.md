# Sharing a record in a standard format (FHIR file and SMART Health Link)

Status: built 2026-10-20, never tried against a real receiving system (OQ-708).

## What it is

A patient's time-limited share link (S09, S09x, share extras) already lets an outside clinician read chosen sections in a browser. Two standard
formats now ride on the SAME link, so software at a clinic can take the record in without anyone retyping it.

| Path | Who uses it | How it works |
| --- | --- | --- |
| "Save as a file for a hospital system (FHIR)" on `/share/{token}` | The recipient, after opening the link | Built in the browser from the record already on the page (`share-fhir.ts`). No second request, so it is never another view of a capped link. |
| `shlink:/...` SMART Health Link | A clinic's software | `POST /api/shl/{token}` returns a manifest holding one encrypted FHIR file. |

## One door

Everything goes through `record_share_by_token`. The FHIR file is a re-shaping of that answer and the manifest endpoint calls the same function,
so these all apply with no second copy of the rules: the sections the patient ticked, the date window, the PIN, the wrong-PIN lockout, the view
cap, expiry, revoke, and the patient's access log. Nothing here reads a table.

## FHIR content

`buildSharedRecordBundle` re-uses the S44 mapper (`lib/fhir/export-bundle.ts`), so a blood pressure or a lab result is coded the same way as in
the full export. A FHIR `collection` bundle, not an International Patient Summary document, and no Nigeria Core or NPHCDA profile is claimed.

Deliberately different from the full export:

- No real identifiers. The patient is `patient-1`, resource ids are counters, and no id is derived from the link's token.
- Conditions are marked unconfirmed (the share does not say who confirmed them).
- The reference range a lab printed is kept as text.
- Emergency blood group and contact are not exported (no neutral FHIR home for them).
- A wearable reading keeps its "estimate" tag.

## SMART Health Link

Spec: https://docs.smarthealthit.org/smart-health-links/spec/

- Payload: `{ url, key, flag: "P" when the link has a PIN, exp, label, v: 1 }`, base64url, prefixed `shlink:/`.
- Manifest request: JSON body with optional `recipient`, `passcode` (the PIN, never in a URL) and `embeddedLengthMax`.
- Manifest answer: `{ files: [{ contentType: "application/fhir+json", embedded: "<compact JWE>" }] }`.
- Encryption: JWE `alg: dir`, `enc: A256GCM`, `zip: DEF`, `cty: application/fhir+json`, protected header used as AAD.
- Key: `HMAC-SHA256(SHARE_LINK_KEY_SECRET, "tarragon-shl-v1:" + token)`. Nothing is stored. Without the secret there is no link and the endpoint
  answers 503; there is no unkeyed fallback.
- Answers that are not a manifest: 401 with `remainingAttempts` (PIN needed or wrong), 404 (unknown, revoked, expired, closed or locked: not
  told apart), 429 (locked, try later), 413 (the recipient cannot take the file inline), 503 (no secret), 400 (bad request).
- Open to any origin on purpose (browser-based viewers). There is no cookie and no ambient authority: the link plus the PIN is the whole credential.

The patient gets the string from `GET /api/patient/share-shl?id=` (web, cookie session) or `GET /api/mobile/share-shl?id=` (phone, bearer token).
Both read the patient's own `record_shares` row under row-level security, so another person's share id is a 404.

## Honest limits

- Each manifest request counts as a view.
- Embedded only; no separate download address.
- No hospital system has tried it.
