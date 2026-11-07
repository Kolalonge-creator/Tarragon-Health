import { z } from "zod";

/**
 * The superadmin homepage's reporting period and figures (docs/design/SUPERADMIN-CONSOLE.md, phase 2b), read from
 * public.analytics_platform_overview. No server-only imports, so the page and its tests share one definition.
 */

export const PERIOD_KEYS = ["today", "7d", "30d", "90d", "ytd"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export const PERIOD_LABEL: Record<PeriodKey, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  ytd: "Year to date",
};

/** How the comparison window is named in a sentence ("than the previous 30 days"). */
const PREVIOUS_LABEL: Record<PeriodKey, string> = {
  today: "the same number of hours before midnight",
  "7d": "the 7 days before",
  "30d": "the 30 days before",
  "90d": "the 90 days before",
  ytd: "the same length of time before 1 January",
};

export interface ResolvedPeriod {
  key: PeriodKey;
  label: string;
  previousLabel: string;
  from: Date;
  to: Date;
}

const DAY_MS = 86_400_000;
/** Lagos is UTC+1 all year (no daylight saving), so its midnight is 23:00 UTC the day before. */
const LAGOS_OFFSET_MS = 3_600_000;

function lagosStartOfDay(now: Date): Date {
  const lagos = now.getTime() + LAGOS_OFFSET_MS;
  return new Date(Math.floor(lagos / DAY_MS) * DAY_MS - LAGOS_OFFSET_MS);
}

function lagosStartOfYear(now: Date): Date {
  const year = new Date(now.getTime() + LAGOS_OFFSET_MS).getUTCFullYear();
  return new Date(Date.UTC(year, 0, 1) - LAGOS_OFFSET_MS);
}

/** An unknown or missing key falls back to the last 30 days, never to an error page. */
export function parsePeriodKey(raw: string | string[] | undefined): PeriodKey {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (PERIOD_KEYS as readonly string[]).includes(value ?? "") ? (value as PeriodKey) : "30d";
}

/**
 * The window ends now. "Today" and "Year to date" start at Lagos midnight; the rolling periods start N days ago. The
 * database compares it with the window of the same length just before it.
 */
export function resolvePeriod(key: PeriodKey, now: Date): ResolvedPeriod {
  let from: Date;
  if (key === "today") from = lagosStartOfDay(now);
  else if (key === "ytd") from = lagosStartOfYear(now);
  else from = new Date(now.getTime() - Number(key.replace("d", "")) * DAY_MS);
  // A window must have length: one minute past Lagos midnight on 1 January, "today" and "year to date" are both a
  // minute long, which is still a real window.
  if (from.getTime() >= now.getTime()) from = new Date(now.getTime() - 60_000);
  return { key, label: PERIOD_LABEL[key], previousLabel: PREVIOUS_LABEL[key], from, to: now };
}

const count = z.number().int().nonnegative();
const kobo = z.number().int();
const bySource = z.record(z.string(), count);

const windowSchema = z.object({
  registrations: count,
  memberships_started: count,
  started_by_source: bySource,
  memberships_ended: count,
  collected_kobo: kobo,
  collected_count: count,
  refunded_kobo: kobo,
  refunded_count: count,
  failed_payments: count,
  notifications_sent: count,
  notifications_failed: count,
});
export type OverviewWindow = z.infer<typeof windowSchema>;

export const overviewSchema = z.object({
  window: z.object({ from: z.string(), to: z.string(), previous_from: z.string(), previous_to: z.string() }),
  current: windowSchema,
  previous: windowSchema,
  snapshot: z.object({
    computed_at: z.string(),
    registered_patients: count,
    active_memberships: count,
    active_by_source: bySource,
    free_patients: count,
    ending_next_30d: count,
  }),
});
export type Overview = z.infer<typeof overviewSchema>;

/** Membership sources (patient_memberships.source), in the order the page lists them. */
export const MEMBERSHIP_SOURCES = ["purchase", "voucher", "employer", "granted", "legacy_conversion"] as const;
export const SOURCE_LABEL: Record<string, string> = {
  purchase: "Paid by the member",
  voucher: "Sponsored by someone (Care Voucher)",
  employer: "Paid by an employer",
  granted: "Given by staff",
  legacy_conversion: "Moved over from an old plan",
};

export interface Comparison {
  /** Shown under the figure, e.g. "↑ 12% on the 30 days before (was 41)". */
  text: string;
  /** Colour, by whether the change is good: "up" draws green, "down" draws amber, "flat" grey. Not the arrow. */
  direction: "up" | "down" | "flat";
}

/**
 * Compares a figure with the window before. The arrow says which way it moved; the colour says whether that is good
 * (`higherIsBetter`), so a rise in failed payments is never drawn in the reassuring colour. From zero there is no
 * honest percentage, so the line gives the old figure instead of an infinite rise.
 */
export function compare(current: number, previous: number, previousLabel: string, higherIsBetter: boolean, format: (n: number) => string): Comparison {
  if (current === previous) return { text: `Same as ${previousLabel}`, direction: "flat" };
  const rose = current > previous;
  const arrow = rose ? "↑" : "↓";
  const good = rose === higherIsBetter;
  const was = `was ${format(previous)}`;
  const text = previous === 0
    ? `${arrow} from ${format(0)} in ${previousLabel}`
    : `${arrow} ${Math.round((Math.abs(current - previous) / previous) * 100)}% on ${previousLabel} (${was})`;
  return { text, direction: good ? "up" : "down" };
}


/** The five system-health states the console uses (docs/design/SUPERADMIN-CONSOLE.md). */
export type HealthState = "operational" | "degraded" | "failed" | "unknown" | "not_configured";

export const HEALTH_LABEL: Record<HealthState, string> = {
  operational: "Operational",
  degraded: "Degraded",
  failed: "Failed",
  unknown: "Unknown",
  not_configured: "Not configured",
};

export interface HealthLine {
  state: HealthState;
  /** What the state rests on, in words, so "Operational" is never just a claim. */
  evidence: string;
}

type DependencyCheck =
  | { status: "up" | "down"; latency_ms: number }
  | { status: "up" | "down" | "not_deployed"; latency_ms: number }
  | { status: "configured" | "unconfigured"; evidence?: "env" | "recent_send"; last_sent_at?: string };

/**
 * Turns one dependency check into a health line. A key that is merely set is "Unknown", never "Operational": having
 * configuration is not evidence the provider answers. Only a live answer or a real recent send counts as working.
 */
export function healthLine(check: DependencyCheck, formatTime: (iso: string) => string): HealthLine {
  switch (check.status) {
    case "up":
      return { state: "operational", evidence: `Answered a live check in ${check.latency_ms} ms` };
    case "down":
      return { state: "failed", evidence: "Did not answer a live check" };
    case "not_deployed":
      return { state: "not_configured", evidence: "Not deployed. Optional: the platform works without it" };
    case "unconfigured":
      return { state: "not_configured", evidence: "No key is set and nothing has been sent" };
    case "configured":
      return check.evidence === "recent_send" && check.last_sent_at
        ? { state: "operational", evidence: `Last message sent ${formatTime(check.last_sent_at)}` }
        : { state: "unknown", evidence: "A key is set, but nothing has checked that the provider answers" };
  }
}
