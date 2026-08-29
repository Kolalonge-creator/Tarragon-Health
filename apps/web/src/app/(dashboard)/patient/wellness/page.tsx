import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { RequiresEntitlement } from "@/components/requires-entitlement";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { SEMANTIC_ICON } from "@/lib/icons";
import { isMealVisionConfigured } from "@/lib/nutrition/meal-vision";
import { isMealPlanGenerationConfigured } from "@/lib/nutrition/meal-plan-generate";
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

  const supabase = await createClient();
  const { data: carePlans } = await supabase
    .from("care_plans")
    .select("condition")
    .eq("patient_id", profile.id)
    .eq("status", "active");
  const activeConditions = Array.from(new Set((carePlans ?? []).map((p) => p.condition)));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-sprout-gold to-amber-600 p-6 text-white sm:p-7">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15">
          <SEMANTIC_ICON.points className="h-6 w-6" strokeWidth={2} />
        </span>
        <div>
          <h1 className="font-heading text-xl font-bold sm:text-2xl">Wellness rewards</h1>
          <p className="mt-1 text-sm text-white/85">
            Small, everyday habits add up. Earn points for logging, learning, and finishing
            challenges, collect badges along the way, and redeem points any time for a real
            Health reward voucher you can put toward your care.
          </p>
        </div>
      </div>

      <WellnessPointsCard patientId={profile.id} />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <BadgesGrid patientId={profile.id} />
        <ChallengesSection patientId={profile.id} />
      </div>

      <RequiresEntitlement
        feature="lifestyle_coaching"
        fallback={<UpgradePrompt feature="lifestyle_coaching" />}
      >
        <div>
          <h2 className="mb-2 flex items-center gap-2 font-heading text-lg font-semibold text-charcoal-ink">
            <SEMANTIC_ICON.nutrition className="h-5 w-5 text-deep-forest" strokeWidth={2} />
            Meal log
          </h2>
          <NutritionFlow
            patientId={profile.id}
            visionConfigured={isMealVisionConfigured()}
            activeConditions={activeConditions}
            mealPlanGenerationConfigured={isMealPlanGenerationConfigured()}
          />
        </div>
      </RequiresEntitlement>

      <ClassesSection patientId={profile.id} organisationId={profile.organisation_id} />
    </div>
  );
}
