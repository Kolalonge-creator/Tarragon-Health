"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { adolescentPsychosocialScreenSchema } from "@/lib/validation/adolescent-psychosocial-screen";
import { scoreAdolescentPsychosocialScreen } from "@/lib/rules/adolescent-psychosocial-screening";
import type { Json } from "@tarragon/shared";

export type SubmitAdolescentScreenState =
  | {
      error?: string;
      success?: boolean;
      selfHarmFlagged?: boolean;
      immediateDangerFlagged?: boolean;
      abuseNeglectExploitationFlagged?: boolean;
    }
  | undefined;

/**
 * Records an adolescent psychosocial check-in (spec §49.5/§49.6). Flags are
 * computed here (never trusting the client) and written via the service
 * role — same "computed row, service-role write" shape as
 * submitMentalHealthScreen. Unlike that action, this one does NOT also
 * insert into emergency_events itself: the row insert fires
 * private.handle_adolescent_psychosocial_screen_flags() (an AFTER INSERT
 * trigger, SECURITY DEFINER), which raises the emergency/safeguarding
 * pathway regardless of what this action does next — see
 * supabase/migrations/20260829121248_adolescent_health_module.sql for why
 * that was made trigger-guaranteed rather than app-layer, unlike the older
 * mental-health check-in.
 */
export async function submitAdolescentPsychosocialScreen(
  _prevState: SubmitAdolescentScreenState,
  formData: FormData
): Promise<SubmitAdolescentScreenState> {
  const parsed = adolescentPsychosocialScreenSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please answer every question" };
  }
  const answers = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) return { error: "No organisation on file" };

  const result = scoreAdolescentPsychosocialScreen({
    homeFeelsSafe: answers.home_feels_safe,
    homeHurtOrThreatened: answers.home_hurt_or_threatened,
    educationNote: answers.education_note,
    daysActivePerWeek: answers.days_active_per_week,
    sleepHoursPerNight: answers.sleep_hours_per_night,
    substanceUseLastMonth: answers.substance_use_last_month,
    sexualHealthSupportRequested: answers.sexual_health_support_requested,
    selfHarmThoughts: answers.self_harm_thoughts,
    unsafeElsewhere: answers.unsafe_elsewhere,
    immediateDanger: answers.immediate_danger,
    notes: answers.notes,
  });

  const service = createServiceRoleClient();
  const { error: insertError } = await service.from("adolescent_psychosocial_screens").insert({
    organisation_id: profile.organisation_id,
    patient_id: user.id,
    domain_responses: result.domainResponses as Json,
    self_harm_flagged: result.selfHarmFlagged,
    immediate_danger_flagged: result.immediateDangerFlagged,
    abuse_neglect_exploitation_flagged: result.abuseNeglectExploitationFlagged,
    substance_use_concern_flagged: result.substanceUseConcernFlagged,
    sexual_health_follow_up_requested: result.sexualHealthFollowUpRequested,
  });
  if (insertError) return { error: insertError.message };

  revalidatePath("/patient/adolescent-health");

  return {
    success: true,
    selfHarmFlagged: result.selfHarmFlagged,
    immediateDangerFlagged: result.immediateDangerFlagged,
    abuseNeglectExploitationFlagged: result.abuseNeglectExploitationFlagged,
  };
}
