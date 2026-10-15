import { notFound } from "next/navigation";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { SupporterView } from "./supporter-view";
import { HelpAlertView } from "./help-alert-view";

export const metadata = { title: "Shared with you", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SupporterViewPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  if (!UUID.test(patientId)) notFound();
  const { uiLanguage } = await getPatientDashboardContext();
  return (
    <div className="space-y-6">
      <PageHeader title="Shared with you" icon={SEMANTIC_ICON.family} backTo={{ href: "/patient/supporting", label: "People you support" }} />
      <HelpAlertView patientId={patientId} locale={uiLanguage} />
      <SupporterView patientId={patientId} locale={uiLanguage} />
    </div>
  );
}
