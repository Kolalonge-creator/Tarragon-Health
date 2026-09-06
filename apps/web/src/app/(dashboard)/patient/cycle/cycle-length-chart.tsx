"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  NORMAL_CYCLE_MAX_DAYS,
  NORMAL_CYCLE_MIN_DAYS,
  type CycleStats,
} from "@/lib/rules/cycle-prediction";

/**
 * Cycle length over time, drawn against the normal 24-38 day band.
 *
 * A plain inline SVG rather than the recharts wrapper the vitals trends use:
 * this is a handful of bars with a shaded reference band and no axes worth
 * the runtime, and keeping it dependency-free means the cycle page ships no
 * chart library to a phone on a Nigerian mobile connection.
 *
 * The band is the point. A number on its own ("31 days") means nothing to
 * most people; a bar sitting comfortably inside a shaded normal range
 * answers the actual question, which is "is this okay?".
 */

const HEIGHT = 132;
const BAR_GAP = 6;

export function CycleLengthChart({ stats }: { stats: CycleStats }) {
  const lengths = stats.cycleLengths;
  if (lengths.length < 2) return null;

  // Scale to cover both the data and the whole normal band, so the band is
  // always visible even for someone whose cycles sit entirely outside it.
  const min = Math.min(NORMAL_CYCLE_MIN_DAYS - 2, ...lengths) - 1;
  const max = Math.max(NORMAL_CYCLE_MAX_DAYS + 2, ...lengths) + 1;
  const span = max - min;
  const y = (value: number) => HEIGHT - ((value - min) / span) * HEIGHT;

  const barWidth = 100 / lengths.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cycle length over time</CardTitle>
        <CardDescription>
          Your last {lengths.length} cycles, oldest first. The shaded band is the usual range for
          an adult cycle ({NORMAL_CYCLE_MIN_DAYS} to {NORMAL_CYCLE_MAX_DAYS} days). Sitting
          outside it now and then is common.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <svg
          viewBox={`0 0 100 ${HEIGHT}`}
          preserveAspectRatio="none"
          className="h-36 w-full"
          role="img"
          aria-label={`Cycle lengths, oldest first: ${lengths.join(", ")} days. Usual range ${NORMAL_CYCLE_MIN_DAYS} to ${NORMAL_CYCLE_MAX_DAYS} days.`}
        >
          {/* Normal band */}
          <rect
            x={0}
            y={y(NORMAL_CYCLE_MAX_DAYS)}
            width={100}
            height={Math.max(0, y(NORMAL_CYCLE_MIN_DAYS) - y(NORMAL_CYCLE_MAX_DAYS))}
            fill="var(--soft-sage)"
            // Soft sage doesn't flip with the theme; the class wins over the
            // presentation attribute in dark only, so light is untouched.
            className="dark:fill-night-ink/10"
          />
          {lengths.map((length, index) => {
            const top = y(length);
            const inRange =
              length >= NORMAL_CYCLE_MIN_DAYS && length <= NORMAL_CYCLE_MAX_DAYS;
            return (
              <rect
                key={`${index}-${length}`}
                x={index * barWidth + BAR_GAP / 2}
                y={top}
                width={Math.max(1, barWidth - BAR_GAP)}
                height={Math.max(1, HEIGHT - top)}
                rx={1.5}
                fill={inRange ? "var(--cycle-period)" : "var(--sprout-gold)"}
              />
            );
          })}
        </svg>

        <ul className="mt-2 flex justify-between text-[11px] text-charcoal-ink/60 dark:text-night-ink/60">
          {lengths.map((length, index) => (
            <li key={`${index}-label`} className="flex-1 text-center">
              {length}
            </li>
          ))}
        </ul>

        {stats.variationDays !== null && (
          <p className="mt-2 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            {stats.regularity === "regular"
              ? `Steady: ${stats.variationDays} ${stats.variationDays === 1 ? "day" : "days"} between your shortest and longest.`
              : `Your cycles vary by ${stats.variationDays} days. Some variation is normal; a lot of it is worth a mention to your care team.`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
