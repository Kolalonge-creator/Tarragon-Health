import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { HealthReportConfigPanel } from "@/app/(dashboard)/clinician/_signoff-panels/health-report-config-panel";

/** Read only for admin: signing is the Chief Medical Officer's alone (see /clinician/health-report-config). */
export default async function AdminHealthReportConfigPage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") redirect("/");
  return (
    <div className="space-y-6">
      <PageHeader title="Yearly report settings" description="Read only. The Chief Medical Officer signs these." />
      <HealthReportConfigPanel canSign={false} />
    </div>
  );
}
