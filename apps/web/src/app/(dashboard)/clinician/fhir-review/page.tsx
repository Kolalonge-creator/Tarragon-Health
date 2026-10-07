import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { FhirReviewQueue, type ProposedFhirResource } from "./fhir-review-queue";

/**
 * Data Architecture Gaps Build Plan §1 Phase 1 (docs/DATA_ARCHITECTURE_GAPS_BUILD_PLAN.md).
 * The review worklist for fhir_import_proposed_resources (schema + trigger-
 * enforced attribution already built by migrations 20260807020405/
 * 20260807084925 — this was the missing UI, not new schema). RLS
 * (private.is_org_staff) already scopes the read to this org; every action
 * runs the caller's own session through the same "RLS admits, trigger
 * narrows" attribution trigger as everywhere else in this codebase (a Care
 * Coordinator or wrong-org caller gets that trigger's own error message,
 * not a duplicated client-side check).
 */
export default async function FhirReviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id, role")
    .eq("id", user.id)
    .single();

  if (!profile?.organisation_id || profile.role === "patient") {
    redirect("/clinician");
  }

  const { data: proposed } = await supabase
    .from("fhir_import_proposed_resources")
    .select(
      "id, resource_type, status, fhir_resource_id, normalized_payload, parse_warnings, proposed_at, dismissal_reason," +
        "patient:profiles!fhir_import_proposed_resources_patient_id_fkey(full_name, patient_number)," +
        "batch:fhir_import_batches!fhir_import_proposed_resources_batch_id_fkey(source_system, received_at)"
    )
    .eq("status", "proposed")
    .order("proposed_at", { ascending: true });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          FHIR partner review
        </h1>
        <p className="text-sm text-charcoal-ink/60">
          Data an HMO, hospital, or lab partner sent in via FHIR import — nothing here is in the
          record yet. Confirm to add it, or dismiss with a reason.
        </p>
      </div>
      <FhirReviewQueue proposed={(proposed ?? []) as unknown as ProposedFhirResource[]} />
    </div>
  );
}
