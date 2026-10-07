import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { AliasManager } from "@/components/learning/alias-manager";
import { CreatorAdmin } from "@/components/learning/creator-admin";

export const metadata = { title: "Learning Centre governance" };

/**
 * The Chief Medical Officer's own path to the two Learning Centre decisions that need a clinician: marking an everyday search
 * term reviewed, and approving or suspending a creator. A real CMO account is `clinician`, never `admin`, so the admin pages
 * cannot be reached from it (same reason as the lifestyle content library). The database checks the CMO tier on both.
 */
export default async function ClinicianLearningGovernancePage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Learning Centre governance"
        description="Review the everyday words library search understands, and approve the verified clinicians who write for Members."
      />
      <AliasManager canReview />
      <CreatorAdmin />
    </div>
  );
}
