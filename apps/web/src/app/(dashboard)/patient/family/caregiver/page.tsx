import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
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
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Manage care together
        </h1>
        <p className="text-charcoal-ink/60">
          Set up someone to manage bookings and records on your behalf, or offer to do the same for
          someone else.
        </p>
      </div>
      <CaregiverRequestFlow />
    </div>
  );
}
