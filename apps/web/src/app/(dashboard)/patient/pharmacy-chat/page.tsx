import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
import { t } from "@tarragon/i18n";
import { PharmacyChat } from "./pharmacy-chat";

export const metadata = { title: "Ask a pharmacist" };

/** S54 8.12: medicine questions to a partner pharmacy. In the app only; for anything urgent the emergency steps, not a message. */
export default async function PharmacyChatPage() {
  const { subjectId } = await getPatientDashboardContext();
  return (
    <div className="space-y-6">
      <PageHeader title={t("pharmchat.title")} icon={NAV_ICON.messages} backTo={{ href: "/patient", label: "Dashboard" }} description={t("pharmchat.intro")} />
      <PharmacyChat patientId={subjectId} />
    </div>
  );
}
