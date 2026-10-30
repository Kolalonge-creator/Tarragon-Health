export type LedgerEntry = { id: string; reason: string; points: number };
export type LedgerGroup = { reason: string; points: number; count: number };

/** Rows with the same reason are shown once with a count, so a week of daily logging reads as one line, not seven. */
export function groupLedger(entries: readonly LedgerEntry[]): LedgerGroup[] {
  const groups = new Map<string, LedgerGroup>();
  for (const entry of entries) {
    const key = `${entry.reason}|${entry.points > 0 ? "earn" : "spend"}`;
    const existing = groups.get(key);
    if (existing) {
      existing.points += entry.points;
      existing.count += 1;
    } else {
      groups.set(key, { reason: entry.reason, points: entry.points, count: 1 });
    }
  }
  return [...groups.values()];
}
