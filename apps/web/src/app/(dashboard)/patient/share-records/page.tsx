import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
import { ShareControls } from "./share-controls";

export default async function ShareRecordsPage() {
  const { subjectId, uiLanguage } = await getPatientDashboardContext();

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={{ href: "/patient", label: "Dashboard" }}
        title="Share records"
        icon={NAV_ICON.share}
        description="Create a time-limited link to share selected sections of your health record."
      />
      <ShareControls patientId={subjectId} locale={uiLanguage} />
    </div>
  );
}
