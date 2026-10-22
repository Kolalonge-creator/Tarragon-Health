import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
import { unavailableWearableProviders } from "@/lib/wearables/oauth-providers";
import { t } from "@tarragon/i18n";
import { DataConnectionsHub } from "./data-connections-hub";

/**
 * Data connections (S70b item 9): every way a reading can reach the record, with plain status and the existing controls. Only the person themselves
 * sees it; it is not shown while acting for someone else (their phone and devices are theirs to manage).
 */
export default async function DataConnectionsPage() {
  const { subjectId, profile, uiLanguage } = await getPatientDashboardContext();
  const isOwn = subjectId === profile.id;
  return (
    <div className="space-y-6">
      <PageHeader title={t("hub.title", uiLanguage)} icon={NAV_ICON.upload} description={t("hub.intro", uiLanguage)} />
      {isOwn ? (
        <DataConnectionsHub patientId={subjectId} unavailableProviders={unavailableWearableProviders()} />
      ) : (
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("exchange.own_only", uiLanguage)}</p>
      )}
    </div>
  );
}
