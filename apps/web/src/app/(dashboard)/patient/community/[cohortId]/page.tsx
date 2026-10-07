import { redirect } from "next/navigation";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { t } from "@tarragon/i18n";
import { CohortView } from "./cohort-view";

export const metadata = { title: "Community group", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CohortPage({ params }: { params: Promise<{ cohortId: string }> }) {
  const { cohortId } = await params;
  const { profile, uiLanguage, acting } = await getPatientDashboardContext();
  if (acting || profile.receives_care === false || !UUID.test(cohortId)) redirect("/patient/community");
  return (
    <div className="space-y-6">
      <PageHeader title={t("community.title", uiLanguage)} icon={SEMANTIC_ICON.family} backTo={{ href: "/patient/community", label: t("community.group.back", uiLanguage) }} />
      <CohortView cohortId={cohortId} locale={uiLanguage} />
    </div>
  );
}
