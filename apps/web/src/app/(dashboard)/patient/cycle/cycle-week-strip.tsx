"use client";

import { t } from "@tarragon/i18n";
import { addDays } from "@/lib/rules/cycle-prediction";
import { formatPatientDate } from "@/lib/format-date";

/**
 * Choosing the day to log without typing a date (UI-A): the last seven days as big buttons, then "Pick another date", which jumps to the
 * month calendar. A dot under a day means notes or symptoms were logged that day (explained in the calendar's "What do these marks mean?").
 */
export function CycleWeekStrip({
  today,
  selectedDate,
  onSelectDate,
  loggedDays,
}: {
  today: string;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  loggedDays: ReadonlySet<string>;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  return (
    <div className="space-y-2">
      <p id="cycle-week-label" className="text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">
        {t("cycle.log.week_label")}
      </p>
      <div role="group" aria-labelledby="cycle-week-label" className="grid grid-cols-7 gap-1">
        {days.map((iso) => {
          const selected = iso === selectedDate;
          const isToday = iso === today;
          const weekday = formatPatientDate(`${iso}T00:00:00Z`, { weekday: "short" });
          const dayNumber = Number(iso.slice(8, 10));
          const spoken = formatPatientDate(`${iso}T00:00:00Z`, { weekday: "long", day: "numeric", month: "long" });
          const logged = loggedDays.has(iso);
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelectDate(iso)}
              aria-pressed={selected}
              aria-label={[spoken, isToday ? t("cycle.log.today") : null, logged ? t("cycle.legend.note") : null].filter(Boolean).join(". ")}
              className={[
                "flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-lg border text-xs transition",
                selected
                  ? "border-brand-green bg-brand-green text-white"
                  : "border-charcoal-ink/20 text-charcoal-ink hover:bg-charcoal-ink/5 dark:border-night-ink/25 dark:text-night-ink dark:hover:bg-night-ink/10",
                isToday && !selected ? "border-2 border-charcoal-ink dark:border-night-ink" : "",
              ].join(" ")}
            >
              <span>{weekday}</span>
              <span className="text-sm font-semibold">{dayNumber}</span>
              <span aria-hidden className={`h-1 w-1 rounded-full ${logged ? "bg-current" : "bg-transparent"}`} />
            </button>
          );
        })}
      </div>
      <a
        href="#cycle-calendar"
        className="inline-flex min-h-11 items-center text-sm font-medium text-brand-green underline dark:text-brand-green-bright"
      >
        {t("cycle.log.pick_other")}
      </a>
    </div>
  );
}
