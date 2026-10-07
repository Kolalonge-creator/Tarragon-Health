import { formatGlucose, GLUCOSE_UNIT_LABEL, type GlucoseDisplayUnit } from "@tarragon/shared";
import type { MessageKey } from "@tarragon/i18n";
import type { SectionId } from "@/lib/sections";
import type { SummaryStats } from "@/lib/overview";

/** A translatable line: the key plus its placeholders, resolved by the screen. */
export interface Line {
  key: MessageKey;
  params?: Record<string, string | number>;
}

export interface NextBestStep {
  title: Line;
  body: Line;
  cta: Line;
  target: SectionId;
}

/**
 * Derived from the stats already loaded, so the card stays honest rather than
 * always saying "log a reading" to a patient who already has: doses still open
 * today come first, then a missing reading, then a calm default. It only talks
 * about what has been logged, never about how the patient is doing.
 * `today` is the Lagos calendar date, passed in so the rule is testable.
 */
export function nextBestStep(stats: SummaryStats, today: string): NextBestStep {
  const dosesRemaining = stats.dosesTotal - stats.dosesTaken;
  if (dosesRemaining > 0) {
    return {
      title: dosesRemaining === 1 ? { key: "home.next.doses_one" } : { key: "home.next.doses_many", params: { count: dosesRemaining } },
      body: { key: "home.next.doses_body" },
      cta: { key: "home.next.doses_cta" },
      target: "medications",
    };
  }
  const lastReadingDay = stats.lastVitalTakenAt
    ? new Date(stats.lastVitalTakenAt).toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" })
    : null;
  if (lastReadingDay !== today) {
    return {
      title: { key: "home.next.reading_title" },
      body: { key: "home.next.reading_body" },
      cta: { key: "home.next.reading_cta" },
      target: "vitals",
    };
  }
  return {
    title: { key: "home.next.ok_title" },
    body: { key: "home.next.ok_body" },
    cta: { key: "home.next.ok_cta" },
    target: "vitals",
  };
}

export interface HeroMetric {
  label: MessageKey;
  value: string;
  unit?: string;
}

/**
 * The one big number at the top: a real BP reading beats glucose beats today's
 * dose count. Null means nothing exists yet, and the screen shows a warm prompt
 * instead, never a zeroed or invented value.
 */
export function heroMetric(stats: SummaryStats, glucoseUnit: GlucoseDisplayUnit): HeroMetric | null {
  if (stats.latestBp) {
    return { label: "home.hero.bp", value: `${stats.latestBp.systolic}/${stats.latestBp.diastolic}`, unit: "mmHg" };
  }
  if (stats.latestGlucoseMmolL !== null) {
    return {
      label: "home.hero.glucose",
      // The reader's own unit, so this matches the number on their meter.
      value: formatGlucose(stats.latestGlucoseMmolL, glucoseUnit, { withUnit: false }) ?? "-",
      unit: GLUCOSE_UNIT_LABEL[glucoseUnit],
    };
  }
  if (stats.dosesTotal > 0) {
    return { label: "home.hero.doses", value: `${stats.dosesTaken}/${stats.dosesTotal}` };
  }
  return null;
}

/** "in 5 days" / "today" / "3 days overdue" by Lagos calendar day. */
export function dueLine(dateStr: string, now: Date = new Date()): Line {
  const lagosDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
  const days = Math.round((Date.parse(lagosDay(new Date(dateStr))) - Date.parse(lagosDay(now))) / 86_400_000);
  if (days > 0) return days === 1 ? { key: "home.due.in_one" } : { key: "home.due.in_many", params: { count: days } };
  if (days === 0) return { key: "home.due.today" };
  return days === -1 ? { key: "home.due.overdue_one" } : { key: "home.due.overdue_many", params: { count: -days } };
}

/** "just now" / "5m ago" / "3h ago" / "2d ago". */
export function agoLine(iso: string, now: number = Date.now()): Line {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return { key: "home.ago.now" };
  if (minutes < 60) return { key: "home.ago.minutes", params: { count: minutes } };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { key: "home.ago.hours", params: { count: hours } };
  return { key: "home.ago.days", params: { count: Math.round(hours / 24) } };
}

/** A visit weeks out needs its date; "Tue, 14:00" would read as this coming Tuesday. */
export function formatVisitTime(iso: string, now: number = Date.now()): string {
  const when = new Date(iso);
  const withinSixDays = when.getTime() - now < 6 * 86_400_000;
  return when.toLocaleString(
    undefined,
    withinSixDays
      ? { timeZone: "Africa/Lagos", weekday: "short", hour: "2-digit", minute: "2-digit" }
      : { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }
  );
}
