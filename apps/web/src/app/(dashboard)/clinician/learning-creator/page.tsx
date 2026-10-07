import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { CreatorWorkspace } from "@/components/learning/creator-workspace";

export const metadata = { title: "Write for the Learning Centre" };

/**
 * Any verified clinician's own creator area (S55, 9.7). Care coordinators are not clinicians and have no creator path. The
 * database is the real gate: apply_as_creator refuses a clinician whose credential is not verified.
 */
export default async function ClinicianLearningCreatorPage() {
  const staff = await getCurrentClinicalStaff();
  if (!staff || staff.doctor_tier === "care_coordinator") redirect("/clinician");
  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Write for the Learning Centre"
        description="Apply to write Members-only learning series, then send each piece into clinical review."
      />
      <CreatorWorkspace staffId={staff.id} />
    </div>
  );
}
