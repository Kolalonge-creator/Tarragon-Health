export interface NextAvailable<T extends { slot_start: string }> {
  slot: T;
  /** Whole days from now to the slot, on the Lagos calendar: 0 is today. */
  daysAway: number;
}

const LAGOS_DAY = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });

/**
 * The earliest open time in the list, with how far away it is. Nothing here is estimated: it is a slot a clinician has actually
 * offered, so there is no "typical wait" figure. A slot already in the past is ignored; an empty or all-past list gives null, and the
 * screen shows nothing rather than a guess.
 */
export function nextAvailable<T extends { slot_start: string }>(slots: readonly T[], nowMs: number): NextAvailable<T> | null {
  let best: T | null = null;
  for (const s of slots) {
    const start = Date.parse(s.slot_start);
    if (!Number.isFinite(start) || start < nowMs) continue;
    if (best === null || start < Date.parse(best.slot_start)) best = s;
  }
  if (best === null) return null;
  const today = Date.parse(`${LAGOS_DAY(nowMs)}T00:00:00Z`);
  const day = Date.parse(`${LAGOS_DAY(Date.parse(best.slot_start))}T00:00:00Z`);
  return { slot: best, daysAway: Math.round((day - today) / 86_400_000) };
}

export function daysAwayLabel(daysAway: number): string {
  if (daysAway <= 0) return "Today";
  if (daysAway === 1) return "Tomorrow";
  return `In ${daysAway} days`;
}
