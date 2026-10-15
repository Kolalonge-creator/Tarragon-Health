/**
 * Gestational age for the maternal screens. Pure, dates only (YYYY-MM-DD, Lagos calendar day), no clock: the caller passes
 * today. Naegele's rule is an estimate and is always shown as one; a clinician's scan date can replace it (`source: "edd"`).
 */
const DAY_MS = 86_400_000;
const GESTATION_DAYS = 280;
/** A pregnancy cannot be recorded as running past this many weeks; beyond it the estimate is refused rather than shown. */
const MAX_WEEKS = 44;

export interface GestationalAge {
  readonly weeks: number;
  readonly days: number;
  readonly totalDays: number;
  readonly source: "lmp" | "edd";
  readonly edd: string;
}

function ms(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}
export function isDateOnly(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(ms(value));
}
export function addDays(date: string, days: number): string {
  return new Date(ms(date) + days * DAY_MS).toISOString().slice(0, 10);
}
export function daysBetween(from: string, to: string): number {
  return Math.round((ms(to) - ms(from)) / DAY_MS);
}

/**
 * Weeks and days on `today`, from the last period (LMP) or, when there is none, from the due date (EDD). Returns null when
 * neither is a real date, when today is before the pregnancy began, or when it is past the longest pregnancy this will show.
 * An LMP wins over an EDD only when both are present and agree to within 14 days; otherwise the EDD (which a clinician sets)
 * is the dating, because a typed LMP is the commonest source of error.
 */
export function gestationalAge(input: { lmp?: string | null; edd?: string | null; today: string }): GestationalAge | null {
  if (!isDateOnly(input.today)) return null;
  const lmp = isDateOnly(input.lmp) ? input.lmp : null;
  const edd = isDateOnly(input.edd) ? input.edd : null;
  let start: string;
  let source: "lmp" | "edd";
  let due: string;
  if (edd && (!lmp || Math.abs(daysBetween(addDays(lmp, GESTATION_DAYS), edd)) > 14)) {
    start = addDays(edd, -GESTATION_DAYS);
    source = "edd";
    due = edd;
  } else if (lmp) {
    start = lmp;
    source = "lmp";
    due = addDays(lmp, GESTATION_DAYS);
  } else {
    return null;
  }
  const total = daysBetween(start, input.today);
  if (total < 0 || Math.floor(total / 7) > MAX_WEEKS) return null;
  return { weeks: Math.floor(total / 7), days: total % 7, totalDays: total, source, edd: due };
}
