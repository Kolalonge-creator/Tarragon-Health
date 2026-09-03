import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
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
    <div className="space-y-6">
      <PageHeader
        title="Meals & nutrition"
        icon={SEMANTIC_ICON.nutrition}
        backTo={{ href: "/patient/lifestyle", label: "Lifestyle coaching" }}
        description="Log what you eat, with a photo if you like. We'll estimate the portions and carbs to help you and your care team spot patterns. It's a coaching guide, not a medical measurement."
      />
      <NutritionFlow patientId={profile.id} visionConfigured={isMealVisionConfigured()} />
    </div>
  );
}
