import { z } from "zod";

/**
 * Hand-granted Membership (S22b, until the S25 checkout). Input schemas, the plain-words error mapping and the
 * parser for list_memberships. No server-only imports so actions, pages and tests share one definition.
 * INV-09: nothing here carries a price or an amount; a membership is a dated entitlement.
 */

export const MEMBERS_BASE_PATHS = ["/admin/memberships", "/clinician/memberships"] as const;
export type MembersBasePath = (typeof MEMBERS_BASE_PATHS)[number];

export const REASON_MIN = 10;
export const REASON_MAX = 1000;

const reasonSchema = z
  .string()
  .trim()
  .min(REASON_MIN, `Please give a reason of at least ${REASON_MIN} characters.`)
  .max(REASON_MAX, `Please keep the reason under ${REASON_MAX.toLocaleString("en-GB")} characters.`);

export const grantMembershipSchema = z.object({
  base: z.enum(MEMBERS_BASE_PATHS),
  patientId: z.string().uuid(),
  // An optional end date (yyyy-mm-dd). Empty means no end date.
  endsOn: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Please choose a valid end date.")
    .optional(),
  reason: reasonSchema,
});

export const endMembershipSchema = z.object({
  base: z.enum(MEMBERS_BASE_PATHS),
  patientId: z.string().uuid(),
  reason: reasonSchema,
});

/** The end of the chosen day in Lagos time (UTC+1, no daylight saving), as an ISO instant. */
export function endOfDayLagos(date: string): string {
  return new Date(`${date}T23:59:59+01:00`).toISOString();
}

export const searchParamSchema = z.string().trim().max(100);

const ERROR_WORDS: Record<string, string> = {
  membership_not_authorised: "You do not have access to manage memberships.",
  membership_reason_needed: `Please give a reason of at least ${REASON_MIN} characters.`,
  membership_end_in_past: "The end date must be in the future.",
  membership_already_active: "This person already has an active membership. End it first if you need to change it.",
  membership_none_active: "This person has no active membership to end.",
};

export function describeMembershipError(
  error: { message?: string | null; code?: string | null } | null | undefined,
  fallback = "Something went wrong. Please try again.",
): string {
  const message = error?.message ?? "";
  for (const key of Object.keys(ERROR_WORDS)) {
    if (message.includes(key)) return ERROR_WORDS[key] as string;
  }
  if (message.includes("unknown patient")) return "That patient could not be found.";
  if (error?.code === "42501") return "You do not have access to manage memberships.";
  return fallback;
}

export const membershipRowSchema = z.object({
  patient_id: z.string().uuid(),
  full_name: z.string().nullable(),
  patient_number: z.string().nullable(),
  membership_id: z.string().uuid().nullable(),
  source: z.string().nullable(),
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
  grant_reason: z.string().nullable(),
  is_member: z.boolean(),
});
export type MembershipRow = z.infer<typeof membershipRowSchema>;
export const membershipRowsSchema = z.array(membershipRowSchema);

export const MEMBERSHIP_SOURCE_LABEL: Record<string, string> = {
  purchase: "Purchased",
  voucher: "Voucher",
  employer: "Employer",
  granted: "Granted by hand",
};
