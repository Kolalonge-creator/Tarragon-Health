import { redirect } from "next/navigation";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { CareCircleManager } from "./care-circle-manager";

export const metadata = { title: "Your Care Circle" };

export default async function CareCirclePage() {
  const { profile, uiLanguage, acting } = await getPatientDashboardContext();
  // The circle belongs to the patient's own account; a supporter acting for someone, or a supporter-only account, never edits it.
  if (acting || profile.receives_care === false) redirect("/patient");
  return (
    <div className="space-y-6">
      <PageHeader title="Your Care Circle" icon={SEMANTIC_ICON.family} backTo={{ href: "/patient/family", label: "Your people" }} />
      <CareCircleManager locale={uiLanguage} />
    </div>
  );
}
