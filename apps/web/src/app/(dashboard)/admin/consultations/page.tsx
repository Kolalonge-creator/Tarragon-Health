import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { ConsultationsLogView } from "@/components/consultations-log/consultations-log-view";
import { parseConsultationsLogFilters } from "@/lib/consultations/consultations-log";
import { loadConsultationsLog, loadDoctorOptions } from "@/lib/consultations/load-consultations-log";

export const metadata = { title: "Consultations log" };
export const dynamic = "force-dynamic";

/**
 * Every consultation in the organisation, for an admin (founder/CMO ask, 2026-11-03). The CMO reads the same log at
 * /clinician/consultations-log, since a CMO login cannot open /admin/*. public.consultations_log returns rows to an admin or
 * the CMO only; this page's own check is the admin role.
 */
export default async function AdminConsultationsLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin" || !profile.organisation_id) redirect("/admin");
  const filters = parseConsultationsLogFilters(await searchParams);
  const supabase = await createClient();
  const [rows, doctors] = await Promise.all([
    loadConsultationsLog(supabase, filters),
    loadDoctorOptions(supabase, profile.organisation_id),
  ]);
  return (
    <ConsultationsLogView
      basePath="/admin/consultations"
      backTo={{ href: "/admin", label: "Admin" }}
      patientHref={(id) => `/admin/members/${id}`}
      filters={filters}
      doctors={doctors}
      rows={rows}
    />
  );
}
