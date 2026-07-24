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
