"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type CompleteHealthCheckState = { error?: string; success?: boolean } | undefined;

const schema = z.object({
  summary: z.string().trim().min(1, "Add a short summary of the check").max(2000),
});

/**
 * The doctor "Review & communicate" step of the Health Check (AHC pathway §5
 * stage 4): a clinician reviews the year's check and closes it, stamping
 * null-gated attribution (reviewed_by = their own clinical_staff row,
 * server-derived — never client-supplied).
 *
 * Gated on a current red-flag attestation (AHC §26): a doctor delivers checks
 * only after signing. App-layer gate, mirroring the Care-Coordinator /
 * protocol-signing pattern — reads the append-only clinical_staff_attestations.
 */
export async function completeHealthCheckReview(
  patientId: string,
  _prevState: CompleteHealthCheckState,
  formData: FormData
): Promise<CompleteHealthCheckState> {
  const parsed = schema.safeParse({ summary: formData.get("summary") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

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
  if (!staff) {
    return { error: "Only an active Tarragon care-team doctor can complete a health check" };
  }

  // Red-flag attestation gate (§26).
  const { data: attestation } = await supabase
    .from("clinical_staff_attestations")
    .select("id")
    .eq("clinical_staff_id", staff.id)
    .gt("expires_at", new Date().toISOString())
    .limit(1)
    .maybeSingle();
  if (!attestation) {
    return {
      error:
        "Sign your annual red-flag attestation (on your dashboard) before completing a health check.",
    };
  }

  const year = new Date().getFullYear();
  const { data: existing } = await supabase
    .from("annual_health_checks")
    .select("id")
    .eq("patient_id", patientId)
    .eq("year", year)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("annual_health_checks")
      .update({
        status: "completed",
        reviewed_by: staff.id,
        reviewed_at: new Date().toISOString(),
        review_summary: parsed.data.summary,
      })
      .eq("id", existing.id);
    if (error) return { error: error.message };
  } else {
    const { data: patient } = await supabase
      .from("profiles")
      .select("organisation_id")
      .eq("id", patientId)
      .maybeSingle();
    if (!patient?.organisation_id) return { error: "Patient not found" };
    const { error } = await supabase.from("annual_health_checks").insert({
      organisation_id: patient.organisation_id,
      patient_id: patientId,
      year,
      status: "completed",
      reviewed_by: staff.id,
      reviewed_at: new Date().toISOString(),
      review_summary: parsed.data.summary,
    });
    if (error) return { error: error.message };
  }

  return { success: true };
}

export type ProposeHealthCheckConsultState = { error: string } | { success: true } | undefined;

const proposeConsultSchema = z.object({
  consultId: z.string().uuid(),
  // 1-3 ISO datetimes the clinician offers the patient.
  slots: z.array(z.string().datetime()).min(1).max(3),
});

/**
 * Clinician offers 1-3 candidate video-consult times for the Health Check's
 * bundled consult (every Screen tier since 20260829140114_health_check_video
 * _consult_all_tiers.sql — previously Comprehensive Screen only). The row
 * already exists (created by private.handle_screen_tier_resulted when the
 * Screen order resulted and linked via annual_health_checks.
 * video_consultation_id); this is a plain update, not an insert, since
 * unlike the retired annual-reviews page there is no separate orchestration
 * row to point at it. RLS (private.is_org_staff, video_consultations_update)
 * is the real gate — this active-clinical-staff check mirrors
 * completeHealthCheckReview above for a consistent error message.
 */
export async function proposeHealthCheckVideoConsultSlots(
  consultId: string,
  slots: string[]
): Promise<ProposeHealthCheckConsultState> {
  const parsed = proposeConsultSchema.safeParse({ consultId, slots });
  if (!parsed.success) {
    return { error: "Pick 1–3 valid times." };
  }

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
  if (!staff) {
    return { error: "Only an active Tarragon care-team doctor can offer consult times" };
  }

  const { error } = await supabase
    .from("video_consultations")
    .update({ proposed_slots: parsed.data.slots })
    .eq("id", parsed.data.consultId)
    .eq("context", "annual_review")
    .is("scheduled_at", null);
  if (error) return { error: error.message };

  return { success: true };
}
