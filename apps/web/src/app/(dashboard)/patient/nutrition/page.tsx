import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { RequiresEntitlement } from "@/components/requires-entitlement";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { isMealVisionConfigured } from "@/lib/nutrition/meal-vision";
import { NutritionFlow } from "../nutrition-flow";

export default async function NutritionPage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }
  if (!profile.onboarding_completed_at) {
    redirect("/onboarding");
  }

  return (
    <DashboardPlaceholder greeting="Meal & nutrition" roleLabel="Patient" comingUp={[]}>
      <div className="flex justify-end">
        <Link
          href="/patient/lifestyle"
          className="text-sm font-medium text-brand-green hover:underline"
        >
          ← Back to lifestyle coaching
        </Link>
      </div>
      <p className="max-w-2xl text-sm text-charcoal-ink/70">
        Log what you eat — with a photo if you like. We&apos;ll estimate the portions and carbs to
        help you and your care team spot patterns. It&apos;s a coaching guide, not a medical
        measurement.
      </p>
      <RequiresEntitlement
        feature="lifestyle_coaching"
        fallback={<UpgradePrompt feature="lifestyle_coaching" />}
      >
        <NutritionFlow patientId={profile.id} visionConfigured={isMealVisionConfigured()} />
      </RequiresEntitlement>
    </DashboardPlaceholder>
  );
}
