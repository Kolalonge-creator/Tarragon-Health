import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
import { ShareControls } from "./share-controls";
import { createClient } from "@/lib/supabase/server";

export default async function ShareRecordsPage() {
  const { subjectId, uiLanguage } = await getPatientDashboardContext();
  // RLS returns only the signed-in person's own SIGNED reports, so an unsigned draft can never switch the option on. A failed read does NOT hide the option
  // (that would look like "no signed report"); the database refuses the share if there really is none.
  const { data: signed, error: signedError } = await (await createClient()).from("health_reports").select("id").limit(1);
  const hasSignedReport = signedError ? true : (signed ?? []).length > 0;

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
