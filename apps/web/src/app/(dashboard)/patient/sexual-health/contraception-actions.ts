"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type RequestContraceptionState = { error?: string; success?: boolean } | undefined;

const requestSchema = z.object({
  method_code: z.string().trim().min(1, "Choose a method"),
});

/**
 * Records a patient's own request for a contraception method (spec §47.7).
 * Written under the patient's own session (createClient(), not the service
 * role) — contraception_plans_insert already restricts this to the caller's
 * own patient_id/organisation_id with status='requested' and prescribed_by
 * null, so there is nothing here a client could forge; a clinician later
 * reviews and, via a separate staff-side action, moves status to 'active'
 * (which the enforce_contraception_plan_update trigger stamps with the real
 * prescribing clinical_staff row, never client-supplied).
 * Zod only checks non-empty — an invalid method_code is rejected by the
 * method_code foreign key, not re-validated here.
 */
export async function requestContraceptionMethod(
  _prevState: RequestContraceptionState,
  formData: FormData
): Promise<RequestContraceptionState> {
  const parsed = requestSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Choose a method" };
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

  const { error: insertError } = await supabase.from("contraception_plans").insert({
    organisation_id: profile.organisation_id,
    patient_id: user.id,
    method_code: parsed.data.method_code,
    status: "requested",
  });
  if (insertError) return { error: insertError.message };

  return { success: true };
}
