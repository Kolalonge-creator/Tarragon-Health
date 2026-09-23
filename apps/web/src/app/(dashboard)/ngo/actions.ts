"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { inviteToFundingProgramme, revokeFundingProgrammeInvitation } from "@/lib/ngo/funding-programmes";
import { parseRoster } from "./parse-roster";

export type NgoActionState = { error?: string; message?: string } | undefined;

const inviteSchema = z.object({
  programmeId: z.string().uuid(),
  roster: z.string().trim().min(1, "Paste at least one person"),
});

/**
 * Thin wrapper over public.invite_to_funding_programme() -- the RPC is the
 * real authority (superadmin or the programme's own org's ngo_admin, cap
 * enforcement, active-programme-only). Parses the roster textarea into
 * contacts client-visibly (parseRoster, in ./parse-roster.ts) so a typo on line 12 doesn't
 * silently drop that one person from a 200-person batch invite.
 */
export async function inviteRosterAction(
  _prev: NgoActionState,
  formData: FormData
): Promise<NgoActionState> {
  const parsed = inviteSchema.safeParse({
    programmeId: formData.get("programmeId"),
    roster: formData.get("roster"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { contacts, errors } = parseRoster(parsed.data.roster);
  if (errors.length > 0) {
    return { error: errors.join("; ") };
  }
  if (contacts.length === 0) {
    return { error: "Paste at least one person, one per line: Full Name, +234..." };
  }

  const supabase = await createClient();
  try {
    const { invited } = await inviteToFundingProgramme(supabase, parsed.data.programmeId, contacts);
    revalidatePath("/ngo");
    return { message: `Invited ${invited} ${invited === 1 ? "person" : "people"}.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not send the invitations" };
  }
}

const revokeSchema = z.object({
  invitationId: z.string().uuid(),
  reason: z.string().trim().max(2000).optional(),
});

/** Thin wrapper over public.revoke_funding_programme_invitation(). */
export async function revokeInvitationAction(
  _prev: NgoActionState,
  formData: FormData
): Promise<NgoActionState> {
  const parsed = revokeSchema.safeParse({
    invitationId: formData.get("invitationId"),
    reason: formData.get("reason") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  try {
    await revokeFundingProgrammeInvitation(supabase, parsed.data.invitationId, parsed.data.reason);
    revalidatePath("/ngo");
    return { message: "Invitation revoked." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not revoke the invitation" };
  }
}
