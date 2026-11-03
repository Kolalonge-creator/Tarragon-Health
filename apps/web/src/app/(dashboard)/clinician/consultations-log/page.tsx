import { redirect } from "next/navigation";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";
import { ConsultationsLogView } from "@/components/consultations-log/consultations-log-view";
import { parseConsultationsLogFilters } from "@/lib/consultations/consultations-log";
import { loadConsultationsLog, loadDoctorOptions } from "@/lib/consultations/load-consultations-log";

export const metadata = { title: "Consultations log" };
export const dynamic = "force-dynamic";

/**
 * The Chief Medical Officer's door to the same consultations log admins see at /admin/consultations. A CMO logs in as
 * `clinician` and can never open /admin/*, so this is a separate access path, not a separate report (the team-caseload
 * pattern). canAssignCases is the page's gate; public.consultations_log itself admits only an admin or the active CMO.
 */
export default async function ClinicianConsultationsLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  const profile = await getCurrentProfile();
  if (!profile?.organisation_id) redirect("/clinician");
  const filters = parseConsultationsLogFilters(await searchParams);
  const supabase = await createClient();
  const [rows, doctors] = await Promise.all([
    loadConsultationsLog(supabase, filters),
    loadDoctorOptions(supabase, profile.organisation_id),
  ]);
  return (
    <ConsultationsLogView
      basePath="/clinician/consultations-log"
      backTo={{ href: "/clinician", label: "Clinician home" }}
      patientHref={(id) => `/clinician/patients/${id}`}
      filters={filters}
      doctors={doctors}
      rows={rows}
    />
  );
}
