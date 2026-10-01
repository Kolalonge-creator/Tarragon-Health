"use server";

import { ROUTINE_CHART_READ_REASON } from "@/lib/clinical/audited-chart";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@tarragon/shared";

const referralIdSchema = z.string().uuid();

export type AssembleClinicalSummaryState = { error?: string; success?: boolean } | undefined;

/** Last N vitals readings surfaced in the assembled summary — enough for a specialist to see a trend, not the full record. */
const RECENT_VITALS_LIMIT = 5;

/**
 * Assembles a point-in-time clinical summary (recent vitals, active
 * medications, the triggering screening result) and attaches it to the
 * referral. Runs server-side, on the referral's own patient_id, so the
 * snapshot always reflects the patient's real record — never a
 * client-supplied payload. Re-running this action overwrites the previous
 * snapshot; specialist_referrals.set_by/assembled_at record who/when.
 */
export async function assembleAndSaveClinicalSummary(
  referralId: string
): Promise<AssembleClinicalSummaryState> {
  const parsedId = referralIdSchema.safeParse(referralId);
  if (!parsedId.success) {
    return { error: "Invalid referral" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  // INV-10 / INV-12: the audited read is the gate (tied, creator, assigned specialist or the referral desk).
  const { data: referralPayload } = await supabase.rpc("get_referral_audited", {
    p_referral: parsedId.data,
    p_reason: ROUTINE_CHART_READ_REASON,
  });
  const payload = referralPayload as {
    status?: string;
    referral?: {
      id: string;
      patient_id: string;
      referral_reason: string | null;
      screening_result: unknown;
    };
  } | null;
  if (payload?.status !== "ok" || !payload.referral) {
    return { error: "Referral not found or not available to you" };
  }
  const referral = {
    id: payload.referral.id,
    patient_id: payload.referral.patient_id,
    clinical_question: payload.referral.referral_reason,
    screening_result: payload.referral.screening_result,
  };

  const [{ data: vitals }, { data: medications }] = await Promise.all([
    supabase
      .from("vitals_readings")
      .select("vital_type, systolic, diastolic, glucose_mmol_l, pulse_bpm, weight_kg, spo2_pct, taken_at")
      .eq("patient_id", referral.patient_id)
      .order("taken_at", { ascending: false })
      .limit(RECENT_VITALS_LIMIT),
    supabase
      .from("medications")
      .select("drug_name, dose, frequency")
      .eq("patient_id", referral.patient_id)
      .eq("is_active", true),
  ]);

  const clinicalSummary = {
    vitals: vitals ?? [],
    medications: medications ?? [],
    triggering_result: referral.screening_result ?? null,
    clinical_question: referral.clinical_question,
    assembled_at: new Date().toISOString(),
  };

  const { error } = await supabase.rpc("set_referral_clinical_summary", {
    p_referral: parsedId.data,
    p_summary: clinicalSummary as unknown as Json,
  });
  if (error) {
    return { error: error.message };
  }

  return { success: true };
}
