import { notFound } from "next/navigation";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { SupporterView } from "./supporter-view";
import { HelpAlertView } from "./help-alert-view";

export const metadata = { title: "Shared with you", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One person's page for a supporter. The header ("{name}'s care") comes from the same single read as the blocks, inside SupporterView. */
export default async function SupporterViewPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  if (!UUID.test(patientId)) notFound();
  const { uiLanguage } = await getPatientDashboardContext({ area: "supporter" });
  return <SupporterView patientId={patientId} locale={uiLanguage} alertSlot={<HelpAlertView patientId={patientId} locale={uiLanguage} />} />;
}
