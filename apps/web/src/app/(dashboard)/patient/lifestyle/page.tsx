import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLifestyleState, getPastLifestyleGoals } from "@/lib/lifestyle/service";
import { hasCoachAccess } from "@/lib/ai-coach/entitlement";
import { LifestyleClient } from "./lifestyle-client";

/**
 * Patient lifestyle programme (LPE). Free to every patient since the
 * pay-per-service rework: lifestyle coaching costs no clinician time, so it
 * is no longer entitlement-gated. Logging still flows through the LPE safety
 * pipeline (lib/lifestyle/ingest → evaluateRedFlags before any reply).
 */
export default async function LifestylePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [enrollments, pastGoals, { data: profile }, coachAccess] = await Promise.all([
    getLifestyleState(supabase, user.id),
    getPastLifestyleGoals(supabase, user.id),
    supabase
      .from("profiles")
      .select("condition_language_preference")
      .eq("id", user.id)
      .single(),
    hasCoachAccess(supabase),
  ]);

  return (
    <LifestyleClient
      patientId={user.id}
      enrollments={enrollments}
      pastGoals={pastGoals}
      conditionLanguagePreference={profile?.condition_language_preference}
      coachAccess={coachAccess}
    />
  );
}
