import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { CaregiverRequestFlow } from "./caregiver-request-flow";

/**
 * The eldercare "manage" request wizard — a dedicated step-by-step page
 * rather than another field on /patient/family, because unlike naming a
 * next of kin this hands out write access and deserves the room to explain
 * that plainly before asking anyone to click through it.
 */
export default async function CaregiverRequestPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "patient") redirect("/");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Manage care together"
        icon={SEMANTIC_ICON.family}
        description="Set up someone to manage bookings and records on your behalf, or offer to do the same for someone else."
      />
      <CaregiverRequestFlow />
    </div>
  );
}
