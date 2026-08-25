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
 * why), so this mirrors its exact resolution logic against the same tables
 * using a service-role client, which already bypasses RLS the same way the
 * SQL function's SECURITY DEFINER does.
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

  const { data: subs } = await serviceRole
    .from("subscriptions")
    .select("id, plan_id")
    .eq("subscriber_id", patientId)
    .in("status", ["active", "trialing"]);

  const planIds = (subs ?? []).map((s) => s.plan_id).filter((id): id is string => !!id);
  if (planIds.length > 0) {
    const { data: plans } = await serviceRole
      .from("subscription_plans")
      .select("features")
      .in("id", planIds);
    if (plans?.some((p) => (p.features ?? []).includes(VITALS_RED_FLAG_DOCTOR_ESCALATION_FEATURE))) {
      return true;
    }
  }

  const subIds = (subs ?? []).map((s) => s.id);
  if (subIds.length > 0) {
    const { data: addOnLinks } = await serviceRole
      .from("subscription_add_ons")
      .select("add_on_id")
      .in("subscription_id", subIds)
      .in("status", ["active", "trialing"]);
    const addOnIds = (addOnLinks ?? []).map((a) => a.add_on_id).filter((id): id is string => !!id);
    if (addOnIds.length > 0) {
      const { data: addOns } = await serviceRole
        .from("add_ons")
        .select("features")
        .in("id", addOnIds);
      if (addOns?.some((a) => (a.features ?? []).includes(VITALS_RED_FLAG_DOCTOR_ESCALATION_FEATURE))) {
        return true;
      }
    }
  }

  return false;
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
