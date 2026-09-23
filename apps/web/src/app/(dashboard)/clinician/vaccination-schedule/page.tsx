import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  VaccinationScheduleManager,
  type VaccinationScheduleSignoffRow,
  type VaccinationCatalogRow,
} from "@/app/(dashboard)/admin/settings/vaccination-schedule/vaccination-schedule-manager";

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

  const supabase = await createClient();
  const [{ data: catalog }, { data: signoffs }] = await Promise.all([
    supabase
      .from("vaccination_catalog")
      .select("id, code, name, description, recommended_age, is_active")
      .eq("is_active", true)
      .order("code", { ascending: true }),
    supabase
      .from("vaccination_schedule_signoffs")
      .select("id, version, notes, source_url, is_active, approved_at, created_at, catalog_snapshot")
      .order("version", { ascending: false }),
  ]);

  const catalogRows = (catalog as VaccinationCatalogRow[] | null) ?? [];
  const signoffRows = (signoffs as VaccinationScheduleSignoffRow[] | null) ?? [];
  const activeSignoff = signoffRows.find((s) => s.is_active);
  const nextVersion = (signoffRows[0]?.version ?? 0) + 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vaccination schedule"
        description={`This is the reference immunisation schedule that drives every parent's due/overdue calendar and the vaccination reminder notifications, ${catalogRows.length} active entries. The schedule itself changes only through reviewed, tested code changes; this page is where a Clinical Director puts a signed record on file confirming the current schedule has been reviewed and approved.`}
      />
      <VaccinationScheduleManager
        catalog={catalogRows}
        signoffs={signoffRows}
        activeSignoff={activeSignoff ?? null}
        nextVersion={nextVersion}
      />
    </div>
  );
}
