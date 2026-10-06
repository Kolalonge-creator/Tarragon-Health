import { createClient } from "@/lib/supabase/server";
import {
  VaccinationScheduleManager,
  type VaccinationScheduleSignoffRow,
  type VaccinationCatalogRow,
} from "@/app/(dashboard)/admin/settings/vaccination-schedule/vaccination-schedule-manager";

/**
 * The vaccination-schedule sign-off panel: loads its own data and renders the real manager,
 * values and Sign control together. Shared by the CMO's own page for this
 * config and by the sign-off hub (/clinician/clinical-signoff), which opens it
 * inline so a signature is always given while looking at the actual values.
 * Access is gated by the page that renders it (both require canAssignCases).
 */
export async function VaccinationSchedulePanel() {
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
      <VaccinationScheduleManager
        catalog={catalogRows}
        signoffs={signoffRows}
        activeSignoff={activeSignoff ?? null}
        nextVersion={nextVersion}
      />
    </div>
  );
}
