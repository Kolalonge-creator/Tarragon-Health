import { runGateway } from "@/lib/integrations/gateway";
import { fhirBundleSchema } from "@/lib/integrations/fhir/bundle-schema";
import { parseFhirResourceEntry, FHIR_PARSER_VERSION } from "@/lib/integrations/fhir/parse-resource";
import type { Database } from "@tarragon/shared";

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

      const sourceSystem = req.headers.get("x-fhir-source-system")?.slice(0, 200) ?? null;
      const bundleIdentifier = bundle.identifier?.value ?? bundle.id ?? null;

      // Org-scoped dedupe (fhir_import_batches_org_bundle_idx) — a retry of
      // the exact same Bundle identifier for this org is a clean no-op, not
      // a duplicate batch full of duplicate proposals. This is a best-effort
      // check, not the only defence against a duplicate — see the unique
      // constraint handling around the insert below for the concurrent case.
      if (bundleIdentifier) {
        const { data: existingBatch } = await supabase
          .from("fhir_import_batches")
          .select("id, resource_counts, skip_reasons")
          .eq("organisation_id", verified.organisationId)
          .eq("fhir_bundle_identifier", bundleIdentifier)
          .maybeSingle();
        if (existingBatch) {
          return {
            status: 200,
            body: {
              batch_id: existingBatch.id,
              already_processed: true,
              resource_counts: existingBatch.resource_counts,
              skip_reasons: existingBatch.skip_reasons,
            },
          };
        }
      }

      const resourceCounts: Record<string, number> = {};
      const skipReasons: { resourceType: string; reason: string }[] = [];
      const proposals: {
        resource_type: Database["public"]["Enums"]["fhir_import_resource_type"];
        fhir_resource_id: string | null;
        raw_resource: unknown;
        normalized_payload: Record<string, unknown>;
        parse_warnings: string[];
      }[] = [];

      for (const entry of bundle.entry) {
        const resource = entry.resource;
        if (!resource) {
          // A structurally valid Bundle entry with no embedded resource
          // (e.g. a reference-only transaction entry) is still recorded,
          // never silently dropped — same invariant every other unsupported
          // entry gets via skipReasons below.
          resourceCounts["(no resource)"] = (resourceCounts["(no resource)"] ?? 0) + 1;
          skipReasons.push({ resourceType: "(no resource)", reason: "Bundle entry has no embedded resource" });
          continue;
        }
        resourceCounts[resource.resourceType] = (resourceCounts[resource.resourceType] ?? 0) + 1;

        const parsed = await parseFhirResourceEntry(resource, supabase);
        if (!parsed.ok) {
          skipReasons.push(parsed.skip);
          continue;
        }
        proposals.push({
          resource_type: parsed.proposal.resourceType,
          fhir_resource_id: parsed.proposal.fhirResourceId,
          raw_resource: resource,
          normalized_payload: parsed.proposal.normalizedPayload,
          parse_warnings: parsed.proposal.parseWarnings,
        });
      }

      const { data: batch, error: batchError } = await supabase
        .from("fhir_import_batches")
        .insert({
          organisation_id: verified.organisationId,
          api_key_id: verified.keyId,
          patient_id: patient.id,
          source_system: sourceSystem,
          fhir_bundle_identifier: bundleIdentifier,
          raw_bundle: bundle as unknown as Database["public"]["Tables"]["fhir_import_batches"]["Insert"]["raw_bundle"],
          resource_counts: resourceCounts,
          skip_reasons: skipReasons,
        })
        .select("id")
        .single();
      if (batchError || !batch) {
        // A unique-constraint violation (23505) here means a concurrent
        // duplicate request won the race on fhir_bundle_identifier between
        // our dedupe SELECT above and this INSERT — re-fetch and answer the
        // same graceful already_processed shape the SELECT above would
        // have, rather than surfacing a raw 500 for what is really a clean
        // idempotent retry.
        if (batchError?.code === "23505" && bundleIdentifier) {
          const { data: raceWinner } = await supabase
            .from("fhir_import_batches")
            .select("id, resource_counts, skip_reasons")
            .eq("organisation_id", verified.organisationId)
            .eq("fhir_bundle_identifier", bundleIdentifier)
            .maybeSingle();
          if (raceWinner) {
            return {
              status: 200,
              body: {
                batch_id: raceWinner.id,
                already_processed: true,
                resource_counts: raceWinner.resource_counts,
                skip_reasons: raceWinner.skip_reasons,
              },
            };
          }
        }
        return { status: 500, body: { error: "Could not record this import batch" } };
      }

      if (proposals.length > 0) {
        const { error: proposalsError } = await supabase.from("fhir_import_proposed_resources").insert(
          proposals.map((p) => ({
            batch_id: batch.id,
            organisation_id: verified.organisationId,
            patient_id: patient.id,
            resource_type: p.resource_type,
            fhir_resource_id: p.fhir_resource_id,
            raw_resource: p.raw_resource as Database["public"]["Tables"]["fhir_import_proposed_resources"]["Insert"]["raw_resource"],
            normalized_payload:
              p.normalized_payload as Database["public"]["Tables"]["fhir_import_proposed_resources"]["Insert"]["normalized_payload"],
            parse_warnings: p.parse_warnings as unknown as Database["public"]["Tables"]["fhir_import_proposed_resources"]["Insert"]["parse_warnings"],
            parser_version: FHIR_PARSER_VERSION,
          }))
        );
        if (proposalsError) {
          // Do NOT leave the batch row committed on its own: a retry of the
          // same bundleIdentifier would otherwise hit the dedupe check above
          // and be told "already_processed" despite zero proposals ever
          // having been written — silently losing every resource in the
          // Bundle while reporting success. Roll the batch back (cascades
          // to any proposals, though a single multi-row INSERT that failed
          // wrote none) so a retry starts clean instead.
          await supabase.from("fhir_import_batches").delete().eq("id", batch.id);
          return {
            status: 500,
            body: { error: "Could not record the proposed resources from this Bundle — nothing was saved, please retry the same request." },
          };
        }
      }

      return {
        status: 200,
        body: {
          batch_id: batch.id,
          already_processed: false,
          proposed_count: proposals.length,
          skipped_count: skipReasons.length,
          resource_counts: resourceCounts,
          skip_reasons: skipReasons,
        },
      };
    },
  });
}
