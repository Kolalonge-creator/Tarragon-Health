"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { inviteToFundingProgramme, revokeFundingProgrammeInvitation, type InviteContact } from "@/lib/ngo/funding-programmes";

export type NgoActionState = { error?: string; message?: string } | undefined;

/**
 * Parses one "Full Name, +2348012345678" or "Full Name, name@example.com"
 * per line into InviteContact[]. Kept as a small, independently testable
 * function (see roster.test.ts) rather than inlined in the action, since a
 * roster paste is the one place a real person is most likely to make a
 * typo and needs a clear per-line error, not a generic Zod dump.
 */
// Mirrors the strictness of the RPC-side contactSchema's z.string().email()
// (funding-programmes.ts) so a malformed email is caught here, with a
// friendly per-line message, rather than reaching inviteToFundingProgramme's
// Zod parse and throwing a single raw error that aborts the whole batch --
// including every other, valid contact on the roster.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseRoster(raw: string): { contacts: InviteContact[]; errors: string[] } {
  const contacts: InviteContact[] = [];
  const errors: string[] = [];
  const lines = raw.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

  lines.forEach((line, i) => {
    const parts = line.split(",").map((p) => p.trim());
    const fullName = parts[0];
    const contact = parts[1] ?? "";
    if (!fullName) {
      errors.push(`Line ${i + 1}: missing a name`);
      return;
    }
    if (!contact) {
      errors.push(`Line ${i + 1} (${fullName}): missing a phone number or email`);
      return;
    }
    const isEmail = contact.includes("@");
    if (isEmail) {
      if (!EMAIL_PATTERN.test(contact)) {
        errors.push(`Line ${i + 1} (${fullName}): "${contact}" isn't a valid email address`);
        return;
      }
      contacts.push({ full_name: fullName, email: contact });
      return;
    }
    if (!/^\+[1-9]\d{7,14}$/.test(contact)) {
      errors.push(`Line ${i + 1} (${fullName}): phone must be E.164, e.g. +2348012345678`);
      return;
    }
    contacts.push({ full_name: fullName, phone: contact });
  });

  return { contacts, errors };
}

const inviteSchema = z.object({
  programmeId: z.string().uuid(),
  roster: z.string().trim().min(1, "Paste at least one person"),
});

/**
 * Thin wrapper over public.invite_to_funding_programme() -- the RPC is the
 * real authority (superadmin or the programme's own org's ngo_admin, cap
 * enforcement, active-programme-only). Parses the roster textarea into
 * contacts client-visibly (parseRoster above) so a typo on line 12 doesn't
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
