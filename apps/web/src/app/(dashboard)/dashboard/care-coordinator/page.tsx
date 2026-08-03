import { getCurrentProfile, getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { OutreachWorklist } from "@/components/clinical/outreach-worklist";
import { ClinicalStaffSetupWarning } from "@/components/clinical/clinical-staff-setup-warning";

export default async function CareCoordinatorPage() {
  const profile = await getCurrentProfile();
  const staff = await getCurrentClinicalStaff();
  const greeting = `Welcome${profile?.full_name ? `, ${profile.full_name}` : ""}`;

  return (
    <DashboardPlaceholder
      greeting={greeting}
      roleLabel="Care Coordinator"
      comingUp={[
        "Lab and pharmacy refill booking",
        "Patient check-in call/WhatsApp threads",
      ]}
    >
      {!staff && <ClinicalStaffSetupWarning roleLabel="Care Coordinator" />}
      <OutreachWorklist />
    </DashboardPlaceholder>
  );
}
