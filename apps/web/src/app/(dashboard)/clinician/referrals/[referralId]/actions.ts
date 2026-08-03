"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@tarragon/shared";

const referralIdSchema = z.string().uuid();

export type AssembleClinicalSummaryState = { error?: string; success?: boolean } | undefined;

/** Last N vitals readings surfaced in the assembled summary — enough for a specialist to see a trend, not a full chart. */
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

  // RLS (private.is_org_staff) is the real gate here — an out-of-org
  // referral simply doesn't come back, same as the escalation detail page.
  const { data: referral } = await supabase
    .from("specialist_referrals")
    .select(
      "id, patient_id, clinical_question:referral_reason, screening_upgrade:screening_upgrades!specialist_referrals_screening_upgrade_id_fkey(screening_result:screening_results!screening_upgrades_screening_result_id_fkey(id, result_status, result_summary, abnormal_flags, created_at))"
    )
    .eq("id", parsedId.data)
    .maybeSingle();
  if (!referral) {
    return { error: "Referral not found or not in your organisation" };
  }

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
    triggering_result: referral.screening_upgrade?.screening_result ?? null,
    clinical_question: referral.clinical_question,
    assembled_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("specialist_referrals")
    .update({
      clinical_summary: clinicalSummary as unknown as Json,
      set_by: user.id,
    })
    .eq("id", parsedId.data);
  if (error) {
    return { error: error.message };
  }

  return { success: true };
}
