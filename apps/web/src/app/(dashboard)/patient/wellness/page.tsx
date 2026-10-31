import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { SEMANTIC_ICON } from "@/lib/icons";
import { PageHeader } from "@/components/ui/page-header";
import { Disclosure } from "@/components/ui/disclosure";
import { isMealVisionConfigured } from "@/lib/nutrition/meal-vision";
import { isMealPlanGenerationConfigured } from "@/lib/nutrition/meal-plan-generate";
import { NutritionFlow } from "../nutrition-flow";
import { WellnessPointsCard } from "./points-card";
import { MilestoneCard } from "./milestone-card";
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
        backTo={{ href: "/patient", label: "Dashboard" }}
        title="Wellness rewards"
        icon={SEMANTIC_ICON.points}
        description="Small, everyday habits add up. Earn points for logging, learning, and finishing challenges, and collect badges along the way. Points show your progress; they are not money."
      />

      <MilestoneCard patientId={profile.id} />

      <WellnessPointsCard patientId={profile.id} />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <BadgesGrid patientId={profile.id} />
        <ChallengesSection patientId={profile.id} />
      </div>

      {/* Folded to keep the page short (design audit 4.7). Each opens in place; nothing inside was changed. */}
      <Disclosure title="Meal log" hint="Log what you eat and earn points for it">
        <NutritionFlow
          patientId={profile.id}
          visionConfigured={isMealVisionConfigured()}
          activeConditions={activeConditions}
          mealPlanGenerationConfigured={isMealPlanGenerationConfigured()}
        />
      </Disclosure>

      <Disclosure title="Workout classes" hint="Live and on-demand classes you can join">
        <ClassesSection patientId={profile.id} organisationId={profile.organisation_id} />
      </Disclosure>
    </div>
  );
}
