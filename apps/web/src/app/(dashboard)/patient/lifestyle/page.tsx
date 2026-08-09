import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { getLifestyleState, getPastLifestyleGoals } from "@/lib/lifestyle/service";
import { LifestyleClient } from "./lifestyle-client";

/**
 * Patient lifestyle programme (LPE). Entitlement-gated by
 * public.has_feature_access('lifestyle_coaching') — same guard as every other
 * gated patient page. Logging flows through the LPE safety pipeline
 * (lib/lifestyle/ingest → evaluateRedFlags before any reply).
 */
export default async function LifestylePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: hasAccess } = await supabase.rpc("has_feature_access", {
    feature: "lifestyle_coaching",
  });
  if (!hasAccess) {
    return (
      <div className="space-y-6">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Your lifestyle programme
        </h1>
        <UpgradePrompt feature="lifestyle_coaching" />
      </div>
    );
  }

  const [enrollments, pastGoals, { data: profile }] = await Promise.all([
    getLifestyleState(supabase, user.id),
    getPastLifestyleGoals(supabase, user.id),
    supabase
      .from("profiles")
      .select("condition_language_preference")
      .eq("id", user.id)
      .single(),
  ]);

  return (
    <LifestyleClient
      patientId={user.id}
      enrollments={enrollments}
      pastGoals={pastGoals}
      conditionLanguagePreference={profile?.condition_language_preference}
    />
  );
}
