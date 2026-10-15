import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { isClinicalTier } from "@/lib/clinical/doctor-tier";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { loadCurrentAllergies } from "./chart-allergies";
import { RecordChangesQueue, type RecordChangeRequest } from "./record-changes-queue";

/**
 * S05b-e: the review screen for a patient's own request to void or correct an allergy she
 * entered herself (S05b-d). The original stays active until a tied doctor confirms here.
 *
 * Reads run as the signed-in clinician under row level security: the request table admits only
 * the patient and a tied, active, non-coordinator clinician (private.is_correcting_clinician),
 * so this page never needs, and never uses, a service role. The allergy as currently recorded
 * is NOT readable by staff directly (S05c closed that), so it comes from the audited chart
 * reader, which also writes the access to the audit trail. A Care Coordinator can never see a
 * row (and the proxy does not let one reach this path); the tier check below is the app-layer
 * belt over that.
 */
export default async function RecordChangesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const staff = await getCurrentClinicalStaff();
  if (!isClinicalTier(staff)) {
    return (
      <div className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Record changes</h1>
        <p className="text-sm text-charcoal-ink/70">Only a doctor can look at and decide these requests.</p>
      </div>
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("patient_allergy_correction_requests")
    .select(
      "id, patient_id, allergy_id, requested_status, reason, replacement, created_at," +
        "patient:profiles!patient_allergy_correction_requests_patient_id_fkey(full_name, patient_number)",
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  type RequestRow = Omit<RecordChangeRequest, "allergy" | "allergyUnavailable"> & {
    patient_id: string;
    allergy_id: string;
  };
  const rows = (data ?? []) as unknown as RequestRow[];
  const { byPatient, failed } = error
    ? { byPatient: new Map(), failed: [] as string[] }
    : await loadCurrentAllergies(supabase, rows.map((row) => row.patient_id));

  const requests: RecordChangeRequest[] = rows.map((row) => {
    const allergies = byPatient.get(row.patient_id);
    return {
      id: row.id,
      requested_status: row.requested_status,
      reason: row.reason,
      replacement: row.replacement,
      created_at: row.created_at,
      patient: row.patient,
      allergy: allergies?.get(row.allergy_id) ?? null,
      allergyUnavailable: !allergies,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Record changes</h1>
        <p className="text-sm text-charcoal-ink/60">
          Changes your patients have asked for in their own record. Nothing is changed until you confirm it.
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          The queue could not be loaded: {error.message}
        </p>
      ) : (
        <>
          {failed.length > 0 && (
            <p role="alert" className="text-sm text-destructive">
              The current record could not be loaded for {failed.length === 1 ? "one patient" : `${failed.length} patients`}.
              You can still read what they asked for, but check their record before you decide.
            </p>
          )}
          <RecordChangesQueue requests={requests} />
        </>
      )}
    </div>
  );
}
