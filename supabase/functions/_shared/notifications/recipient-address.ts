/**
 * Where an email goes (S19c, P1). Pure code, no Deno or Node globals, so the edge sender and the Jest tests read one definition.
 *
 * Page, on-call, credential and care-team notices are queued by database functions that know only the recipient's profile id,
 * not an address, so before this existed the sender failed them with "recipient has no email address" and a red event page
 * never reached an inbox. For these templates the address is the recipient's OWN verified sign-in address, looked up from
 * Auth by the recipient id. An address in the payload is ignored for them: a payload must never be able to redirect a page or
 * a patient notice to a third party. (security.* notices keep the older rule: an explicit payload address wins, otherwise the
 * verified Auth address.)
 */

/** Templates whose address is always the recipient's own verified sign-in address, whatever the payload says. */
export const OWN_ADDRESS_ONLY_TEMPLATES: ReadonlySet<string> = new Set([
  "on_call_page",
  "on_call_test_page",
  "on_call_escalation",
  "on_call_unfinished",
  "on_call_expired",
  "credential_notice",
  "care_team_notice",
]);

/**
 * Templates that are patient notices but have no row in notification_templates (so the sender cannot read their audience there).
 * Without this their email would skip the patient's quiet hours and discreet wording; with it they are treated as patient mail.
 */
export const AUDIENCE_OVERRIDES: Readonly<Record<string, string>> = { care_team_notice: "patient" };

export function audienceFor(template: string | null | undefined, fromDatabase: string | null | undefined): string | null | undefined {
  if (fromDatabase) return fromDatabase;
  return template != null ? AUDIENCE_OVERRIDES[template] ?? fromDatabase : fromDatabase;
}

export type AddressRule = "own_only" | "payload_then_own" | "payload_only";

export function addressRuleFor(template: string | null | undefined): AddressRule {
  if (template == null) return "payload_only";
  if (OWN_ADDRESS_ONLY_TEMPLATES.has(template)) return "own_only";
  if (template.startsWith("security.")) return "payload_then_own";
  return "payload_only";
}

/** The part of a Supabase Auth user the rule needs. */
export interface AuthEmailUser {
  readonly email?: string | null;
  readonly email_confirmed_at?: string | null;
}

/** The user's address, only when it is verified. An unverified address is never used. */
export function verifiedAddressOf(user: AuthEmailUser | null | undefined): string | undefined {
  if (!user?.email || !user.email_confirmed_at) return undefined;
  return user.email;
}

export interface ResolvedAddress {
  readonly address: string | undefined;
  /**
   * "auth" = looked up from the recipient's verified Auth address; "payload" = taken from the payload; "none" = there is no
   * usable address (unknown, unverified); "lookup_failed" = Auth could not be asked (error or timeout), which is NOT the same
   * thing: the caller retries it instead of giving up on the row.
   */
  readonly source: "auth" | "payload" | "none" | "lookup_failed";
}

/**
 * Pick the address for one email row. `lookupVerified` is only called when the rule needs Auth, so a routine email costs no
 * lookup. It returns undefined when the account has no verified address, and throws when Auth cannot be asked; the first ends
 * as "none" (the row fails visibly), the second as "lookup_failed" (the row is retried). An address is never taken from
 * anywhere else for a template that must use the recipient's own.
 */
export async function resolveEmailAddress(
  template: string | null | undefined,
  payloadToEmail: unknown,
  lookupVerified: () => Promise<string | undefined>,
): Promise<ResolvedAddress> {
  const rule = addressRuleFor(template);
  const fromPayload = typeof payloadToEmail === "string" && payloadToEmail.length > 0 ? payloadToEmail : undefined;
  if (rule === "payload_only") return fromPayload ? { address: fromPayload, source: "payload" } : { address: undefined, source: "none" };
  if (rule === "payload_then_own" && fromPayload) return { address: fromPayload, source: "payload" };
  let verified: string | undefined;
  try {
    verified = await lookupVerified();
  } catch {
    return { address: undefined, source: "lookup_failed" };
  }
  return verified ? { address: verified, source: "auth" } : { address: undefined, source: "none" };
}
