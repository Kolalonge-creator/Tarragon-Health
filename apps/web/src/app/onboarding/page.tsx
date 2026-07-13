import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { YourCareTeam } from "@/components/your-care-team";
import { PlanSelector } from "./plan-selector";

export default async function OnboardingPage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }
  if (profile.role !== "patient") {
    redirect("/");
  }
  if (profile.onboarding_completed_at) {
    redirect("/patient");
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-charcoal-ink/[0.02] px-4 py-16">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center">
          <h1 className="font-heading text-2xl font-semibold text-brand-green">
            Welcome{profile.full_name ? `, ${profile.full_name}` : ""}
          </h1>
          <p className="mt-1 text-sm text-charcoal-ink/60">Care that stays with you.</p>
        </div>

        <div className="space-y-4 rounded-xl border border-charcoal-ink/10 bg-white p-6 shadow-sm">
          <h2 className="font-heading text-lg font-semibold text-charcoal-ink">
            How your care works here
          </h2>
          <p className="text-sm text-charcoal-ink">
            A named clinician on our care team follows your readings, checks in with you, and
            documents your care as it happens — they&apos;re the person you&apos;ll actually hear
            from.
          </p>
          <p className="text-sm text-charcoal-ink">
            Your care protocols — the thresholds and rules your clinician follows — are designed
            and supervised by our Clinical Director.
          </p>
          <p className="text-sm text-charcoal-ink">
            If a reading or symptom meets specific clinical criteria, your case gets a doctor
            review, and you&apos;ll see exactly who reviewed it and when.
          </p>
        </div>

        <YourCareTeam patientId={profile.id} />

        <div className="space-y-4 rounded-xl border border-charcoal-ink/10 bg-white p-6 shadow-sm">
          <h2 className="font-heading text-lg font-semibold text-charcoal-ink">
            Choose your plan
          </h2>
          <p className="text-sm text-charcoal-ink/60">
            Start free, or pick a paid plan now — you can change or cancel any time from your
            dashboard.
          </p>
          <PlanSelector />
        </div>
      </div>
    </div>
  );
}
