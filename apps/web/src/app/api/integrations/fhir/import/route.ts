import { NextResponse } from "next/server";
import { hasScope, verifyApiKey } from "@/lib/integrations/api-key";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { fhirImportRequestSchema } from "@/lib/fhir/import/bundle-schema";
import { parseFhirImportBundle, PARSER_VERSION } from "@/lib/fhir/import/parse-bundle";
import type { Json, TablesInsert } from "@tarragon/shared";

/**
 * Partner FHIR Bundle ingestion -- "ingest from an HMO or hospital that can
 * emit it." Mirrors api/integrations/device-readings/route.ts step for
 * step: org API-key auth, Zod-validated body, service-role client scoped
 * explicitly by the key's own organisation_id.
 *
 * Nothing here writes to a patient's actual clinical record. Every
 * recognised Bundle entry lands as a `proposed` row in
 * fhir_import_proposed_resources and stays clinically inert until a named,
 * tier-eligible clinician confirms it from /clinician/fhir-imports -- see
 * that migration's header for the full safety line. This route's only job
 * is: authenticate the partner, validate the shape, resolve the target
 * patient, parse what we recognise, and record what we don't (never
 * silently drop it).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const verified = await verifyApiKey(request);
  if (!verified) {
    return NextResponse.json({ error: "Invalid or revoked API key" }, { status: 401 });
  }
  if (!hasScope(verified, "fhir:import")) {
    return NextResponse.json({ error: "API key lacks the fhir:import scope" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = fhirImportRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { patient_number, source_system, bundle } = parsed.data;

  const supabase = createServiceRoleClient();

  // Org-scoped: a patient_number outside the key's organisation resolves to
  // a clean 404, never a cross-tenant read -- same as device-readings.
  const { data: patient } = await supabase
    .from("profiles")
    .select("id, organisation_id")
    .eq("patient_number", patient_number)
    .eq("organisation_id", verified.organisationId)
    .eq("role", "patient")
    .maybeSingle();
  if (!patient) {
    return NextResponse.json({ error: "Patient not found in this organisation" }, { status: 404 });
  }

  const bundleIdentifier = bundle.identifier?.value ?? bundle.id ?? null;

  const batchInsert: TablesInsert<"fhir_import_batches"> = {
    organisation_id: verified.organisationId,
    api_key_id: verified.keyId,
    patient_id: patient.id,
    source_system: source_system ?? null,
    fhir_bundle_identifier: bundleIdentifier,
    raw_bundle: bundle as unknown as Json,
  };

  const { data: batch, error: batchError } = await supabase
    .from("fhir_import_batches")
    .insert(batchInsert)
    .select("id")
    .single();

  if (batchError) {
    // 23505 = the (organisation_id, fhir_bundle_identifier) dedupe index --
    // this exact Bundle was already ingested (partner retry). Return the
    // existing batch rather than re-parsing and duplicating proposals.
    if (batchError.code === "23505" && bundleIdentifier) {
      const { data: existing } = await supabase
        .from("fhir_import_batches")
        .select("id")
        .eq("organisation_id", verified.organisationId)
        .eq("fhir_bundle_identifier", bundleIdentifier)
        .maybeSingle();
      return NextResponse.json({ success: true, deduped: true, batch_id: existing?.id ?? null });
    }
    return NextResponse.json({ error: "Could not record this Bundle" }, { status: 500 });
  }

  const { data: catalog } = await supabase
    .from("vaccination_catalog")
    .select("id, name")
    .eq("is_active", true);

  const { proposals, skipped } = parseFhirImportBundle(bundle, catalog ?? []);

  if (proposals.length > 0) {
    const rows: TablesInsert<"fhir_import_proposed_resources">[] = proposals.map((p) => ({
      batch_id: batch.id,
      organisation_id: verified.organisationId,
      patient_id: patient.id,
      resource_type: p.resource_type,
      fhir_resource_id: p.fhir_resource_id,
      raw_resource: p.raw_resource as unknown as Json,
      normalized_payload: p.normalized_payload as unknown as Json,
      parse_warnings: p.parse_warnings as unknown as Json,
      parser_version: PARSER_VERSION,
    }));
    const { error: proposalsError } = await supabase.from("fhir_import_proposed_resources").insert(rows);
    if (proposalsError) {
      return NextResponse.json({ error: "Recorded the Bundle but could not stage its resources for review" }, { status: 500 });
    }
  }

  const resourceCounts = proposals.reduce<Record<string, number>>((acc, p) => {
    acc[p.resource_type] = (acc[p.resource_type] ?? 0) + 1;
    return acc;
  }, {});

  await supabase
    .from("fhir_import_batches")
    .update({ resource_counts: resourceCounts as unknown as Json, skip_reasons: skipped as unknown as Json })
    .eq("id", batch.id);

  return NextResponse.json({
    success: true,
    batch_id: batch.id,
    proposed: resourceCounts,
    skipped,
  });
}
