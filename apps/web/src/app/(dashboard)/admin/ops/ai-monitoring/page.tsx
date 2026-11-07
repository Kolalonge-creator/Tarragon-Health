import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { MonitoringView } from "@/components/ai/monitoring-view";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "AI monitoring" };
export const dynamic = "force-dynamic";

/** S80d (25.10): AI monitoring for admins. The Chief Medical Officer reaches the same view at /clinician/ai-monitoring. */
export default async function AiMonitoringPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/admin");
  return (
    <div className="space-y-6">
      <PageHeader title="AI monitoring" />
      <MonitoringView links={{ cost: "/admin/ops/ai-cost", review: "/clinician/ai-review", signoff: "/clinician/clinical-signoff" }} />
    </div>
  );
}
