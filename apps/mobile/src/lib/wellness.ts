import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import type { Tables } from "@tarragon/shared";

/**
 * Wellness gamification (points, badges, challenges, classes). An engagement
 * layer, free to every patient regardless of plan — mirrors the
 * patient-facing half of apps/web/src/lib/queries/wellness.ts (the admin
 * catalogue functions there are staff-only and not ported). No table/RPC
 * here needs a service-role client, and none is a real financial
 * transaction — redeem_wellness_points mints a care_vouchers row from the
 * patient's own points, it never moves money or calls Paystack.
 */

export type WellnessPointsBalance = Tables<"wellness_points_balances">;
export type WellnessPointsLedgerEntry = Tables<"wellness_points_ledger">;
export type WellnessBadge = Tables<"wellness_badges">;
export type PatientWellnessBadge = Tables<"patient_wellness_badges"> & {
  wellness_badges: WellnessBadge | null;
};
export type WellnessChallenge = Tables<"wellness_challenges">;
export type ChallengeEnrolment = Tables<"patient_challenge_enrolments"> & {
  wellness_challenges: WellnessChallenge | null;
};
export type WellnessClassProvider = Tables<"wellness_class_providers">;
export type WellnessClass = Tables<"wellness_classes"> & {
  wellness_class_providers: WellnessClassProvider | null;
};
export type WellnessClassRegistration = Tables<"wellness_class_registrations"> & {
  wellness_classes: WellnessClass | null;
};

/** Reuses points-card.tsx's copy map verbatim. */
export const REASON_LABEL: Record<string, string> = {
  vitals_logged: "Logged a vitals reading",
  meal_logged: "Logged a meal",
  adherence_checkin_completed: "Answered a medication check-in",
  education_lesson_completed: "Completed a lesson",
  lpe_task_completed: "Completed a lifestyle task",
  lpe_goal_achieved: "Achieved a lifestyle goal",
  challenge_completed: "Completed a challenge",
  wellness_class_attended: "Attended a class",
  redeemed_to_voucher: "Redeemed for a voucher",
};

export function reasonLabel(reason: string): string {
  return REASON_LABEL[reason] ?? reason.replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// Points
// ---------------------------------------------------------------------------

/** Zero balance (not yet earned anything) returns null — the row is only
 * created on the first award, same as web. */
export async function loadWellnessPointsBalance(patientId: string): Promise<WellnessPointsBalance | null> {
  const { data } = await supabase
    .from("wellness_points_balances")
    .select("*")
    .eq("patient_id", patientId)
    .maybeSingle();
  return data ?? null;
}

export async function loadWellnessPointsLedger(patientId: string, limit = 8): Promise<WellnessPointsLedgerEntry[]> {
  const { data } = await supabase
    .from("wellness_points_ledger")
    .select("*")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export interface RedeemWellnessPointsResult {
  balance?: number;
  koboCredited?: number;
  voucherId?: string;
}

/** Not a payment/checkout flow — an internal points-ledger debit that mints
 * a care_vouchers row via private.issue_reward_voucher. Safe as a plain
 * direct RPC call, unlike a real Paystack transaction. */
export async function redeemWellnessPoints(points: number): Promise<QueryResult<RedeemWellnessPointsResult>> {
  if (!points || points <= 0) return { ok: false, error: "Enter a positive number of points." };
  const { data, error } = await supabase.rpc("redeem_wellness_points", { p_points: points });
  if (error) return { ok: false, error: error.message };
  const result = data as { ok: boolean; error?: string; balance?: number; kobo_credited?: number; voucher_id?: string };
  if (!result.ok) return { ok: false, error: result.error ?? "Could not redeem points." };
  return { ok: true, data: { balance: result.balance, koboCredited: result.kobo_credited, voucherId: result.voucher_id } };
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export async function loadWellnessBadgesCatalogue(): Promise<WellnessBadge[]> {
  const { data } = await supabase
    .from("wellness_badges")
    .select("*")
    .eq("is_active", true)
    .order("criteria_threshold", { ascending: true });
  return data ?? [];
}

export async function loadMyWellnessBadges(patientId: string): Promise<PatientWellnessBadge[]> {
  const { data } = await supabase
    .from("patient_wellness_badges")
    .select("*, wellness_badges(*)")
    .eq("patient_id", patientId)
    .order("awarded_at", { ascending: false });
  return (data ?? []) as PatientWellnessBadge[];
}

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

export async function loadWellnessChallengesCatalogue(): Promise<WellnessChallenge[]> {
  const { data } = await supabase
    .from("wellness_challenges")
    .select("*")
    .eq("is_active", true)
    .order("duration_days", { ascending: true });
  return data ?? [];
}

export async function loadMyChallengeEnrolments(patientId: string): Promise<ChallengeEnrolment[]> {
  const { data } = await supabase
    .from("patient_challenge_enrolments")
    .select("*, wellness_challenges(*)")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });
  return (data ?? []) as ChallengeEnrolment[];
}

export async function enrolInWellnessChallenge(challengeId: string): Promise<QueryResult<null>> {
  const { error } = await supabase.rpc("enrol_in_wellness_challenge", { p_challenge_id: challengeId });
  if (error) return { ok: false, error: error.message || "Could not join that challenge." };
  return { ok: true, data: null };
}

export async function loadWellnessChallengeProgress(
  enrolmentId: string
): Promise<{ progress: number; target: number } | null> {
  const { data, error } = await supabase.rpc("wellness_challenge_progress", { p_enrolment_id: enrolmentId });
  if (error) return null;
  return data as { progress: number; target: number };
}

// ---------------------------------------------------------------------------
// Workout classes & health workshops (dormant until a real partner is
// active — an empty list here reflects real seed data, not a bug)
// ---------------------------------------------------------------------------

export async function loadUpcomingWellnessClasses(): Promise<WellnessClass[]> {
  const { data } = await supabase
    .from("wellness_classes")
    .select("*, wellness_class_providers!inner(*)")
    .eq("is_active", true)
    .eq("wellness_class_providers.is_active", true)
    .gt("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true });
  return (data ?? []) as WellnessClass[];
}

export async function loadMyClassRegistrations(patientId: string): Promise<WellnessClassRegistration[]> {
  const { data } = await supabase
    .from("wellness_class_registrations")
    .select("*, wellness_classes(*)")
    .eq("patient_id", patientId)
    .order("registered_at", { ascending: false });
  return (data ?? []) as WellnessClassRegistration[];
}

export async function registerForWellnessClass(
  patientId: string,
  organisationId: string,
  classId: string
): Promise<QueryResult<null>> {
  const { error } = await supabase
    .from("wellness_class_registrations")
    .insert({ patient_id: patientId, organisation_id: organisationId, class_id: classId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

/** Patient self-reports attendance after the fact — same trust level
 * already given to lifestyle telemetry; the points award is not a clinical
 * claim. */
export async function markWellnessClassAttended(registrationId: string): Promise<QueryResult<null>> {
  const { error } = await supabase
    .from("wellness_class_registrations")
    .update({ status: "attended" })
    .eq("id", registrationId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}
