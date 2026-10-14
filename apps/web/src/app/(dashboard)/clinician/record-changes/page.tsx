import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { isClinicalTier } from "@/lib/clinical/doctor-tier";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  RecordChangesQueue,
  type RecordChangeRequest,
} from "./record-changes-queue";

/**
 * S05b-e: the review screen for a patient's own request to void or correct an allergy she
 * entered herself (S05b-d). The original stays active until a tied doctor confirms here.
 *
 * Reads run as the signed-in clinician under row level security: the request table admits only
 * the patient and a tied, active, non-coordinator clinician (private.is_correcting_clinician),
 * so this page never needs, and never uses, a service role. A Care Coordinator can never see a
 * row (and the proxy does not let one reach this path); the tier check below is the app-layer
 * belt over that.
 */
export default async function RecordChangesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const staff = await getCurrentClinicalStaff();
  const canDecide = isClinicalTier(staff);

  const supabase = await createClient();
  const { data, error } = canDecide
    ? await supabase
        .from("patient_allergy_correction_requests")
        .select(
          "id, requested_status, reason, replacement, created_at," +
            "patient:profiles!patient_allergy_correction_requests_patient_id_fkey(full_name, patient_number)," +
            "allergy:patient_allergies!patient_allergy_correction_requests_allergy_id_fkey(allergen, reaction, severity, source, noted_at)",
        )
        .eq("status", "pending")
        .order("created_at", { ascending: true })
    : { data: [], error: null };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Record changes
        </h1>
        <p className="text-sm text-charcoal-ink/60">
          Changes your patients have asked for in their own record. Nothing is
          changed until you confirm it.
        </p>
      </div>
      {!canDecide && (
        <p className="text-sm text-charcoal-ink/70">
          Only a doctor can look at and decide these requests.
        </p>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          The queue could not be loaded: {error.message}
        </p>
      ) : (
        canDecide && (
          <RecordChangesQueue
            requests={(data ?? []) as unknown as RecordChangeRequest[]}
            canDecide={canDecide}
          />
        )
      )}
    </div>
  );
}
