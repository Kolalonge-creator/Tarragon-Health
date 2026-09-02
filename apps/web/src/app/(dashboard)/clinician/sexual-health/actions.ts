"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Enums, TablesUpdate } from "@tarragon/shared";

export type SexualHealthActionState = { error?: string; success?: boolean } | undefined;

const STI_ADVANCE_TARGETS = [
  "clinical_review",
  "patient_notified",
  "treatment_in_progress",
  "treatment_completed",
  "declined_care",
  "closed",
] as const;

const advanceStiCaseSchema = z.object({
  episodeId: z.string().uuid("Invalid case reference"),
  nextStatus: z.enum(STI_ADVANCE_TARGETS),
  note: z.string().trim().max(2000).optional(),
});

/**
 * Advances an sti_case_episodes row one step along its transition ladder
 * (spec §47.5): result_received -> clinical_review -> patient_notified ->
 * treatment_in_progress -> treatment_completed -> closed, with declined_care
 * reachable from every non-terminal state except treatment_completed (whose
 * only legal next state is closed) — see the worklist's own
 * STI_NEXT_STATUSES map, which mirrors migration
 * 20260829090200_sti_case_episodes_and_partner_notification.sql's
 * enforce_sti_case_episode_transition() trigger exactly.
 *
 * The trigger is the real authority: it rejects an illegal transition and
 * derives reviewed_by/treated_by/*_at itself from the caller's own active
 * clinical_staff row, so nothing here ever sets those columns directly.
 * declined_care is the one transition the trigger allows without an active
 * clinical_staff row (a logistics-only "patient declined care" note); every
 * other transition needs one, so — matching
 * screening-result-actions.ts's setScreeningResultFollowUpAction — that row
 * is fetched first for a friendlier error than the raw Postgres exception.
 */
export async function advanceStiCaseEpisode(
  episodeId: string,
  nextStatus: Enums<"sti_case_status">,
  note?: string
): Promise<SexualHealthActionState> {
  const parsed = advanceStiCaseSchema.safeParse({ episodeId, nextStatus, note });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  if (parsed.data.nextStatus !== "declined_care") {
    const { data: staff } = await supabase
      .from("clinical_staff")
      .select("id")
      .eq("profile_id", user.id)
      .eq("active", true)
      .maybeSingle();
    if (!staff) return { error: "Only an active Tarragon care-team doctor can do this." };
  }

  const update: TablesUpdate<"sti_case_episodes"> = { status: parsed.data.nextStatus };
  if (parsed.data.note) {
    if (parsed.data.nextStatus === "declined_care") {
      update.declined_reason = parsed.data.note;
    } else if (
      parsed.data.nextStatus === "treatment_in_progress" ||
      parsed.data.nextStatus === "treatment_completed"
    ) {
      update.treatment_notes = parsed.data.note;
    }
  }

  const { error } = await supabase
    .from("sti_case_episodes")
    .update(update)
    .eq("id", parsed.data.episodeId);
  if (error) return { error: error.message };

  return { success: true };
}

const PARTNER_NOTIFICATION_STATUSES = [
  "requested",
  "contacted",
  "could_not_reach",
  "declined_by_care_team",
] as const;

const partnerNotificationSchema = z.object({
  notificationId: z.string().uuid("Invalid notification reference"),
  status: z.enum(PARTNER_NOTIFICATION_STATUSES),
  notes: z.string().trim().max(1000).optional(),
});

/**
 * Records the outcome of a clinician-assisted partner-notification attempt
 * (spec §47.6) — sti_partner_notifications has no transition-ladder trigger
 * of its own, just RLS (is_org_staff) on the update, so this is a plain
 * authenticated write with no separate clinical_staff pre-check: logging a
 * contact attempt is logistics, not a clinical judgement call.
 */
export async function updatePartnerNotificationOutcome(
  notificationId: string,
  status: Enums<"partner_notification_status">,
  notes?: string
): Promise<SexualHealthActionState> {
  const parsed = partnerNotificationSchema.safeParse({ notificationId, status, notes });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("sti_partner_notifications")
    .update({
      clinician_assisted_status: parsed.data.status,
      clinician_assisted_notes: parsed.data.notes ?? null,
    })
    .eq("id", parsed.data.notificationId);
  if (error) return { error: error.message };

  return { success: true };
}

const ecActionSchema = z.object({
  requestId: z.string().uuid("Invalid request reference"),
  status: z.enum(["reviewed", "dispensed", "declined"]),
  methodAdvised: z.string().trim().min(1).max(100).optional(),
});

/**
 * Actions a pending emergency contraception request (spec §47.8) — reviewed,
 * dispensed, or declined, with an optional method_advised
 * (contraception_methods.code). The BEFORE UPDATE trigger
 * (enforce_ec_request_update) requires an active clinical_staff row for
 * every transition off 'pending' (unlike the STI ladder's declined_care
 * carve-out) and rejects re-actioning an already-actioned request, so both
 * are pre-checked/pre-empted here for a friendlier message, then left to the
 * trigger as the real authority.
 */
export async function actionEmergencyContraceptionRequest(
  requestId: string,
  status: "reviewed" | "dispensed" | "declined",
  methodAdvised?: string
): Promise<SexualHealthActionState> {
  const parsed = ecActionSchema.safeParse({ requestId, status, methodAdvised });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: staff } = await supabase
    .from("clinical_staff")
    .select("id")
    .eq("profile_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!staff) return { error: "Only an active Tarragon care-team doctor can action this request." };

  const { error } = await supabase
    .from("emergency_contraception_requests")
    .update({
      status: parsed.data.status,
      method_advised: parsed.data.methodAdvised ?? null,
    })
    .eq("id", parsed.data.requestId);
  if (error) return { error: error.message };

  return { success: true };
}

const contraceptionPlanActionSchema = z.object({
  planId: z.string().uuid("Invalid plan reference"),
  status: z.enum(["active", "declined"]),
});

/**
 * Activates or declines a requested contraception plan (spec §47.7). The
 * BEFORE UPDATE trigger (enforce_contraception_plan_update) requires an
 * active clinical_staff row only for the 'requested' -> 'active' transition
 * (it derives prescribed_by/started_at there) and places no such requirement
 * on 'declined' — matching the STI ladder's own "declining needs no clinical
 * authority" shape, this only pre-checks staff for 'active'.
 */
export async function actionContraceptionPlanRequest(
  planId: string,
  status: "active" | "declined"
): Promise<SexualHealthActionState> {
  const parsed = contraceptionPlanActionSchema.safeParse({ planId, status });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  if (parsed.data.status === "active") {
    const { data: staff } = await supabase
      .from("clinical_staff")
      .select("id")
      .eq("profile_id", user.id)
      .eq("active", true)
      .maybeSingle();
    if (!staff) {
      return { error: "Only an active Tarragon care-team doctor can activate a contraception plan." };
    }
  }

  const { error } = await supabase
    .from("contraception_plans")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.planId);
  if (error) return { error: error.message };

  return { success: true };
}
