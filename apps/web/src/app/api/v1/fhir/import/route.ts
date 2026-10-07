import { runGateway } from "@/lib/integrations/gateway";
import { fhirBundleSchema } from "@/lib/integrations/fhir/bundle-schema";
import { parseFhirResourceEntry, FHIR_PARSER_VERSION } from "@/lib/integrations/fhir/parse-resource";
import type { Database, Json } from "@tarragon/shared";

/**
 * POST /api/v1/fhir/import?patient_number=TH-000123 — Data Architecture Gaps
 * Build Plan §1 Phase 1 (docs/DATA_ARCHITECTURE_GAPS_BUILD_PLAN.md). The
 * schema/review pipeline this writes into (fhir_import_batches,
 * fhir_import_proposed_resources, private.enforce_fhir_import_resource_attribution)
 * was already fully built in migrations 20260807020405/20260807084925 —
 * this route is the missing piece that actually reaches it. A partner
 * (HMO/hospital/lab already holding a Tarragon api_keys credential with the
 * fhir:import scope) POSTs a FHIR R4 Bundle for one named patient; every
 * recognised entry becomes a 'proposed' row a clinician reviews at
 * /clinician/fhir-review — nothing here writes directly into
 * vitals_readings/patient_allergies/medications/vaccination_records. See
 * that migration's own header for the full safety-line reasoning.
 *
 * patient_number lives in the query string (not the Bundle body) for the
 * same reason /api/v1/patients does it that way: it must never appear
 * inside the logged endpoint value the gateway's own api_requests.endpoint
 * column records as a route TEMPLATE. The Bundle itself may reference a
 * FHIR Patient resource, but this v1 route does not attempt to parse or
 * cross-check it -- the query param is the single source of truth for
 * which Tarragon patient a Bundle is for.
 *
 * S44 hardening: the whole write is one database call (`fhir_import_accept`) that checks the person's consent for this source system first and
 * stores nothing without it (403 consent_required), keeps EVERY received resource as evidence in `external_records` (including types and
 * entries that cannot be proposed), supersedes an older still-proposed copy of the same source resource, and emits one bus event.
 * `x-fhir-source-system` is required. Observation units are checked and converted before anything is proposed (see lib/fhir/units.ts).
 *
 * Route path is /api/v1/fhir/import, not /api/integrations/fhir/import as
 * the original 2026-08-07 migration header guessed -- that guess predates
 * the shared gateway pipeline (lib/integrations/gateway.ts), which is now
 * the documented convention for "any future partner endpoint" (its own
 * header comment). The six pre-existing /api/integrations/* routes stay
 * exactly as they are; this is a new endpoint, so it uses the current
 * pattern.
 */
export async function POST(request: Request): Promise<Response> {
  return runGateway(request, {
    version: "v1",
    endpoint: "/api/v1/fhir/import",
    scope: "fhir:import",
    schema: fhirBundleSchema,
    handle: async (bundle, { verified, supabase, request: req }) => {
      const patientNumber = new URL(req.url).searchParams.get("patient_number")?.trim();
      if (!patientNumber || !/^TH-\d{6}$/.test(patientNumber)) {
        return { status: 400, body: { error: "patient_number query param must look like TH-000123" } };
      }

      const { data: patient } = await supabase
        .from("profiles")
        .select("id")
        .eq("patient_number", patientNumber)
        .eq("organisation_id", verified.organisationId)
        .eq("role", "patient")
        .maybeSingle();
      if (!patient) {
        return { status: 404, body: { error: "Patient not found in this organisation" } };
      }

      const sourceSystem = req.headers.get("x-fhir-source-system")?.trim().slice(0, 120) ?? "";
      if (!sourceSystem) {
        return { status: 400, body: { error: "x-fhir-source-system header is required: say which system these records come from" } };
      }
      const bundleIdentifier = bundle.identifier?.value ?? bundle.id ?? null;

      const resourceCounts: Record<string, number> = {};
      const skipReasons: { resourceType: string; reason: string }[] = [];
      // One entry per resource received. A resource we can propose carries a normalised payload; every other one (an unsupported type, or one that
      // failed to parse) is still kept as evidence in external_records, never silently dropped, and has no payload (stored_only).
      const resources: {
        resource_type: Database["public"]["Enums"]["fhir_import_resource_type"] | null;
        fhir_resource_type: string;
        fhir_resource_id: string | null;
        raw_resource: unknown;
        normalized_payload: Record<string, unknown> | null;
        parse_warnings: string[];
        parser_version: number;
      }[] = [];

      for (const entry of bundle.entry) {
        const resource = entry.resource;
        if (!resource) {
          // A structurally valid Bundle entry with no embedded resource (e.g. a reference-only transaction entry) is recorded, never dropped.
          resourceCounts["(no resource)"] = (resourceCounts["(no resource)"] ?? 0) + 1;
          skipReasons.push({ resourceType: "(no resource)", reason: "Bundle entry has no embedded resource" });
          continue;
        }
        resourceCounts[resource.resourceType] = (resourceCounts[resource.resourceType] ?? 0) + 1;

        const parsed = await parseFhirResourceEntry(resource, supabase);
        if (!parsed.ok) {
          skipReasons.push(parsed.skip);
          resources.push({
            resource_type: null,
            fhir_resource_type: resource.resourceType,
            fhir_resource_id: resource.id ?? null,
            raw_resource: resource,
            normalized_payload: null,
            parse_warnings: [parsed.skip.reason],
            parser_version: FHIR_PARSER_VERSION,
          });
          continue;
        }
        resources.push({
          resource_type: parsed.proposal.resourceType,
          fhir_resource_type: resource.resourceType,
          fhir_resource_id: parsed.proposal.fhirResourceId,
          raw_resource: resource,
          normalized_payload: parsed.proposal.normalizedPayload,
          parse_warnings: parsed.proposal.parseWarnings,
          parser_version: FHIR_PARSER_VERSION,
        });
      }

      // One atomic database call: the consent check, the batch, the proposals, the evidence rows and the bus event happen together or not at all.
      // Consent is checked INSIDE the function, so nothing is stored for a person who has not allowed this source (spec 2.10, 2.11).
      const { data: accepted, error: acceptError } = await supabase.rpc("fhir_import_accept", {
        p_org: verified.organisationId,
        p_api_key: verified.keyId,
        p_patient: patient.id,
        p_source: sourceSystem,
        p_bundle_identifier: bundleIdentifier,
        p_raw_bundle: bundle as unknown as Json,
        p_counts: resourceCounts as unknown as Json,
        p_skips: skipReasons as unknown as Json,
        p_resources: resources as unknown as Json,
      });
      const result = (accepted ?? {}) as { status?: string; batch_id?: string; already_processed?: boolean; proposed_count?: number; stored_only_count?: number; resource_counts?: unknown; skip_reasons?: unknown };
      if (acceptError) {
        return { status: 500, body: { error: "Could not record this import. Nothing was saved; please retry the same request." } };
      }
      if (result.status === "consent_required") {
        return { status: 403, body: { error: "consent_required", message: "This person has not allowed records from this source to be received. Nothing was stored." } };
      }
      if (result.status === "source_required") {
        return { status: 400, body: { error: "x-fhir-source-system header is required" } };
      }
      if (result.status === "patient_not_found") {
        return { status: 404, body: { error: "Patient not found in this organisation" } };
      }
      if (result.status !== "ok" || !result.batch_id) {
        return { status: 500, body: { error: "Could not record this import" } };
      }
      if (result.already_processed) {
        return {
          status: 200,
          body: { batch_id: result.batch_id, already_processed: true, resource_counts: result.resource_counts, skip_reasons: result.skip_reasons },
        };
      }

      return {
        status: 200,
        body: {
          batch_id: result.batch_id,
          already_processed: false,
          proposed_count: result.proposed_count ?? 0,
          stored_only_count: result.stored_only_count ?? 0,
          skipped_count: skipReasons.length,
          resource_counts: resourceCounts,
          skip_reasons: skipReasons,
        },
      };
    },
  });
}
