/**
 * Expiry maths for the dashboard (S15). A licence stays valid to the end of the day printed on it, Africa/Lagos
 * time. The database sweep uses the same rule (private.credential_valid_on); this file only decides how a number
 * of days is shown, so the two are checked against the same Lagos calendar day, never against raw timestamps.
 */
const LAGOS_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" });

/** YYYY-MM-DD in Lagos for an instant. */
export function lagosDate(instant: Date): string {
  return LAGOS_DAY.format(instant);
}

function dayNumber(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return Math.floor(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 86_400_000);
}

/** Whole Lagos calendar days from `now` to the expiry: 0 on the expiry day, negative once past. Null when no date. */
export function daysUntil(expiresAt: string | null | undefined, now: Date): number | null {
  if (!expiresAt) return null;
  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) return null;
  return dayNumber(lagosDate(expiry)) - dayNumber(lagosDate(now));
}

export type ExpiryBand = "not_recorded" | "expired" | "today" | "month" | "quarter" | "ok";

/** Bands follow the notice windows (90 days, 30 days, the day itself). */
export function expiryBand(days: number | null): ExpiryBand {
  if (days === null) return "not_recorded";
  if (days < 0) return "expired";
  if (days === 0) return "today";
  if (days <= 30) return "month";
  if (days <= 90) return "quarter";
  return "ok";
}

export const EXPIRY_BAND_LABEL: Record<ExpiryBand, string> = {
  not_recorded: "No date on file",
  expired: "Expired",
  today: "Expires today",
  month: "Within a month",
  quarter: "Within 3 months",
  ok: "In date",
};

export const EXPIRY_BAND_TONE: Record<ExpiryBand, "red" | "amber" | "blue" | "grey" | "green"> = {
  not_recorded: "grey",
  expired: "red",
  today: "red",
  month: "amber",
  quarter: "blue",
  ok: "green",
};

export function describeDays(days: number | null): string {
  if (days === null) return "No date on file";
  if (days < 0) return `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`;
  if (days === 0) return "Expires today";
  return `${days} day${days === 1 ? "" : "s"} left`;
}
