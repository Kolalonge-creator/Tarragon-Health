import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { BpBandReport } from "@/app/(dashboard)/clinician/bp-band-report/bp-band-report";

/** Read only for admin (OQ-67): where the app blood pressure bands and the live alert trigger disagree. */
export default async function AdminBpBandReportPage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") redirect("/");
  return (
    <div className="space-y-6">
      <PageHeader title="Blood pressure bands: app against alerts" description="Last 30 days. Read only. Nothing here changes a threshold." />
      <BpBandReport />
    </div>
  );
}
