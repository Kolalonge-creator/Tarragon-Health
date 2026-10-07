import { z } from "zod";
import type { MessageKey } from "@tarragon/i18n";

/**
 * What the community screens read from the database (S69). Every reply is parsed, never trusted: a shape that does not match is "nothing
 * to show". There is deliberately NO schema here for an individual's figure: the challenge view the database sends has a closed key set
 * (label, dates, phase, one availability flag, the cohort's own published total), so a screen built on it cannot show one.
 */
export const COHORT_KINDS = ["church", "mosque", "union", "estate", "workplace"] as const;
export type CohortKind = (typeof COHORT_KINDS)[number];

export const cohortSchema = z.object({
  cohort_id: z.string(),
  name: z.string(),
  kind: z.enum(COHORT_KINDS),
  state: z.enum(["active", "closed", "frozen"]),
  is_moderator: z.boolean(),
  muted: z.boolean(),
  contributing: z.boolean(),
});
export type Cohort = z.infer<typeof cohortSchema>;

export const myCohortsSchema = z.object({ open: z.boolean(), off: z.boolean(), cohorts: z.array(cohortSchema) });
export type MyCohorts = z.infer<typeof myCohortsSchema>;
export function parseMyCohorts(data: unknown): MyCohorts {
  const r = myCohortsSchema.safeParse(data);
  return r.success ? r.data : { open: false, off: false, cohorts: [] };
}

const totalSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("pending") }),
  z.object({ state: z.literal("hidden") }),
  z.object({
    state: z.literal("shown"),
    total: z.number(),
    progress_pct: z.number(),
    goal_reached: z.boolean(),
    group_size: z.string(),
    as_of: z.string(),
    final: z.boolean(),
  }),
]);
export type ChallengeTotal = z.infer<typeof totalSchema>;

export const challengeSchema = z.object({
  challenge_id: z.string(),
  label: z.string(),
  unit: z.enum(["days", "lessons", "minutes"]),
  starts_on: z.string(),
  ends_on: z.string(),
  phase: z.enum(["scheduled", "active", "ended", "cancelled"]),
  available: z.boolean(),
  contributing: z.boolean(),
  total: totalSchema,
});
export type Challenge = z.infer<typeof challengeSchema>;
export function parseChallenges(data: unknown): Challenge[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const r = challengeSchema.safeParse(row);
    return r.success ? [r.data] : [];
  });
}

export const rosterRowSchema = z.object({ member_id: z.string(), first_name: z.string(), role: z.enum(["member", "moderator"]), is_you: z.boolean() });
export type RosterRow = z.infer<typeof rosterRowSchema>;
export function parseRoster(data: unknown): RosterRow[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const r = rosterRowSchema.safeParse(row);
    return r.success ? [r.data] : [];
  });
}

export const boardSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("hidden") }),
  z.object({ state: z.literal("not_ready") }),
  z.object({
    state: z.literal("shown"),
    rows: z.array(z.object({ label: z.string(), rank: z.number(), progress_pct: z.number(), is_yours: z.boolean() })),
  }),
]);
export type Board = z.infer<typeof boardSchema>;
export function parseBoard(data: unknown): Board {
  const r = boardSchema.safeParse(data);
  return r.success ? r.data : { state: "hidden" };
}

export const templateSchema = z.object({
  code: z.string(),
  label: z.string(),
  description: z.string(),
  unit: z.enum(["days", "lessons", "minutes"]),
  default_days: z.number(),
  target_per_member: z.number(),
});
export type ChallengeTemplate = z.infer<typeof templateSchema>;
export function parseTemplates(data: unknown): ChallengeTemplate[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const r = templateSchema.safeParse(row);
    return r.success ? [r.data] : [];
  });
}

export const modReportSchema = z.object({ report_id: z.string(), member_id: z.string(), reason: z.string(), created_on: z.string() });
export type ModReport = z.infer<typeof modReportSchema>;
export function parseModReports(data: unknown): ModReport[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const r = modReportSchema.safeParse(row);
    return r.success ? [r.data] : [];
  });
}

export const previewSchema = z.discriminatedUnion("ok", [z.object({ ok: z.literal(false) }), z.object({ ok: z.literal(true), name: z.string(), kind: z.enum(COHORT_KINDS) })]);
export function parsePreview(data: unknown): z.infer<typeof previewSchema> {
  const r = previewSchema.safeParse(data);
  return r.success ? r.data : { ok: false };
}

export const inviteMadeSchema = z.object({ token: z.string().min(20), expires_at: z.string() });
export const okSchema = z.object({ ok: z.boolean(), reason: z.string().optional(), capped: z.boolean().optional(), cohort_id: z.string().optional() });
export function parseOk(data: unknown): z.infer<typeof okSchema> {
  const r = okSchema.safeParse(data);
  return r.success ? r.data : { ok: false };
}

export const REPORT_REASONS = ["concerning_behaviour", "unwanted_contact", "pressure_to_share", "something_else"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_REASON_KEYS: Readonly<Record<ReportReason, MessageKey>> = {
  concerning_behaviour: "community.report.reason.concerning_behaviour",
  unwanted_contact: "community.report.reason.unwanted_contact",
  pressure_to_share: "community.report.reason.pressure_to_share",
  something_else: "community.report.reason.something_else",
};
export const KIND_KEYS: Readonly<Record<CohortKind, MessageKey>> = {
  church: "community.kind.church",
  mosque: "community.kind.mosque",
  union: "community.kind.union",
  estate: "community.kind.estate",
  workplace: "community.kind.workplace",
};
export const UNIT_KEYS: Readonly<Record<"days" | "lessons" | "minutes", MessageKey>> = {
  days: "community.unit.days",
  lessons: "community.unit.lessons",
  minutes: "community.unit.minutes",
};

const ERROR_KEYS: Readonly<Record<string, MessageKey>> = {
  community_closed: "community.error.closed",
  community_off: "community.error.community_off",
  consent_required: "community.error.consent_required",
  cohort_name_not_allowed: "community.error.cohort_name_not_allowed",
  too_many_cohorts: "community.error.too_many_cohorts",
  too_many_challenges: "community.error.too_many_challenges",
  template_not_approved: "community.error.template_not_approved",
  challenge_dates_invalid: "community.error.challenge_dates_invalid",
  invite_rate_limited: "community.error.invite_rate_limited",
  cohort_full: "community.error.cohort_full",
  minutes_invalid: "community.error.minutes_invalid",
  community_not_authorised: "community.error.not_authorised",
};
/** The i18n key for a database refusal. The database raises a bare code; anything unrecognised is the generic message. */
export function communityErrorKey(message: unknown): MessageKey {
  if (typeof message !== "string") return "community.error.unknown";
  const hit = Object.keys(ERROR_KEYS).find((code) => message.includes(code));
  return (hit ? ERROR_KEYS[hit] : undefined) ?? "community.error.unknown";
}

/** The link a moderator shares. The token is in the path (so it survives the sign-in redirect) and nowhere else. No WhatsApp link is built: the OS share sheet is the only way out. */
export function communityJoinPath(token: string): string {
  return `/patient/community/join/${encodeURIComponent(token)}`;
}
