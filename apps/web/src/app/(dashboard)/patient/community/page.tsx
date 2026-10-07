import { redirect } from "next/navigation";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { t } from "@tarragon/i18n";
import { CommunityHome } from "./community-home";

export const metadata = { title: "Community groups" };

export default async function CommunityPage() {
  const { profile, uiLanguage, acting } = await getPatientDashboardContext();
  // Groups belong to the person's own account; someone acting for another person, or a supporter-only account, never joins on their behalf.
  if (acting || profile.receives_care === false) redirect("/patient");
  return (
    <div className="space-y-6">
      <PageHeader title={t("community.title", uiLanguage)} icon={SEMANTIC_ICON.family} backTo={{ href: "/patient/family", label: "Your people" }} />
      <CommunityHome locale={uiLanguage} />
    </div>
  );
}
