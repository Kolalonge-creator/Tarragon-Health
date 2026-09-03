import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { SEMANTIC_ICON } from "@/lib/icons";
import { PageHeader } from "@/components/ui/page-header";
import { isMealVisionConfigured } from "@/lib/nutrition/meal-vision";
import { isMealPlanGenerationConfigured } from "@/lib/nutrition/meal-plan-generate";
import { NutritionFlow } from "../nutrition-flow";
import { WellnessPointsCard } from "./points-card";
import { BadgesGrid } from "./badges-grid";
import { ChallengesSection } from "./challenges-section";
import { ClassesSection } from "./classes-section";

/**
 * Wellness hub — points, badges, challenges, meal log, and workout classes.
 * An engagement/habit-formation layer, free to every patient — lifestyle
 * coaching (including the embedded meal log) has no plan gate at all, same
 * as its own dedicated page (see "Make the app free; charge only for a
 * doctor's time").
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
      <PageHeader
        title="Wellness rewards"
        icon={SEMANTIC_ICON.points}
        description="Small, everyday habits add up. Earn points for logging, learning, and finishing challenges, collect badges along the way, and redeem points any time for a real Health reward voucher you can put toward your care."
      />

      <WellnessPointsCard patientId={profile.id} />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <BadgesGrid patientId={profile.id} />
        <ChallengesSection patientId={profile.id} />
      </div>

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

      <ClassesSection patientId={profile.id} organisationId={profile.organisation_id} />
    </div>
  );
}
