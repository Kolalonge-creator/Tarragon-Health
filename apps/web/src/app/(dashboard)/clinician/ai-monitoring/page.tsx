import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { MonitoringView } from "@/components/ai/monitoring-view";

export const metadata = { title: "AI monitoring" };
export const dynamic = "force-dynamic";

/** S80d (25.10): AI monitoring for the Chief Medical Officer, who cannot open /admin. */
export default async function ClinicianAiMonitoringPage() {
  if (!canAssignCases(await getCurrentClinicalStaff())) redirect("/clinician");
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">AI monitoring</h1>
      <MonitoringView links={{ cost: "/admin/ops/ai-cost", review: "/clinician/ai-review", signoff: "/clinician/clinical-signoff" }} />
    </div>
  );
}
