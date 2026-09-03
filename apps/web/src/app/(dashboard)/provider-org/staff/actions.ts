"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type ActionState = { error?: string; message?: string } | undefined;

const inviteSchema = z.object({
  organisationId: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string().trim().min(1).max(200),
  password: z.string().min(8).max(72),
  orgRole: z.enum([
    "owner", "clinical_lead", "operations_manager", "finance_manager", "hr_admin", "clinician", "receptionist",
  ]),
  jobTitle: z.string().trim().max(200).optional(),
});

/** Mirrors invitePayerAdminAction — see its comment for the full trust model. */
export async function inviteProviderOrgStaffAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await getCurrentProfile();
  if (!actor) return { error: "Not signed in" };

  const parsed = inviteSchema.safeParse({
    organisationId: formData.get("organisationId"),
    email: formData.get("email"),
    fullName: formData.get("fullName"),
    password: formData.get("password"),
    orgRole: formData.get("orgRole"),
    jobTitle: formData.get("jobTitle") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const input = parsed.data;

  const svc = createServiceRoleClient();
  const { data: created, error: createError } = await svc.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    app_metadata: { role: "provider_org_staff", organisation_id: null },
    user_metadata: { full_name: input.fullName },
  });
  if (createError || !created.user) {
    return { error: createError?.message ?? "Could not create the login" };
  }

  const supabase = await createClient();
  const { error: seatError } = await supabase.from("provider_org_members").insert({
    organisation_id: input.organisationId,
    profile_id: created.user.id,
    org_role: input.orgRole,
    job_title: input.jobTitle ?? null,
    invited_by: actor.id,
  });
  if (seatError) return { error: seatError.message };

  revalidatePath("/provider-org/staff");
  return { message: `${input.fullName} added.` };
}

const removeSchema = z.object({ seatId: z.string().uuid() });

export async function deactivateProviderOrgSeatAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = removeSchema.safeParse({ seatId: formData.get("seatId") });
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("provider_org_members")
    .update({ is_active: false })
    .eq("id", parsed.data.seatId);
  if (error) return { error: error.message };

  revalidatePath("/provider-org/staff");
  return { message: "Seat deactivated." };
}
