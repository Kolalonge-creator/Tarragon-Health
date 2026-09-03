"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { addDays, type CyclePrediction } from "@/lib/rules/cycle-prediction";
import type { MenstrualCycle, MenstrualDailyLog } from "@/lib/queries/menstrual-cycle";

import { formatPatientDate } from "@/lib/format-date";
/**
 * Month calendar showing what actually happened (logged period days, days
 * with a symptom log) alongside what is expected (predicted period window,
 * fertile window, ovulation).
 *
 * Recorded and predicted days are drawn differently on purpose — solid for
 * what the patient logged, outlined for what we are guessing. A tracker that
 * renders its own predictions in the same weight as recorded fact is how
 * people end up believing an estimate was a result.
 */

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

interface DayCell {
  date: string;
  dayOfMonth: number;
  inMonth: boolean;
}

function monthLabel(year: number, monthIndex: number) {
  return formatPatientDate(Date.UTC(year, monthIndex, 1), {
    month: "long",
    year: "numeric",
  });
}

/** Six weeks from the Monday on or before the 1st, so the grid never reflows. */
function buildGrid(year: number, monthIndex: number): DayCell[] {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  // getUTCDay: 0 = Sunday. Shift so Monday is the first column.
  const offset = (first.getUTCDay() + 6) % 7;
  const gridStart = new Date(first);
  gridStart.setUTCDate(gridStart.getUTCDate() - offset);

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart);
    day.setUTCDate(day.getUTCDate() + index);
    return {
      date: day.toISOString().slice(0, 10),
      dayOfMonth: day.getUTCDate(),
      inMonth: day.getUTCMonth() === monthIndex,
    };
  });
}

function withinInclusive(date: string, from: string | null, to: string | null) {
  return !!from && !!to && date >= from && date <= to;
}

export function CycleCalendar({
  cycles,
  dailyLogs,
  prediction,
  today,
  selectedDate,
  onSelectDate,
}: {
  cycles: MenstrualCycle[];
  dailyLogs: MenstrualDailyLog[];
  prediction: CyclePrediction;
  today: string;
  selectedDate: string;
  onSelectDate: (date: string) => void;
}) {
  const [cursor, setCursor] = useState(() => ({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)) - 1,
  }));

  const grid = useMemo(() => buildGrid(cursor.year, cursor.month), [cursor]);

  /** Every date covered by a logged period, expanded from its start/end. */
  const loggedPeriodDays = useMemo(() => {
    const days = new Set<string>();
    for (const cycle of cycles) {
      const end = cycle.period_end_date ?? cycle.period_start_date;
      let day = cycle.period_start_date;
      // Bounded by the table's own 15-day plausibility constraint, so this
      // cannot run away even on a corrupt row.
      for (let guard = 0; day <= end && guard < 20; guard += 1) {
        days.add(day);
        day = addDays(day, 1);
      }
    }
    return days;
  }, [cycles]);

  const loggedDays = useMemo(
    () =>
      new Set(
        dailyLogs
          .filter(
            (log) => log.flow || log.symptoms.length > 0 || log.moods.length > 0 || log.notes
          )
          .map((log) => log.log_date)
      ),
    [dailyLogs]
  );

  function shiftMonth(delta: number) {
    setCursor((current) => {
      const next = new Date(Date.UTC(current.year, current.month + delta, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
    });
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => shiftMonth(-1)}
          aria-label="Previous month"
        >
          &larr;
        </Button>
        <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
          {monthLabel(cursor.year, cursor.month)}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => shiftMonth(1)}
          aria-label="Next month"
        >
          &rarr;
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1" role="grid">
        {WEEKDAYS.map((day, index) => (
          <div
            key={`${day}-${index}`}
            className="pb-1 text-center text-[11px] font-medium text-charcoal-ink/50 dark:text-night-ink/55"
            aria-hidden
          >
            {day}
          </div>
        ))}

        {grid.map((cell) => {
          const isPeriod = loggedPeriodDays.has(cell.date);
          const isOvulation = cell.date === prediction.predictedOvulationDate;
          const isFertile = withinInclusive(
            cell.date,
            prediction.fertileWindowStart,
            prediction.fertileWindowEnd
          );
          const isPredictedPeriod = withinInclusive(
            cell.date,
            prediction.predictedNextPeriodEarliest,
            prediction.predictedNextPeriodLatest
          );
          const isToday = cell.date === today;
          const isSelected = cell.date === selectedDate;
          const hasLog = loggedDays.has(cell.date);

          // Recorded beats predicted: a day the patient actually bled is a
          // period day even if it also falls inside a fertile estimate.
          let background = "transparent";
          let textClass = "text-charcoal-ink dark:text-night-ink";
          let ring = "";
          if (isPeriod) {
            background = "var(--cycle-period)";
            textClass = "text-white";
          } else if (isOvulation) {
            background = "var(--cycle-ovulation)";
            textClass = "text-white";
          } else if (isFertile) {
            background = "color-mix(in srgb, var(--cycle-fertile) 22%, transparent)";
          } else if (isPredictedPeriod) {
            ring = "border-2 border-dashed";
          }

          const labelParts = [
            formatPatientDate(`${cell.date}T00:00:00Z`, {
              day: "numeric",
              month: "long",
            }),
            isPeriod ? "period logged" : null,
            isPredictedPeriod ? "period expected" : null,
            isOvulation ? "estimated ovulation" : null,
            isFertile && !isOvulation ? "fertile window" : null,
            hasLog ? "has a symptom log" : null,
          ].filter(Boolean);

          return (
            <button
              key={cell.date}
              type="button"
              onClick={() => onSelectDate(cell.date)}
              aria-label={labelParts.join(", ")}
              aria-current={isToday ? "date" : undefined}
              aria-pressed={isSelected}
              className={[
                "relative flex aspect-square items-center justify-center rounded-full text-xs transition",
                cell.inMonth ? textClass : "text-charcoal-ink/25 dark:text-night-ink/40",
                ring,
                isSelected ? "outline outline-2 outline-offset-1 outline-charcoal-ink dark:outline-night-ink" : "",
                isToday && !isSelected ? "font-bold underline underline-offset-2" : "",
                "hover:opacity-80 focus:outline focus:outline-2 focus:outline-brand-green",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{
                backgroundColor: cell.inMonth ? background : "transparent",
                borderColor: ring ? "var(--cycle-predicted)" : undefined,
              }}
            >
              {cell.dayOfMonth}
              {hasLog && (
                <span
                  aria-hidden
                  // Same colours as before (bg-white = white, bg-charcoal-ink =
                  // var(--charcoal-ink)), moved from an inline style to classes so
                  // the ink dot can take a dark: override — inline styles would
                  // beat any dark class. Period days keep the white dot on the
                  // theme-stable period fill in both themes.
                  className={`absolute bottom-0.5 h-1 w-1 rounded-full ${
                    isPeriod ? "bg-white" : "bg-charcoal-ink dark:bg-night-ink"
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
        Solid days are what you logged. The dashed outline is when your next period is expected,
        and the shaded band is your estimated fertile window. A dot means you added notes or
        symptoms that day.
      </p>
    </div>
  );
}
