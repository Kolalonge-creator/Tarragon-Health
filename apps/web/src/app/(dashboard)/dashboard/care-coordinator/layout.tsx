import { getCurrentProfile, getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { ClinicalStaffSetupWarning } from "@/components/clinical/clinical-staff-setup-warning";
import { CareCoordinatorNav } from "./care-coordinator-nav";
import { CareCoordinatorPageHeader } from "./care-coordinator-page-header";

/** Same reasoning as dashboard/hmo/layout.tsx and dashboard/corporate/layout.tsx
 * — every degraded state renders exactly as the old single-page placeholder
 * did; only the fully-set-up state gets the real tabbed portal (Overview,
 * Outreach worklist, Follow-ups, Contact log). */
export default async function CareCoordinatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();
  const staff = await getCurrentClinicalStaff();
  const greeting = `Welcome${profile?.full_name ? `, ${profile.full_name}` : ""}`;

  if (!staff) {
    return (
      <DashboardPlaceholder greeting={greeting} roleLabel="Care Coordinator" comingUp={[]}>
        <ClinicalStaffSetupWarning roleLabel="Care Coordinator" />
      </DashboardPlaceholder>
    );
  }

  return (
    <div className="space-y-6">
      <CareCoordinatorPageHeader />
      <CareCoordinatorNav />
      {children}
    </div>
  );
}
