import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { RequiresEntitlement } from "@/components/requires-entitlement";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { SEMANTIC_ICON } from "@/lib/icons";
import { isMealVisionConfigured } from "@/lib/nutrition/meal-vision";
import { isMealPlanGenerationConfigured } from "@/lib/nutrition/meal-plan-generate";
import { NutritionFlow } from "../nutrition-flow";

export default async function NutritionPage() {
  const profile = await getCurrentProfile();
  if (!profile) {
    redirect("/login");
  }
  if (!profile.onboarding_completed_at) {
    redirect("/onboarding");
  }

  // Active chronic conditions drive condition-specific nutrition guidance
  // (spec 19.6) and the nutrition-risk check for the professional-support
  // pathway (19.11) — fetched here, server-side, from the same source of
  // truth the rest of the platform uses (care_plans), not inferred.
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
        title="Meals & nutrition"
        icon={SEMANTIC_ICON.nutrition}
        backTo={{ href: "/patient/lifestyle", label: "Lifestyle coaching" }}
        description="Log what you eat, with a photo if you like. We'll estimate the portions and carbs to help you and your care team spot patterns. It's a coaching guide, not a medical measurement."
      />
      <RequiresEntitlement
        feature="lifestyle_coaching"
        fallback={<UpgradePrompt feature="lifestyle_coaching" />}
      >
        <NutritionFlow
          patientId={profile.id}
          visionConfigured={isMealVisionConfigured()}
          activeConditions={activeConditions}
          mealPlanGenerationConfigured={isMealPlanGenerationConfigured()}
        />
      </RequiresEntitlement>
    </div>
  );
}
