import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * Doctor-escalation entitlement for the one red-flag pathway that isn't a DB
 * trigger: glucose RED/AMBER bands (apps/web/src/lib/vitals/assess-glucose.ts)
 * stay app-layer because they need a 14-day trailing window and a per-patient
 * target override that don't fit a pure IMMUTABLE SQL classifier (see
 * glucose_emergency_db_backstop.sql's own header).
 *
 * This used to re-derive private.patient_has_feature_access's resolution logic
 * in TypeScript, because that function lives in `private` and isn't
 * PostgREST-exposed. Its own header already warned "never duplicate this logic
 * a third time — call it via an RPC instead of re-deriving it", and the
 * duplicate went on to prove the point: it queried service_purchases only, with
 * no programme_purchases branch, so it drifted away from the SQL function it
 * was mirroring and dead-ended by a second, independent route while the SQL
 * side dead-ended by its own.
 *
 * It now calls public.patient_has_feature_access(p_patient_id, p_feature) —
 * added by 20260904235834_doctor_time_features_grantable_by_the_purchasable_
 * programme.sql — so the six doctor-time gates and this one resolve through the
 * SAME code path. The RPC authorises the caller (the patient themselves, staff
 * of their organisation, or service_role) and raises rather than returning a
 * quiet false, so a permissions mistake here surfaces as an error instead of
 * silently withholding a doctor from a paying patient.
 *
 * Fails CLOSED on an RPC error, matching the previous behaviour: the patient
 * still gets the deterministic self-care guidance below and the full,
 * plan-independent emergency safety net, which never depended on this call.
 */
const VITALS_RED_FLAG_DOCTOR_ESCALATION_FEATURE = "vitals_red_flag_doctor_escalation";

export async function patientHasVitalsEscalationAccess(
  serviceRole: SupabaseClient<Database>,
  patientId: string,
): Promise<boolean> {
  const { data, error } = await serviceRole.rpc("patient_has_feature_access", {
    p_patient_id: patientId,
    p_feature: VITALS_RED_FLAG_DOCTOR_ESCALATION_FEATURE,
  });
  if (error) return false;
  return data === true;
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
