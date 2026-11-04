import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { LoadFailure } from "@/components/ui/load-failure";
import { isClinicalDocumentStatus } from "@/lib/clinical-documents/status";
import { LabReportUpload, type LabOption, type MyUpload } from "./lab-report-upload";

/**
 * Clinical document engine step 2 (CDE-03): the Care Coordinator's lab report desk. Labs that email results to Tarragon rather
 * than to the patient send them here: find the patient, confirm the identity printed on the report, upload. The result is held
 * for a clinician; the coordinator sees only whether each of their own uploads is waiting, being dealt with or done, never a
 * value (the intake record holds none).
 */
export default async function CareCoordinatorLabReportsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const supabase = await createClient();

  const [labs, assignments, uploads] = await Promise.all([
    supabase.from("lab_providers").select("id, name, is_active").order("name"),
    supabase.from("staff_lab_assignments").select("lab_provider_id").eq("staff_profile_id", user.id).is("active_to", null),
    supabase
      .from("clinical_documents")
      .select(
        "id, status, created_at, investigation_date, source_facility_id, source_facility_name, profiles!clinical_documents_patient_id_fkey(full_name)",
      )
      .eq("uploaded_by", user.id)
      .order("created_at", { ascending: false })
      .limit(25),
  ]);
  if (labs.error || uploads.error) {
    return <LoadFailure>The lab report desk could not be loaded. Reload the page; if it keeps failing, tell the operations team.</LoadFailure>;
  }

  const assigned = new Set((assignments.data ?? []).map((a) => a.lab_provider_id));
  const labOptions: LabOption[] = (labs.data ?? []).map((l) => ({ id: l.id, name: l.name, assigned: assigned.has(l.id) }));
  const labName = new Map(labOptions.map((l) => [l.id, l.name]));
  const myUploads: MyUpload[] = (uploads.data ?? [])
    .filter((u) => isClinicalDocumentStatus(u.status))
    .map((u) => ({
      id: u.id,
      status: u.status as MyUpload["status"],
      uploadedAt: u.created_at,
      investigationDate: u.investigation_date,
      lab: (u.source_facility_id ? labName.get(u.source_facility_id) : null) ?? u.source_facility_name ?? "Not recorded",
      patientName: u.profiles?.full_name ?? "Patient",
    }));

  return <LabReportUpload labs={labOptions} uploads={myUploads} />;
}
