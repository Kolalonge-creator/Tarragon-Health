import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  VaccinationScheduleManager,
  type VaccinationScheduleSignoffRow,
  type VaccinationCatalogRow,
} from "./vaccination-schedule-manager";

/**
 * Clinical Director sign-off for the vaccination reference schedule that
 * drives vaccination_catalog's due/overdue computation and the vaccination_due
 * reminder cron. The catalog itself is edited via migrations (each dosing
 * change is its own reviewed, tested change — see supabase/migrations for the
 * 2026-07-24 tetanus/shingles accuracy work); this page is where a Clinical
 * Director reviews the CURRENT catalog and puts a signed record of that
 * review on file, the same signing discipline as /admin/settings/cv-risk-config.
 */
export default async function VaccinationScheduleSettingsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    redirect("/admin");
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
