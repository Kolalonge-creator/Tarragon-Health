import { z } from "zod";
import { CIRCLE_PERMISSIONS } from "./model";

/**
 * The Care Circle join link and what may be said about it (supporter join path, 2026-11-03).
 *
 * The link a patient shares is /patient/supporting/join/<token>. The token is 32 random bytes in URL-safe base64 with the padding
 * removed (public.create_care_circle_invite), so the only characters it can hold are A-Z, a-z, 0-9, "-" and "_". Anything else is
 * not one of our links, so it is never used as a destination.
 */
export const JOIN_PATH_PREFIX = "/patient/supporting/join/";
const TOKEN = /^[A-Za-z0-9_-]{20,128}$/;

export function isJoinToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN.test(token);
}

export function joinPath(token: string): string {
  return `${JOIN_PATH_PREFIX}${token}`;
}

/** The signed-out landing for the same link. Outside /patient so a person with no account can open it. */
export function joinLandingPath(token: string): string {
  return `/circle/join/${token}`;
}

/**
 * A redirect that may be carried through sign-up and onboarding: a same-origin path to a join link and nothing else. No scheme, no
 * host, no query, no fragment, no encoded characters, no "..": the prefix followed by a token, exactly.
 */
export function safeJoinRedirect(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.startsWith(JOIN_PATH_PREFIX)) return null;
  const token = raw.slice(JOIN_PATH_PREFIX.length);
  return isJoinToken(token) ? raw : null;
}

const permission = z.enum(CIRCLE_PERMISSIONS);

/** The signed-out landing: the inviter's first name, what will be shared, and how the invite was sent. Nothing else exists to read. */
export const inviteLandingSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    inviter_first_name: z.string().min(1).max(80),
    permissions: z.array(z.string()).transform((list) => list.flatMap((p) => (permission.safeParse(p).success ? [p as z.infer<typeof permission>] : []))),
    contact_kind: z.enum(["email", "phone"]),
    contact_hint: z.string().max(40),
  }),
  z.object({ ok: z.literal(false) }),
]);
export type InviteLanding = z.infer<typeof inviteLandingSchema> | { ok: false; rate_limited: true };

export function parseInviteLanding(data: unknown): z.infer<typeof inviteLandingSchema> {
  const r = inviteLandingSchema.safeParse(data);
  return r.success ? r.data : { ok: false };
}

export const INVITE_STATUS_REASONS = [
  "wrong_contact",
  "expired",
  "no_longer_valid",
  "already_member",
  "own_invite",
  "needs_supporter_account",
  "not_found",
  "not_available",
] as const;
export type InviteStatusReason = (typeof INVITE_STATUS_REASONS)[number];

export const inviteStatusSchema = z.object({
  reason: z.enum(INVITE_STATUS_REASONS).catch("not_available"),
  contact_kind: z.enum(["email", "phone"]).optional().catch(undefined),
  contact_hint: z.string().max(40).optional().catch(undefined),
  patient_id: z.string().uuid().optional().catch(undefined),
});
export type InviteStatus = z.infer<typeof inviteStatusSchema>;

export function parseInviteStatus(data: unknown): InviteStatus {
  const r = inviteStatusSchema.safeParse(data);
  return r.success ? r.data : { reason: "not_available" };
}
