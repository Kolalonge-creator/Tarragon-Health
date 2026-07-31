import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { RequiresEntitlement } from "@/components/requires-entitlement";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { SEMANTIC_ICON } from "@/lib/icons";
import { isMealVisionConfigured } from "@/lib/nutrition/meal-vision";
import { NutritionFlow } from "../nutrition-flow";
import { WellnessPointsCard } from "./points-card";
import { BadgesGrid } from "./badges-grid";
import { ChallengesSection } from "./challenges-section";
import { ClassesSection } from "./classes-section";

/**
 * Wellness hub — points, badges, challenges, meal log, and workout classes.
 * An engagement/habit-formation layer, free to every patient regardless of
 * plan (only the embedded meal log stays behind its existing
 * lifestyle_coaching gate, same as its own dedicated page) — pure
 * composition over existing entitlement/RLS-checked components, no new gate
 * invented here.
 */
export default async function WellnessHubPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.onboarding_completed_at) redirect("/onboarding");

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-6">
      <div>
        <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold text-charcoal-ink">
          <SEMANTIC_ICON.points className="h-6 w-6 text-deep-forest" strokeWidth={2} />
          Wellness rewards
        </h1>
        <p className="mt-1 text-sm text-charcoal-ink/70">
          Small, everyday habits add up. Earn points for logging, learning, and finishing
          challenges, collect badges along the way, and redeem points any time for real Health
          reward voucher you can put toward your care.
        </p>
      </div>

      <WellnessPointsCard patientId={profile.id} />
      <BadgesGrid patientId={profile.id} />
      <ChallengesSection patientId={profile.id} />

      <RequiresEntitlement
        feature="lifestyle_coaching"
        fallback={<UpgradePrompt feature="lifestyle_coaching" />}
      >
        <div>
          <h2 className="mb-2 flex items-center gap-2 font-heading text-lg font-semibold text-charcoal-ink">
            <SEMANTIC_ICON.nutrition className="h-5 w-5 text-deep-forest" strokeWidth={2} />
            Meal log
          </h2>
          <NutritionFlow patientId={profile.id} visionConfigured={isMealVisionConfigured()} />
        </div>
      </RequiresEntitlement>

      <ClassesSection patientId={profile.id} organisationId={profile.organisation_id} />
    </div>
  );
}
