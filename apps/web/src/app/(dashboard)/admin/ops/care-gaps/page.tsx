import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { CareGapSection } from "@/components/clinical/care-gap-section";

export const metadata = { title: "Care gaps with no owner" };

/**
 * S90: care gaps that no coordinator or doctor holds. Reads follow the assignment, so a gap with no owner is invisible to every coordinator and clinician;
 * row level security opens exactly those gaps (and no owned gap) to an admin of the organisation so operations can assign someone or close the gap. The
 * engine also opens an immediate sev2 incident (care-gap-unowned) on the incident register when a live gap has no owner. The list is whatever the
 * database lets this admin read, no filter of ours widens it.
 */
export default async function UnownedCareGapsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  return (
    <div className="space-y-6">
      <PageHeader
        title="Care gaps with no owner"
        description="Gaps the care gap rules found where the organisation has no coordinator and no doctor available. Nobody else can see them until an owner exists."
      />
      <CareGapSection unowned />
    </div>
  );
}
