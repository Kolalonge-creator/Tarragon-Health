"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { issueHealthPassport } from "./issue";

export type PassportActionResult = { error?: string; success?: boolean; message?: string };

const issueSchema = z.object({
  attestationRequestId: z.string().uuid().nullable(),
});

const requestSchema = z.object({
  purpose: z.string().trim().min(3).max(200),
  note: z.string().trim().max(2000).optional().nullable(),
});

const revokeSchema = z.object({
  issuanceId: z.string().uuid(),
  reason: z.string().trim().max(500).optional().nullable(),
});

async function patientContext() {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id, role, receives_care")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id || profile.role !== "patient" || !profile.receives_care) {
    return null;
  }
  return { supabase, userId: user.id, organisationId: profile.organisation_id };
}

/**
 * Issue a new passport, deliberately.
 *
 * Separate from downloading on purpose. A download re-renders whatever the
 * patient already holds; this action replaces it, which supersedes the copy that
 * may already be sitting in an embassy's file. That consequence belongs behind a
 * decision the patient makes knowingly, not behind a button they press to get a
 * second copy of the same thing.
 */
export async function issuePassportAction(
  attestationRequestId: string | null = null
): Promise<PassportActionResult> {
  const parsed = issueSchema.safeParse({ attestationRequestId });
  if (!parsed.success) return { error: "That attestation reference is not valid." };

  const context = await patientContext();
  if (!context) return { error: "Not signed in as a patient receiving care." };

  const result = await issueHealthPassport(
    context.supabase,
    context.userId,
    context.organisationId,
    { attestationRequestId: parsed.data.attestationRequestId }
  );

  if (!result.ok) {
    if (result.reason === "not_configured") {
      // Honest, and specifically not "something went wrong": nothing the patient
      // did caused this and nothing they can do will fix it.
      return {
        error:
          "Verified passports are not switched on for this environment yet. You can still download your health summary. It just cannot be verified by a third party.",
      };
    }
    return { error: result.message };
  }

  revalidatePath("/patient/health-passport");
  return {
    success: true,
    message: `Passport ${result.issuance.serial} issued. Any passport you issued before this one now shows as replaced.`,
  };
}

/**
 * Withdraw a passport.
 *
 * The control that makes it safe to hand the document to anybody. Once revoked,
 * the verification page reports it as withdrawn on the very next check, wherever
 * the PDF has got to.
 */
export async function revokePassportAction(
  issuanceId: string,
  reason?: string | null
): Promise<PassportActionResult> {
  const parsed = revokeSchema.safeParse({ issuanceId, reason });
  if (!parsed.success) return { error: "That passport reference is not valid." };

  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_health_passport", {
    p_issuance_id: parsed.data.issuanceId,
    p_reason: parsed.data.reason ?? undefined,
  });
  if (error) return { error: error.message };

  revalidatePath("/patient/health-passport");
  return {
    success: true,
    message:
      "Withdrawn. Anyone who checks that document from now on will be told it has been withdrawn.",
  };
}

export async function requestAttestationAction(
  purpose: string,
  note?: string | null
): Promise<PassportActionResult> {
  const parsed = requestSchema.safeParse({ purpose, note });
  if (!parsed.success) {
    return { error: "Tell us in a few words what the attested passport is for." };
  }

  const context = await patientContext();
  if (!context) return { error: "Not signed in as a patient receiving care." };

  const { error } = await context.supabase.rpc("request_health_passport_attestation", {
    p_purpose: parsed.data.purpose,
    p_note: parsed.data.note ?? undefined,
  });
  if (error) {
    // The unique partial index on pending requests is doing its job, not failing.
    if (error.code === "23505") {
      return { error: "You already have an attestation request waiting with the care team." };
    }
    return { error: error.message };
  }

  revalidatePath("/patient/health-passport");
  return {
    success: true,
    message:
      "Sent to your care team. A doctor will review your record and you will be told as soon as it is ready.",
  };
}

export async function withdrawAttestationAction(requestId: string): Promise<PassportActionResult> {
  if (!z.string().uuid().safeParse(requestId).success) {
    return { error: "That request reference is not valid." };
  }
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_health_passport_attestation", {
    p_request_id: requestId,
  });
  if (error) return { error: error.message };

  revalidatePath("/patient/health-passport");
  return { success: true, message: "Request withdrawn." };
}
