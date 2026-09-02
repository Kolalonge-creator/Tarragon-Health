import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * TypeScript counterpart to private.patient_has_feature_access(), for the one
 * red-flag pathway that isn't a DB trigger: glucose RED/AMBER bands
 * (apps/web/src/lib/vitals/assess-glucose.ts) stay app-layer because they need
 * a 14-day trailing window and a per-patient target override that don't fit a
 * pure IMMUTABLE SQL classifier (see glucose_emergency_db_backstop.sql's own
 * header). private.patient_has_feature_access isn't PostgREST-exposed (lives
 * in `private`, no anon/authenticated grant — see
 * 20260804232022_gate_result_document_review_to_paid_plans.sql's own note on
 * why), so this mirrors its exact resolution logic using a service-role
 * client, which already bypasses RLS the same way the SQL function's
 * SECURITY DEFINER does.
 *
 * Repointed 2026-08-31 at service_purchases/service_products (the
 * pay-per-service replacement for subscriptions/subscription_plans/
 * subscription_add_ons/add_ons) — this is a SAFETY-CRITICAL path (the
 * dangerous-glucose-reading doctor escalation gate) that was found still
 * querying the retiring tables after they'd already been cut off from all
 * new writes, which would have silently stopped every real patient's
 * glucose emergency escalation from firing. Never duplicate this logic a
 * third time — if another gate like this turns up, call
 * private.patient_has_feature_access via an RPC instead of re-deriving it.
 */
const VITALS_RED_FLAG_DOCTOR_ESCALATION_FEATURE = "vitals_red_flag_doctor_escalation";

export async function patientHasVitalsEscalationAccess(
  serviceRole: SupabaseClient<Database>,
  patientId: string,
): Promise<boolean> {
  const { data: profile } = await serviceRole
    .from("profiles")
    .select("role")
    .eq("id", patientId)
    .maybeSingle();
  if (profile?.role === "admin") return true;

  const { data: purchases } = await serviceRole
    .from("service_purchases")
    .select("expires_at, service_product:service_products(features)")
    .eq("patient_id", patientId)
    .eq("status", "active");

  const now = Date.now();
  return (purchases ?? []).some((p) => {
    if (p.expires_at && new Date(p.expires_at).getTime() <= now) return false;
    return (p.service_product?.features ?? []).includes(VITALS_RED_FLAG_DOCTOR_ESCALATION_FEATURE);
  });
}

/** Deterministic self-care copy per glucose flag kind — same discipline as the
 * DB-side red-flag engines (not a live AI call; see private.raise_dangerous_
 * reading_ai_suggestion's own header). */
export const GLUCOSE_SELF_CARE_NOTE: Record<string, string> = {
  hypo_alert:
    "If you feel shaky, sweaty, or confused, treat this as your diabetes plan directs (fast-acting sugar) and recheck in about 15 minutes. If it doesn't come back up, seek care promptly.",
  very_high:
    "Check your ketones if you can, drink water, and follow your usual sick-day rules. Recheck in a few hours; if it stays very high or you feel unwell, seek care promptly.",
  ketones_raised:
    "Drink water, avoid strenuous activity, and recheck your glucose and ketones in a few hours. If ketones stay raised or you feel unwell, seek care promptly.",
  persistent_hyperglycaemia:
    "Your glucose has been running high over the last two weeks. Review your usual meal timing, activity, and medication adherence, and keep logging so a pattern is easy to spot.",
  recurrent_hypo:
    "You've had more than one low reading recently. Consider whether meal timing, activity, or medication dose needs adjusting, and keep a fast-acting sugar source on hand.",
  ketones_moderate:
    "Drink water and recheck your ketones later today. If they rise further or you feel unwell, seek care promptly.",
};
