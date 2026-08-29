"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type RequestEmergencyContraceptionState =
  | { error?: string; success?: boolean; guidance?: string }
  | undefined;

// Blank / "not sure" is a real, common answer (mirrors patient_exposure_
// reports.occurred_on) and must never block the request — preprocess an
// empty/missing value to undefined rather than rejecting it.
const ecRequestSchema = z.object({
  hours_since_intercourse: z.preprocess((value) => {
    if (typeof value !== "string" || value.trim() === "") return undefined;
    return value;
  }, z.coerce.number().int().min(0).optional()),
});

/**
 * Deterministic, warm, factual guidance keyed off hours since intercourse
 * (spec §47.8). Computed here — server-side — so the guidance_shown record
 * (and what the patient reads back on screen) is never something a client
 * could spoof. Intentionally reassuring, never alarming: there is almost
 * always still something that can help, and "not sure" always routes to a
 * clinician rather than a dead end.
 */
export function computeEcGuidance(hoursSinceIntercourse: number | null): string {
  if (hoursSinceIntercourse == null) {
    return "No exact time needed — a clinician will review with you directly and help you find the right option quickly.";
  }
  if (hoursSinceIntercourse < 72) {
    return "Good news: the emergency pill and the copper IUD are both effective right now — the sooner you can act, the more effective they are.";
  }
  if (hoursSinceIntercourse <= 120) {
    return "The copper IUD is still effective, and some emergency pills may still work too — a clinician will confirm the best option with you quickly.";
  }
  return "A clinician will review with you directly to talk through what's still possible and the best next step.";
}

/**
 * Records a fast-track emergency contraception request (spec §47.8).
 * Written under the patient's own session (RLS already permits their own
 * patient_id/organisation_id with status='pending') — the DB's own
 * ec_requests_raise_alert trigger raises the 1-hour-SLA clinician alert on
 * insert, so nothing further is needed here for the care team to be
 * notified.
 */
export async function requestEmergencyContraception(
  _prevState: RequestEmergencyContraceptionState,
  formData: FormData
): Promise<RequestEmergencyContraceptionState> {
  const parsed = ecRequestSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Something didn't look right — please try again" };
  }

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

  const hours = parsed.data.hours_since_intercourse ?? null;
  const guidance = computeEcGuidance(hours);

  const { error: insertError } = await supabase.from("emergency_contraception_requests").insert({
    organisation_id: profile.organisation_id,
    patient_id: user.id,
    hours_since_intercourse: hours,
    guidance_shown: guidance,
    status: "pending",
  });
  if (insertError) return { error: insertError.message };

  return { success: true, guidance };
}
