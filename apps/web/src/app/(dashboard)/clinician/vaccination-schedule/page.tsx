import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { VaccinationSchedulePanel } from "../_signoff-panels/vaccination-schedule-panel";

/**
 * The Chief Medical Officer / Clinical Director's own reachable path to
 * sign-off on the vaccination reference schedule. Mirrors
 * /clinician/protocols' pattern exactly: admin/settings/vaccination-
 * schedule/page.tsx hard-redirects anyone whose `profiles.role !==
 * "admin"`, and proxy.ts's /admin/* gate refuses a plain `clinician` login
 * before that page would even load — so a real CMO (account role always
 * `clinician`) could not reach this at all, even though
 * sign_vaccination_schedule has always been Clinical-Director-only, never
 * admin. Found 2026-09-22, same audit that found
 * vaccination_schedule_signoffs_insert was admin-only RLS with no CMO
 * fallback — fixed in
 * 20260922193027_cmo_governed_config_insert_dual_gate.sql, which this page
 * depends on for the "draft a new sign-off" form to work.
 */
export default async function ClinicianVaccinationSchedulePage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) {
    redirect("/clinician");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vaccination schedule"
        description={`This is the reference immunisation schedule that drives every parent's due/overdue calendar and the vaccination reminder notifications. The schedule itself changes only through reviewed, tested code changes; this page is where a Clinical Director puts a signed record on file confirming the current schedule has been reviewed and approved.`}
      />
      <VaccinationSchedulePanel />
    </div>
  );
}
