import { formatPatientDate } from "@/lib/format-date";

export type SleepWeekEntry = { logged_on: string; duration_hours: number };

/** The last seven calendar days ending at `today` (yyyy-mm-dd), oldest first. Pure so it is testable. */
export function lastSevenDays(today: string): string[] {
  const base = new Date(`${today}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() - (6 - i));
    return d.toISOString().slice(0, 10);
  });
}

/**
 * Seven bars, one per night. Only nights the person logged get a bar; a missed night is an empty slot, never a zero or an estimate.
 * The optional goal draws a thin line so the bars read against the person's own target.
 */
export function SleepWeek({ entries, today, goalHours }: { entries: SleepWeekEntry[]; today: string; goalHours?: number | null }) {
  const days = lastSevenDays(today);
  const byDay = new Map(entries.map((e) => [e.logged_on, e.duration_hours]));
  if (!days.some((d) => byDay.has(d))) return null;
  const top = Math.max(10, goalHours ?? 0, ...days.map((d) => byDay.get(d) ?? 0));
  return (
    <section aria-label="Sleep, last 7 days" className="rounded-2xl bg-white p-5 dark:bg-night-card">
      <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60">Last 7 days</p>
      <ul className="relative mt-3 grid h-28 grid-cols-7 items-end gap-2">
        {goalHours != null && goalHours > 0 && (
          <li
            aria-hidden
            data-testid="sleep-goal-line"
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-charcoal-ink/30 dark:border-night-ink/30"
            style={{ bottom: `${(goalHours / top) * 100}%` }}
          />
        )}
        {days.map((day) => {
          const hours = byDay.get(day);
          const label = formatPatientDate(day, { weekday: "short" });
          return (
            <li key={day} className="flex h-full flex-col items-center justify-end gap-1" aria-label={hours != null ? `${label}: ${hours} hours` : `${label}: not logged`}>
              {hours != null ? (
                <>
                  <span className="text-[11px] text-charcoal-ink/70 dark:text-night-ink/70">{hours}</span>
                  <span className="w-full rounded-t-md bg-brand-green/80" style={{ height: `${(hours / top) * 100}%` }} />
                </>
              ) : (
                <span className="w-full rounded-t-md border border-dashed border-charcoal-ink/15 dark:border-night-ink/20" style={{ height: "6%" }} />
              )}
            </li>
          );
        })}
      </ul>
      <ul aria-hidden className="mt-1 grid grid-cols-7 gap-2 text-center text-[11px] text-charcoal-ink/60 dark:text-night-ink/60">
        {days.map((day) => (
          <li key={day}>{formatPatientDate(day, { weekday: "short" })}</li>
        ))}
      </ul>
    </section>
  );
}
