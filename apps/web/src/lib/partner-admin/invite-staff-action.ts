"use server";

import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type InviteStaffState = { error?: string; message?: string } | undefined;

const invitePartnerStaffSchema = z.object({
  email: z.string().email(),
  fullName: z.string().trim().min(1, "Full name is required").max(200),
  phone: z
    .string()
    .regex(/^\+[1-9][0-9]{7,14}$/, "Use E.164 format, e.g. +2348012345678")
    .optional()
    .or(z.literal("")),
  password: z.string().min(8, "At least 8 characters").max(72),
});

/**
 * Self-service staff invite for a partner org's own admin — the capability
 * profiles.is_partner_admin exists for (docs/CLINICAL_NETWORK_SPEC.md §4.14
 * "organisation admins manage staff"). Deliberately narrower than
 * provisionMemberAction (admin/settings/members/actions.ts), which this
 * mirrors the shape of: a partner admin can only create a login of their
 * OWN role (lab_partner invites lab_partner, pharmacist invites pharmacist),
 * linked to their OWN provider — never client-supplied, always read from the
 * caller's own, freshly-fetched profile row, never from form input. The new
 * login starts as NOT a partner admin itself; only a Tarragon admin can
 * promote it further (admin_set_partner_admin), same "don't let an invite
 * chain silently mint more admins" discipline as everywhere else privilege
 * is involved on this platform.
 */
export async function invitePartnerStaffAction(
  _prev: InviteStaffState,
  formData: FormData
): Promise<InviteStaffState> {
  const actor = await getCurrentProfile();
  if (!actor) return { error: "Not signed in" };
  if (!actor.is_partner_admin) return { error: "You don't have access to do that" };
  if (actor.role !== "lab_partner" && actor.role !== "pharmacist") {
    return { error: "You don't have access to do that" };
  }

  const providerId = actor.role === "lab_partner" ? actor.lab_provider_id : actor.pharmacy_partner_id;
  if (!providerId) {
    return { error: "Your own login isn't linked to a provider yet — contact Tarragon support." };
  }

  const parsed = invitePartnerStaffSchema.safeParse({
    email: formData.get("email"),
    fullName: formData.get("fullName"),
    phone: formData.get("phone") || undefined,
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
  }
  const input = parsed.data;

  const svc = createServiceRoleClient();
  const { data, error } = await svc.auth.admin.createUser({
    email: input.email,
    password: input.password,
    phone: input.phone || undefined,
    email_confirm: true,
    app_metadata: { role: actor.role, organisation_id: null },
    user_metadata: { full_name: input.fullName },
  });
  if (error || !data.user) {
    return { error: error?.message ?? "Could not create the login" };
  }

  // Link to the INVITER's own provider — service role bypasses RLS, but this
  // never accepts a provider id from the client, only from the caller's own
  // just-fetched profile row above.
  const { error: linkError } =
    actor.role === "lab_partner"
      ? await svc.from("profiles").update({ lab_provider_id: providerId }).eq("id", data.user.id)
      : await svc.from("profiles").update({ pharmacy_partner_id: providerId }).eq("id", data.user.id);
  if (linkError) {
    return { error: `Login created but could not be linked: ${linkError.message}` };
  }

  await svc.from("audit_log").insert({
    actor_id: actor.id,
    organisation_id: null,
    action: "partner.staff_invited",
    entity_type: "profiles",
    entity_id: data.user.id,
    event: { role: actor.role, provider_id: providerId, invited_email: input.email },
  });

  return { message: `Login created for ${input.email}.` };
}
