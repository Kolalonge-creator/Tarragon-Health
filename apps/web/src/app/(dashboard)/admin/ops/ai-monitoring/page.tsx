import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { MonitoringView } from "@/components/ai/monitoring-view";

export const metadata = { title: "AI monitoring" };
export const dynamic = "force-dynamic";

/** S80d (25.10): AI monitoring for admins. The Chief Medical Officer reaches the same view at /clinician/ai-monitoring. */
export default async function AiMonitoringPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/admin");
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">AI monitoring</h1>
      <MonitoringView links={{ cost: "/admin/ops/ai-cost", review: "/clinician/ai-review", signoff: "/clinician/clinical-signoff" }} />
    </div>
  );
}
