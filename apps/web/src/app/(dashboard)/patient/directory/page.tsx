import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { t } from "@tarragon/i18n";
import { DirectorySearch } from "./directory-search";

export const metadata = { title: "Find care near you" };

export default async function DirectoryPage() {
  const { uiLanguage } = await getPatientDashboardContext();
  return (
    <div className="space-y-6">
      <PageHeader title={t("directory.title", uiLanguage)} icon={SEMANTIC_ICON.family} backTo={{ href: "/patient", label: "Home" }} />
      <p>{t("directory.intro", uiLanguage)}</p>
      <DirectorySearch locale={uiLanguage} />
    </div>
  );
}
