import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FhirImportsClient, type PendingFhirImport } from "./fhir-imports-client";

/**
 * Clinician worklist for partner FHIR Bundle imports -- every row here is
 * clinically inert until confirmed or dismissed (see the migration
 * `..._fhir_interop_import_review.sql`'s header for the full safety line).
 * Org-staff gated (defense in depth on RLS); confirming/dismissing is
 * further gated by the DB trigger, which excludes Care Coordinator and
 * requires an assigned clinical tier.
 */
export default async function FhirImportsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) redirect("/");

  const { data: rows } = await supabase
    .from("fhir_import_proposed_resources")
    .select(
      "id, resource_type, normalized_payload, parse_warnings, proposed_at, patient_id, fhir_import_batches(source_system, received_at)"
    )
    .eq("status", "proposed")
    .order("proposed_at", { ascending: true });

  const patientIds = [...new Set((rows ?? []).map((r) => r.patient_id))];
  const nameById = new Map<string, string>();
  if (patientIds.length) {
    const { data: people } = await supabase.from("profiles").select("id, full_name").in("id", patientIds);
    for (const p of people ?? []) nameById.set(p.id, p.full_name ?? "Patient");
  }

  const pending: PendingFhirImport[] = (rows ?? []).map((r) => {
    const batch = r.fhir_import_batches as { source_system: string | null; received_at: string } | null;
    return {
      id: r.id,
      patientName: nameById.get(r.patient_id) ?? "Patient",
      resourceType: r.resource_type,
      normalizedPayload: (r.normalized_payload ?? {}) as Record<string, unknown>,
      parseWarnings: (r.parse_warnings ?? []) as string[],
      sourceSystem: batch?.source_system ?? null,
      receivedAt: batch?.received_at ?? r.proposed_at,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">FHIR imports</h1>
        <p className="text-muted-foreground text-sm">
          Data an HMO or hospital partner sent for a patient. Nothing here is part of the
          clinical record until you confirm it.
        </p>
      </div>
      <FhirImportsClient items={pending} />
    </div>
  );
}
