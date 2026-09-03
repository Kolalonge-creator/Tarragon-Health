import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { FindASpecialist } from "./find-a-specialist";

export default async function FindASpecialistPage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }
  if (!profile.onboarding_completed_at) {
    redirect("/onboarding");
  }

  return (
    <DashboardPlaceholder greeting="Find a specialist" roleLabel="Patient" comingUp={[]}>
      <div className="flex justify-end">
        <Link href="/patient" className="text-sm font-medium text-brand-green dark:text-brand-green-bright hover:underline">
          ← Back to dashboard
        </Link>
      </div>
      <p className="max-w-2xl text-sm text-charcoal-ink/70 dark:text-night-ink/70">
        Browse Tarragon&apos;s specialist network by specialty, location, and language. Your care team still
        arranges the actual referral and booking.
      </p>
      <FindASpecialist patientLocation={{ state: profile.state, city: profile.city, area: profile.area }} />
    </DashboardPlaceholder>
  );
}
