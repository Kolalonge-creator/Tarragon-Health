import { doseDayText, type DoseDay } from "@tarragon/medicines";

/** Words for one day (hover label and screen-reader table); shared with the phone app. */
export { doseDayText };

/**
 * Doses per day as bars (2026-11-06, chosen in a prompt). Each bar's full height is the doses due that day; the filled part is
 * the doses marked taken, in brand green, and the rest is a light neutral, never red: this is a record, not a grade. A day
 * with nothing due is a short grey tick. Every bar has a hover label in words, and the same figures are a table for screen
 * readers, so nothing depends on colour. The legend is in words under the chart.
 */
export function DoseBars({ days, compact = false }: { days: readonly DoseDay[]; compact?: boolean }) {
  const maxDue = Math.max(1, ...days.map((d) => d.due));
  const H = compact ? 32 : 96;
  // Compact bars sit inside a tile's link (Home), where a table would become the link's whole name: there the tile's own
  // big number and "x of y" already say it, so the bars are decoration only. The full chart keeps its table.
  if (compact) {
    return (
      <div aria-hidden className="flex items-end gap-[2px]" style={{ height: H }}>
        {days.map((day) => {
          const total = day.due === 0 ? 3 : Math.max(6, (day.due / maxDue) * H);
          const takenH = day.due === 0 ? 0 : (day.taken / day.due) * total;
          return (
            <div key={day.date} className="flex flex-1 flex-col justify-end" style={{ height: H }}>
              <div className="flex flex-col justify-end overflow-hidden rounded-t-[4px] bg-charcoal-ink/10 dark:bg-night-ink/15" style={{ height: total }}>
                {day.due > 0 && <div className="bg-brand-green dark:bg-brand-green-bright" style={{ height: takenH }} />}
              </div>
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <div>
      <div aria-hidden className="flex items-end gap-[2px]" style={{ height: H }}>
        {days.map((day) => {
          const total = day.due === 0 ? 3 : Math.max(6, (day.due / maxDue) * H);
          const takenH = day.due === 0 ? 0 : (day.taken / day.due) * total;
          return (
            <div key={day.date} title={doseDayText(day)} className="flex flex-1 flex-col justify-end" style={{ height: H }}>
              <div
                className={day.due === 0 ? "rounded-t-[2px] bg-charcoal-ink/10 dark:bg-night-ink/15" : "flex flex-col justify-end overflow-hidden rounded-t-[4px] bg-charcoal-ink/10 dark:bg-night-ink/15"}
                style={{ height: total }}
              >
                {day.due > 0 && <div className="bg-brand-green dark:bg-brand-green-bright" style={{ height: takenH }} />}
              </div>
            </div>
          );
        })}
      </div>
      {!compact && (
        <p aria-hidden className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-charcoal-ink/65 dark:text-night-ink/65">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-brand-green dark:bg-brand-green-bright" /> Marked taken
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-charcoal-ink/15 dark:bg-night-ink/20" /> Not marked taken
          </span>
        </p>
      )}
      <table className="sr-only">
        <caption>Doses marked taken each day</caption>
        <tbody>
          {days.map((day) => (
            <tr key={day.date}>
              <td>{doseDayText(day)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
