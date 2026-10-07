import type { FhirOut } from "../export-bundle";

/**
 * The seam for exchanging records with an outside electronic record system (S44, spec 2.11). It is an interface and nothing more: the platform
 * does NOT claim an integration with any named system. Whether a given vendor offers an API Tarragon may use is unverified; the one-facility
 * pilot plan (docs/plans/S44-helium-health-pilot.md) says what must be confirmed first.
 *
 * Direction rules (both are enforced in the database, not here):
 *   - Inbound: `external_exchange_consents` must hold an active import consent for this exact source name, or `fhir_import_accept` stores nothing.
 *     Whatever arrives is evidence in `external_records` and a proposal a clinician files; it is never the record on arrival.
 *   - Outbound: only what `fhir_export_snapshot` returns for the person (or a person they allow), under an export consent for the destination.
 */
export interface ExternalRecordAdapter {
  /** The source name used in consents and on every received record, lower case. */
  readonly sourceSystem: string;
  /** Plain-words state shown to staff: nothing is live until a pilot facility, an agreement and credentials exist. */
  readonly status: "not_configured" | "pilot" | "live";
  /** Pull the records a consenting person's facility holds, as FHIR resources for the import route. */
  fetchRecords(input: { patientReference: string }): Promise<AdapterResult<FhirOut[]>>;
  /** Send a Tarragon summary Bundle back to the facility. */
  sendSummary(input: { patientReference: string; bundle: FhirOut }): Promise<AdapterResult<{ acknowledgementId: string }>>;
}

export type AdapterResult<T> = { ok: true; value: T } | { ok: false; reason: "not_configured" | "unavailable" | "refused"; message: string };
