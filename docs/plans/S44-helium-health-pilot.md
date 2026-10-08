# Helium Health one-facility pilot plan (S44, spec 2.11)

Status: a plan, not an integration. Nothing in the platform talks to Helium Health. `apps/web/src/lib/fhir/adapters/helium-health.ts` returns "not configured" for every call.

## What must be confirmed before any engineering
1. Does Helium Health offer a documented API to a third party (FHIR or otherwise), on which plan, under what terms? Public sources do not say; ask the vendor.
2. One pilot facility on Helium Health willing to sign a data-sharing agreement, with a named clinical lead.
3. Counsel's view on the consent wording and on data processing terms for both directions.
4. The CMO's scope: which resource types, which direction first.

## Proposed shape once 1 to 4 are true
- Inbound first: the facility sends a FHIR Bundle for a named, consenting person to `POST /api/v1/fhir/import` with `x-fhir-source-system: helium health`. Without the person's active import consent for that exact name the call returns 403 and stores nothing. Everything received is kept as evidence (`external_records`); observations, medicines, allergies and immunisations become proposals a clinician files.
- Outbound second: a Tarragon summary Bundle from `fhir_export_snapshot` under an export consent for the destination, only what the person is allowed to share.
- Success measure for the pilot: number of consenting people, share of received items a clinician could file without editing, and zero items filed in a wrong unit.

## Not promised
No timeline, no integration claim in marketing, no second facility until the first has run.
