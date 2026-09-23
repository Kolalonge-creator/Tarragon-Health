import type { InviteContact } from "@/lib/ngo/funding-programmes";

/**
 * Parses one "Full Name, +2348012345678" or "Full Name, name@example.com"
 * per line into InviteContact[]. Kept as a small, independently testable
 * function (see parse-roster.test.ts) rather than inlined in the action,
 * since a roster paste is the one place a real person is most likely to
 * make a typo and needs a clear per-line error, not a generic Zod dump.
 *
 * Lives outside actions.ts (a "use server" file) because Next's Server
 * Actions convention requires every export of such a file to be an async
 * function -- this is a plain synchronous helper, not a server action.
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
