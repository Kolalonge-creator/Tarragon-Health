# IPS design note: International Patient Summary export (spec 2.10, builds on S44)

Invariants in play: INV-03/04 (released, non-sensitive results only, enforced by the snapshot), INV-10/12 (staff export stays audited and tied, enforced by the snapshot), INV-14 (no guard needed: this only narrows access, it exports the person's own record to the person), INV-16 (versioned mapping). Research: `docs/research/IPS.md`. **No migration, no database change.**

## 1. What already existed (reused)
`public.fhir_export_snapshot` (all access rules, audit row in `fhir_export_log`), `apps/web/src/lib/fhir` (`buildFhirBundle`, units, `fhir.mapping` config + mirror test), `GET /api/patient/fhir-export`, `/patient/data-exchange`, the import parser used by the round-trip test.

## 2. What was added
- `fhir.ips_mapping` v1 in the PROPOSED registry (owner Founder, status proposed): composition type LOINC 60591-5, the six section codes (11450-4 problems, 48765-2 allergies, 10160-0 medicines, 11369-6 immunizations, 30954-2 results, 8716-3 vital signs), which sections are required, `composition_status: preliminary`, empty-section reason `unavailable`, `profiles: {}`. Mirror test in `fhir-mapping-mirror.test.ts`.
- `lib/fhir/ips-bundle.ts` (pure): takes the SAME snapshot, runs the existing mapper, then re-shapes the output into a Bundle of type `document`: Composition first, then Patient, an Organization author ("Tarragon Health", no registration claimed), then the section resources. Each section has a LOINC code, a title and an escaped XHTML narrative. Documents are dropped.
- `exportIpsBundle` in `export-service.ts` (shares one snapshot fetch with the collection export; asks the database for the six IPS sections only, no `documents`).
- `GET /api/patient/ips-export` (cookie session, same querystring rules as the collection export, `application/fhir+json` download).
- `/patient/data-exchange` card "Download my summary (IPS)" with what it contains and leaves out, and `/patient/data-exchange/summary`, the one-page "what is inside" preview that prints as a paper copy and shows the same lines as the document's narrative.

## 3. Safety rules (each has a test in `ips-bundle.test.ts`)
- Same exclusions as the collection export: no reproductive or mental-health section exists, released labs only, no private notes, documents left out. The snapshot decides; this layer never widens it.
- A required section with nothing in it is written `emptyReason: unavailable` plus plain text "this does not mean there is nothing to record". It is never `nilknown`, and the text never says "no known allergies".
- Wearable values keep the estimate tag and note; units are the stored UCUM units; a round trip through our own import parser returns the same numbers.
- Every `reference` in the document resolves to an entry; fullUrls are unique; narrative text is XHTML-escaped.
- No profile URL, no conformance claim: `ig_status` is `ips_shaped_no_conformance_claimed`, `meta.profile` is only written if a later config version lists one, and the patient-facing copy says the file has not been checked against an official test tool and is not approved for any national system.

## 3b. Fixes from the code review (all tested)
- The live snapshot returns `excluded_domains: []` for a self export and only a `limits` caveat (items inside general sections are not classified by purpose, S47b). So copy and narrative say "no separate reproductive or mental health section" plus that caveat, never "never included", and name withheld domains only when the snapshot lists them.
- A section the reader was not given (`sections_included` lacks it) is written `emptyReason: withheld` with "not shared with whoever made this summary", never "nothing recorded".
- Narrative lines carry "(not verified)" for allergies, the abnormal flag and the reference range for results; dates are Lagos days; the newest 5 readings per kind and 3 results per test are kept (config), with the count left out shown.
- A config or mapper fault returns a typed 500, never a throw.

## 4. Consent and audit
Downloading your own record needs no per-system exchange consent: there is no outside system in the loop (the file goes to the person). Supporter access is the existing per-category rule inside the snapshot; staff access needs the tie and a written reason. Every call writes `fhir_export_log` (requester kind, sections). The log does not carry a format column, so an IPS copy is recognisable only by its section list (no `documents`); and the preview page, being made from the same call, is also logged as a copy (the preview text says so). OQ-IPS-3.

## 5. Not done / unverified
No HAPI or other validator was run (none available here), so nothing claims validity. The page was not opened in a browser (needs a signed-in local stack). No mobile entry (the spec asked for web). Not an exchange: nothing is sent anywhere.
