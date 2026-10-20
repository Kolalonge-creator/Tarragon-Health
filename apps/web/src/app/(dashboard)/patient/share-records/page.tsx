import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
import { ShareControls } from "./share-controls";
import { createClient } from "@/lib/supabase/server";
import { listSignedReports } from "@/lib/health-report/queries";

export default async function ShareRecordsPage() {
  const { subjectId, uiLanguage } = await getPatientDashboardContext();
  // RLS returns only the signed-in person's own SIGNED reports, so an unsigned draft can never switch the option on
  const hasSignedReport = (await listSignedReports(await createClient())).length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={{ href: "/patient", label: "Dashboard" }}
        title="Share records"
        icon={NAV_ICON.share}
        description="Create a time-limited link to share selected sections of your health record."
      />
      <ShareControls patientId={subjectId} locale={uiLanguage} hasSignedReport={hasSignedReport} />
    </div>
  );
}
