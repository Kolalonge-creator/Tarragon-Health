"use server";

import { createClient } from "@/lib/supabase/server";
import { mentalHealthScreenSchema } from "@/lib/validation/mental-health-screen";
import { saveMentalHealthScreens } from "@/lib/mental-health/save-screens";

export type SubmitMentalHealthState =
  | { error?: string; success?: boolean; crisis?: boolean; told?: boolean }
  | undefined;

/**
 * Records a mental-health screen (AHC pathway §11; Module 46 §46.3): PHQ-9, GAD-7, AUDIT-C, and, only when the patient opted in as
 * pregnant or postpartum, EPDS. Scoring, the service-role insert and the crisis route live in lib/mental-health/save-screens.ts, shared
 * with the mobile route so the two cannot drift. A self-harm answer is handled by the database (emergency event, priority task, page);
 * a moderate or high band is separately raised to a clinician by the database triggers. The screen is never actioned by software alone.
 */
export async function submitMentalHealthScreen(
  _prevState: SubmitMentalHealthState,
  formData: FormData
): Promise<SubmitMentalHealthState> {
  const parsed = mentalHealthScreenSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please answer every question" };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const result = await saveMentalHealthScreens({ userClient: supabase, userId: user.id, answers: parsed.data });
  if (!result.ok) return { error: result.error };
  return { success: true, crisis: result.crisis, told: result.told };
}
