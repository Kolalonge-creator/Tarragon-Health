/**
 * Pure, DB-free helpers for the Home Monitoring Platform (spec §51.8, §51.10,
 * §51.13, §51.14). The actual expected/received counts come from the
 * monitoring_schedule_adherence view (server-side, real dates); everything
 * here is presentation logic layered on top of numbers the view/queries
 * already produced.
 */

export type TrendDirection = "up" | "down" | "stable" | "unknown";

/**
 * Compares the average of the earlier half of a chronologically-ordered
 * series against the later half. A 3% relative deadband keeps normal
 * reading-to-reading noise from reading as a "trend" — this is a coarse,
 * patient-facing signal, not a statistical test, and never gates escalation
 * (the deterministic red-flag classifiers already own that).
 */
export function trendDirection(valuesOldestFirst: number[]): TrendDirection {
  const values = valuesOldestFirst.filter((v) => Number.isFinite(v));
  if (values.length < 4) return "unknown";

  const mid = Math.floor(values.length / 2);
  const earlier = values.slice(0, mid);
  const later = values.slice(mid);
  const average = (xs: number[]) => xs.reduce((sum, x) => sum + x, 0) / xs.length;

  const earlierAvg = average(earlier);
  const laterAvg = average(later);
  const deadband = Math.abs(earlierAvg) * 0.03;

  const delta = laterAvg - earlierAvg;
  if (delta > deadband) return "up";
  if (delta < -deadband) return "down";
  return "stable";
}

/**
 * Spec §51.13's non-clinical interpretation copy: never a number, never a
 * clinical threshold — just "higher/lower than your usual range" plus a
 * pointer to the care team. `higherIsConcern` flips the framing for a vital
 * like SpO2 where a fall, not a rise, is the direction that matters.
 */
export function monitoringInterpretationCopy(
  direction: TrendDirection,
  higherIsConcern: boolean = true
): string {
  if (direction === "unknown") {
    return "Keep logging — once there are enough readings, we'll show you how they're trending.";
  }
  if (direction === "stable") {
    return "Your recent readings have been steady, in line with your usual range.";
  }
  const isConcerning = higherIsConcern ? direction === "up" : direction === "down";
  if (isConcerning) {
    return "Your recent readings have been higher than your usual range. Your care team may need to review them.";
  }
  return "Your recent readings have been trending in a good direction — keep it up.";
}

export type ReadingDueStatus = { label: string; done: boolean };

/**
 * Coarse "Today ✓ / Yesterday ✓ / Due today" status for the patient home
 * monitoring summary (spec §51.2) — a simplified read of last_reading_at
 * against the item's own cadence, not a full per-slot schedule.
 */
export function readingDueStatus(
  lastReadingAtIso: string | null,
  frequencyDays: number,
  now: Date = new Date()
): ReadingDueStatus {
  if (!lastReadingAtIso) return { label: "Due today", done: false };

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(new Date(lastReadingAtIso))) / 86_400_000);

  if (diffDays <= 0) return { label: "Today", done: true };
  if (diffDays === 1) return { label: "Yesterday", done: true };
  if (diffDays < frequencyDays) return { label: `${diffDays} days ago`, done: true };
  return { label: "Due today", done: false };
}

export function formatAdherencePct(expected: number, received: number): number | null {
  if (expected <= 0) return null;
  return Math.round(Math.min(100, (received / expected) * 100) * 10) / 10;
}

/**
 * Drives the clinician-facing "Clinical review: Recommended" flag (spec
 * §51.14) — a worsening trend, a schedule item that's crossed its own
 * escalation threshold, or materially poor adherence. This is a dashboard
 * cue only; it never itself raises a clinician_alerts row (that's
 * private.flag_overdue_monitoring / the vital-specific red-flag engines).
 */
export function isClinicalReviewRecommended(input: {
  trend: TrendDirection;
  higherIsConcern?: boolean;
  consecutiveMisses: number;
  escalationMissedThreshold: number;
  adherencePct: number | null;
}): boolean {
  const { trend, higherIsConcern = true, consecutiveMisses, escalationMissedThreshold, adherencePct } = input;
  const worseningTrend = higherIsConcern ? trend === "up" : trend === "down";
  const overdue = consecutiveMisses >= escalationMissedThreshold;
  const poorAdherence = adherencePct != null && adherencePct < 60;
  return worseningTrend || overdue || poorAdherence;
}
