import { WEEKDAYS } from "./ops-schemas";

type Gap = { scope: "moderator" | "safety_reviewer"; weekday: number; hour: number };

const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

/**
 * A 7 by 24 week. Each cell says "ok" (covered) or "gap" (nobody on duty) in words, and a gap also has a diagonal pattern and a border,
 * so it does not rely on colour. A screen reader gets a full sentence per cell.
 */
export function CoverageGrid({ title, scope, gaps }: { title: string; scope: Gap["scope"]; gaps: Gap[] }) {
  const missing = new Set(gaps.filter((g) => g.scope === scope).map((g) => `${g.weekday}-${g.hour}`));
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[56rem] border-collapse text-center text-[11px]">
        <caption className="pb-2 text-left text-sm font-semibold text-charcoal-ink">
          {title}: {missing.size === 0 ? "every hour is covered" : `${missing.size} ${missing.size === 1 ? "hour is" : "hours are"} not covered`}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="py-1 pr-2 text-left font-medium">Day</th>
            {hours.map((h) => (
              <th key={h} scope="col" className="px-0.5 py-1 font-normal">
                <span className="sr-only">From </span>{String(h).padStart(2, "0")}<span className="sr-only">:00</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {WEEKDAYS.map((day, wd) => (
            <tr key={day}>
              <th scope="row" className="py-0.5 pr-2 text-left text-xs font-medium">{day}</th>
              {hours.map((h) => {
                const gap = missing.has(`${wd}-${h}`);
                return (
                  <td
                    key={h}
                    className={
                      gap
                        ? "border-2 border-red-700 bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(185,28,28,0.25)_3px,rgba(185,28,28,0.25)_6px)] py-1 font-semibold text-red-900"
                        : "border border-charcoal-ink/15 py-1 text-charcoal-ink/70"
                    }
                  >
                    <span aria-hidden="true">{gap ? "gap" : "ok"}</span>
                    <span className="sr-only">{`${day} ${hourLabel(h)}: ${gap ? "nobody on duty" : "covered"}`}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
