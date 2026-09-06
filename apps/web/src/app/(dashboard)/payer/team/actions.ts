"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type ActionState = { error?: string; message?: string } | undefined;

const inviteSchema = z.object({
  insurerId: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string().trim().min(1).max(200),
  password: z.string().min(8).max(72),
  payerRole: z.enum(["owner", "benefits_manager", "authorisation_officer", "claims_officer", "analyst"]),
  jobTitle: z.string().trim().max(200).optional(),
});

/**
 * Mirrors invitePartnerStaffAction (lib/partner-admin) — a Tarragon
 * insurance admin, or an existing 'owner' seat-holder at this insurer,
 * creates a new payer_admin login and links it as a payer_administrators
 * seat in the same request. RLS on payer_administrators
 * (payer_administrators_manage) re-checks the caller is authorised for
 * THIS insurer before the insert lands, so this action cannot be used to
 * seed a seat at an insurer the caller doesn't already administer.
 */
export async function invitePayerAdminAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await getCurrentProfile();
  if (!actor) return { error: "Not signed in" };

  const parsed = inviteSchema.safeParse({
    insurerId: formData.get("insurerId"),
    email: formData.get("email"),
    fullName: formData.get("fullName"),
    password: formData.get("password"),
    payerRole: formData.get("payerRole"),
    jobTitle: formData.get("jobTitle") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const input = parsed.data;

  const svc = createServiceRoleClient();
  const { data: created, error: createError } = await svc.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    app_metadata: { role: "payer_admin", organisation_id: null },
    user_metadata: { full_name: input.fullName },
  });
  if (createError || !created.user) {
    return { error: createError?.message ?? "Could not create the login" };
  }

  // Insert through the CALLER's own RLS-scoped client, not the service role
  // — payer_administrators_manage is the real authorisation check (is this
  // caller an owner/insurance admin for THIS insurer), and a role guard
  // trigger on the table separately confirms the new login really is
  // payer_admin. If either refuses, the auth user above still exists but
  // administers nothing, same trust posture as every other invite flow here.
  const supabase = await createClient();
  const { error: seatError } = await supabase.from("payer_administrators").insert({
    insurer_id: input.insurerId,
    profile_id: created.user.id,
    payer_role: input.payerRole,
    job_title: input.jobTitle ?? null,
    invited_by: actor.id,
  });
  if (seatError) return { error: seatError.message };

  revalidatePath("/payer/team");
  return { message: `${input.fullName} added.` };
}

const removeSchema = z.object({ seatId: z.string().uuid() });

export async function deactivatePayerSeatAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = removeSchema.safeParse({ seatId: formData.get("seatId") });
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("payer_administrators")
    .update({ is_active: false })
    .eq("id", parsed.data.seatId);
  if (error) return { error: error.message };

  revalidatePath("/payer/team");
  return { message: "Seat deactivated." };
}
