import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { Worklist } from "./worklist";

export default async function ClinicianPage() {
  const profile = await getCurrentProfile();

  return (
    <DashboardPlaceholder
      greeting={`Welcome${profile?.full_name ? `, ${profile.full_name}` : ""}`}
      roleLabel="Care Team Doctor"
      comingUp={["Workload metrics (1:120 ratio target)"]}
    >
      <Worklist />
      <p className="text-sm">
        <Link href="/clinician/escalations" className="text-brand-green hover:underline">
          View all escalations →
        </Link>
      </p>
      <p className="text-sm">
        <Link href="/clinician/support-inbox" className="text-brand-green hover:underline">
          Support inbox →
        </Link>
      </p>
    </DashboardPlaceholder>
  );
}
