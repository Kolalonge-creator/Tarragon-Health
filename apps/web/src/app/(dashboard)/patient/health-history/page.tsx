import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
import { createClient } from "@/lib/supabase/server";
import { t } from "@tarragon/i18n";
import { HistoryManager, type FamilyItem, type ProcedureItem } from "./history-manager";

/**
 * Procedures and family history a person tells us about (S43, spec 2.2). Entered by
 * the person, so every row says so until a clinician confirms it. The person's own
 * live rows only: a removed row is hidden here and kept for the audit trail.
 */
export default async function HealthHistoryPage() {
  const { subjectId, profile, uiLanguage } = await getPatientDashboardContext();
  const supabase = await createClient();
  const isOwn = subjectId === profile.id;

  const [{ data: procedures }, { data: family }] = await Promise.all([
    supabase
      .from("procedures")
      .select("id, name, approximate_year, performed_on, facility, verified_by_clinician")
      .eq("patient_id", subjectId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("family_history")
      .select("id, condition_name, relationship, age_of_onset_years, verified_by_clinician")
      .eq("patient_id", subjectId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={{ href: "/patient", label: t("passport.back", uiLanguage) }}
        title={t("healthhistory.title", uiLanguage)}
        icon={NAV_ICON.review}
        description={t("healthhistory.description", uiLanguage)}
      />
      <HistoryManager procedures={(procedures ?? []) as ProcedureItem[]} family={(family ?? []) as FamilyItem[]} canEdit={isOwn} locale={uiLanguage} />
    </div>
  );
}
