"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

export type AttestationActionResult = { error?: string; success?: boolean; message?: string };

const attestSchema = z.object({
  requestId: z.string().uuid(),
  statement: z.string().trim().max(2000).optional(),
});

const declineSchema = z.object({
  requestId: z.string().uuid(),
  reason: z.string().trim().min(3).max(2000),
});

/**
 * Put a doctor's name and registration number to a patient's whole record.
 *
 * Both gates live in `attest_health_passport_request` — Tier 2+ (or Clinical
 * Director), and a registration authority and number on the doctor's own staff
 * record. This action deliberately re-raises the database's own message rather
 * than translating it: "you need a registration number on your staff record"
 * tells a doctor exactly what to fix, where a generic failure would send them to
 * support.
 */
export async function attestPassportRequest(input: {
  requestId: string;
  statement?: string;
}): Promise<AttestationActionResult> {
  const parsed = attestSchema.safeParse(input);
  if (!parsed.success) return { error: "That request reference is not valid." };

  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("attest_health_passport_request", {
    p_request_id: parsed.data.requestId,
    p_statement: parsed.data.statement || undefined,
  });
  if (error) return { error: error.message };

  revalidatePath("/clinician/passport-attestations");
  return {
    success: true,
    message:
      "Attested. The patient has been told, and their next Health Passport will carry your name and registration number.",
  };
}

export async function declinePassportRequest(input: {
  requestId: string;
  reason: string;
}): Promise<AttestationActionResult> {
  const parsed = declineSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Give a short reason. The patient is shown it." };
  }

  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("decline_health_passport_attestation", {
    p_request_id: parsed.data.requestId,
    p_reason: parsed.data.reason,
  });
  if (error) return { error: error.message };

  revalidatePath("/clinician/passport-attestations");
  return { success: true, message: "Declined, and the patient has been told why." };
}
