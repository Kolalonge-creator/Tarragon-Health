import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import type { Enums, Tables } from "@tarragon/shared";

/**
 * Contraception browse/request (spec §47.7) + emergency contraception fast
 * track (spec §47.8). Mirrors apps/web/.../patient/sexual-health/
 * {contraception,emergency-contraception}-actions.ts + lib/queries/
 * {contraception,emergency-contraception}.ts. Every write is a plain
 * RLS-scoped insert under the patient's own session — no service role.
 * **patientId/organisationId are always the device owner's own ids — see
 * sti.ts's header comment for why.**
 */

export type ContraceptionMethod = Tables<"contraception_methods">;
export type ContraceptionPlan = Tables<"contraception_plans">;
export type ContraceptionMethodCategory = Enums<"contraception_method_category">;
export type ContraceptionPlanStatus = Enums<"contraception_plan_status">;

export const CONTRACEPTION_CATEGORY_LABEL: Record<ContraceptionMethodCategory, string> = {
  hormonal_pill: "Pills",
  injectable: "Injectable",
  implant: "Implant",
  iud_hormonal: "Hormonal IUD",
  iud_copper: "Copper IUD",
  barrier: "Barrier methods",
  permanent: "Permanent methods",
  natural_method: "Natural methods",
  emergency: "Emergency contraception",
};

export const CONTRACEPTION_STATUS_LABEL: Record<ContraceptionPlanStatus, string> = {
  requested: "Requested (awaiting review)",
  active: "Active",
  discontinued: "Discontinued",
  completed: "Completed",
  declined: "Declined",
};

export async function loadContraceptionMethods(): Promise<ContraceptionMethod[]> {
  const { data } = await supabase.from("contraception_methods").select("*").eq("is_active", true).order("sort_order", { ascending: true });
  return data ?? [];
}

export async function loadContraceptionPlans(patientId: string): Promise<ContraceptionPlan[]> {
  const { data } = await supabase.from("contraception_plans").select("*").eq("patient_id", patientId).order("created_at", { ascending: false });
  return data ?? [];
}

/** A patient's own request for a contraception method. Written under the
 * caller's own session — contraception_plans_insert already restricts this
 * to the caller's own patient_id/organisation_id with status='requested',
 * prescribed_by null. A clinician later reviews and activates it
 * (staff-side, elsewhere). */
export async function requestContraceptionMethod(patientId: string, organisationId: string, methodCode: string): Promise<QueryResult<null>> {
  const code = methodCode.trim();
  if (!code) return { ok: false, error: "Choose a method" };
  const { error } = await supabase.from("contraception_plans").insert({
    organisation_id: organisationId,
    patient_id: patientId,
    method_code: code,
    status: "requested",
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

/**
 * Deterministic, warm, factual EC guidance keyed off hours since
 * intercourse — verbatim port of emergency-contraception-actions.ts's
 * computeEcGuidance. Intentionally reassuring, never alarming: there is
 * almost always still something that can help, and "not sure" always
 * routes to a clinician rather than a dead end. This is display text only
 * (not a scoring/escalation decision) — the doc's data model marks this row
 * "safe direct," so computing it client-side before the insert (rather than
 * needing a new API route) matches web's own "doesn't need service role,
 * only RLS" classification.
 */
export function computeEcGuidance(hoursSinceIntercourse: number | null): string {
  if (hoursSinceIntercourse == null) {
    return "No exact time needed. A clinician will review with you directly and help you find the right option quickly.";
  }
  if (hoursSinceIntercourse < 72) {
    return "Good news: the emergency pill and the copper IUD are both effective right now. The sooner you can act, the more effective they are.";
  }
  if (hoursSinceIntercourse <= 120) {
    return "The copper IUD is still effective, and some emergency pills may still work too. A clinician will confirm the best option with you quickly.";
  }
  return "A clinician will review with you directly to talk through what's still possible and the best next step.";
}

/** Records a fast-track EC request. RLS already permits the caller's own
 * patient_id/organisation_id with status='pending' — the DB's own
 * ec_requests_raise_alert trigger raises the 1-hour-SLA clinician alert on
 * insert, nothing further needed here. */
export async function requestEmergencyContraception(
  patientId: string,
  organisationId: string,
  hoursSinceIntercourse: number | null
): Promise<QueryResult<{ guidance: string }>> {
  const guidance = computeEcGuidance(hoursSinceIntercourse);
  const { error } = await supabase.from("emergency_contraception_requests").insert({
    organisation_id: organisationId,
    patient_id: patientId,
    hours_since_intercourse: hoursSinceIntercourse,
    guidance_shown: guidance,
    status: "pending",
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { guidance } };
}
