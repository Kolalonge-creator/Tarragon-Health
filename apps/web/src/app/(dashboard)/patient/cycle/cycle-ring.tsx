"use client";

import {
  nextPeriodSummary,
  PHASE_LABEL,
  type CyclePhase,
  type CyclePrediction,
} from "@/lib/rules/cycle-prediction";

/**
 * The cycle wheel: one full turn is one predicted cycle, with each phase
 * drawn as an arc and a marker on today.
 *
 * It is a ring rather than a bar because a cycle is the one health metric
 * that genuinely is circular — it ends where it starts — and because the
 * single question somebody opens this page to answer ("where am I, and how
 * long until my period?") is answered by the position of one dot.
 *
 * Everything here is derived from the prediction, so the ring cannot drift
 * out of step with the numbers printed beside it.
 */

const SIZE = 240;
const CENTRE = SIZE / 2;
const RADIUS = 96;
const STROKE = 22;

interface Arc {
  phase: CyclePhase;
  /** Inclusive cycle day the arc starts on (day 1 = first day of period). */
  fromDay: number;
  /** Inclusive cycle day the arc ends on. */
  toDay: number;
}

const PHASE_COLOR: Record<CyclePhase, string> = {
  menstrual: "var(--cycle-period)",
  follicular: "var(--cycle-follicular)",
  fertile: "var(--cycle-fertile)",
  ovulation: "var(--cycle-ovulation)",
  luteal: "var(--cycle-luteal)",
  unknown: "var(--soft-sage)",
};

/** Polar -> cartesian, with day 1 at the top and the cycle running clockwise. */
function pointOnRing(cycleDay: number, cycleLength: number, radius = RADIUS) {
  const fraction = (cycleDay - 1) / cycleLength;
  const angle = fraction * 2 * Math.PI - Math.PI / 2;
  return {
    x: CENTRE + radius * Math.cos(angle),
    y: CENTRE + radius * Math.sin(angle),
  };
}

function arcPath(fromDay: number, toDay: number, cycleLength: number) {
  // Arcs are drawn across the whole day, so the end sweeps to the start of
  // the following day — otherwise every arc is one day short and thin
  // hairlines appear between phases.
  const start = pointOnRing(fromDay, cycleLength);
  const end = pointOnRing(toDay + 1, cycleLength);
  const sweptDays = toDay + 1 - fromDay;
  const largeArc = sweptDays / cycleLength > 0.5 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

function dayOfCycle(isoDate: string, cycleStart: string): number {
  return (
    Math.round(
      (Date.parse(`${isoDate}T00:00:00Z`) - Date.parse(`${cycleStart}T00:00:00Z`)) / 86_400_000
    ) + 1
  );
}

function buildArcs(prediction: CyclePrediction): Arc[] {
  const start = prediction.lastPeriodStartDate;
  if (!start) return [];
  const cycleLength = prediction.expectedCycleLengthDays;

  const periodDays = Math.round(prediction.stats.averagePeriodDurationDays ?? 5);
  const arcs: Arc[] = [
    { phase: "menstrual", fromDay: 1, toDay: Math.min(periodDays, cycleLength) },
  ];

  if (prediction.fertileWindowStart && prediction.predictedOvulationDate) {
    // Clamped to after the period: on a very short cycle the fertile window
    // genuinely does begin during bleeding, but drawing it there would paint
    // the fertile arc over the period arc and make the ring unreadable. The
    // dates themselves are untouched; this is only how the wheel is drawn.
    const fertileFrom = Math.max(
      dayOfCycle(prediction.fertileWindowStart, start),
      periodDays + 1
    );
    const ovulationDay = dayOfCycle(prediction.predictedOvulationDate, start);
    const fertileTo = prediction.fertileWindowEnd
      ? dayOfCycle(prediction.fertileWindowEnd, start)
      : ovulationDay;

    const follicularFrom = periodDays + 1;
    if (fertileFrom > follicularFrom) {
      arcs.push({ phase: "follicular", fromDay: follicularFrom, toDay: fertileFrom - 1 });
    }
    if (ovulationDay > fertileFrom) {
      arcs.push({ phase: "fertile", fromDay: fertileFrom, toDay: ovulationDay - 1 });
    }
    arcs.push({ phase: "ovulation", fromDay: ovulationDay, toDay: ovulationDay });
    if (fertileTo > ovulationDay) {
      arcs.push({ phase: "fertile", fromDay: ovulationDay + 1, toDay: fertileTo });
    }
    if (cycleLength > fertileTo) {
      arcs.push({ phase: "luteal", fromDay: fertileTo + 1, toDay: cycleLength });
    }
  } else {
    arcs.push({ phase: "follicular", fromDay: periodDays + 1, toDay: cycleLength });
  }

  return arcs.filter((arc) => arc.toDay >= arc.fromDay);
}

export function CycleRing({ prediction }: { prediction: CyclePrediction }) {
  const arcs = buildArcs(prediction);
  const cycleLength = prediction.expectedCycleLengthDays;
  const cycleDay = prediction.currentCycleDay;

  // Past the end of the predicted cycle the marker would wrap around and
  // point at the wrong phase, so it parks at the top instead — which is
  // exactly where a period that is due belongs.
  const markerDay =
    cycleDay !== null ? (cycleDay <= cycleLength ? cycleDay : cycleLength + 1) : null;
  const marker = markerDay !== null ? pointOnRing(markerDay, cycleLength) : null;

  const headline = prediction.isOverdue
    ? `${prediction.daysOverdue} ${prediction.daysOverdue === 1 ? "day" : "days"} late`
    : cycleDay !== null
      ? `Day ${cycleDay}`
      : "No cycle yet";

  const subline = nextPeriodSummary(prediction);

  return (
    <div className="flex flex-col items-center">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-56 w-56"
        role="img"
        aria-label={
          cycleDay !== null
            ? `Cycle day ${cycleDay} of about ${cycleLength}. ${PHASE_LABEL[prediction.currentPhase]}.`
            : "No cycle logged yet."
        }
      >
        <circle
          cx={CENTRE}
          cy={CENTRE}
          r={RADIUS}
          fill="none"
          stroke="var(--soft-sage)"
          strokeWidth={STROKE}
          // Soft sage doesn't flip with the theme; the class wins over the
          // presentation attribute in dark only, so light is untouched.
          className="dark:stroke-night-ink/15"
        />
        {arcs.map((arc) => (
          <path
            key={`${arc.phase}-${arc.fromDay}`}
            d={arcPath(arc.fromDay, arc.toDay, cycleLength)}
            fill="none"
            stroke={PHASE_COLOR[arc.phase]}
            strokeWidth={STROKE}
            // Predicted phases are drawn slightly translucent so the ring
            // reads as an estimate rather than a record of what happened.
            strokeOpacity={arc.phase === "menstrual" ? 0.95 : 0.75}
            // The unknown-phase arc is drawn in soft sage, which doesn't flip
            // with the theme; in dark it takes the same muted track tone.
            className={arc.phase === "unknown" ? "dark:stroke-night-ink/25" : undefined}
          />
        ))}

        {marker && (
          <>
            <circle
              cx={marker.x}
              cy={marker.y}
              r={11}
              fill="var(--background)"
              stroke="var(--charcoal-ink)"
              strokeWidth={3}
              // Neither --background nor --charcoal-ink flips with the theme;
              // dark-only class overrides keep the marker legible at night.
              className="dark:fill-night-card dark:stroke-night-ink"
            />
            <circle
              cx={marker.x}
              cy={marker.y}
              r={4}
              fill="var(--charcoal-ink)"
              className="dark:fill-night-ink"
            />
          </>
        )}

        <text
          x={CENTRE}
          y={CENTRE - 6}
          textAnchor="middle"
          className="fill-charcoal-ink dark:fill-night-ink"
          style={{ fontSize: 30, fontWeight: 600 }}
        >
          {headline}
        </text>
        <text
          x={CENTRE}
          y={CENTRE + 18}
          textAnchor="middle"
          className="fill-charcoal-ink/60 dark:fill-night-ink/60"
          style={{ fontSize: 11 }}
        >
          {PHASE_LABEL[prediction.currentPhase]}
        </text>
      </svg>
      <p className="mt-1 text-center text-sm text-charcoal-ink/70 dark:text-night-ink/70">{subline}</p>
    </div>
  );
}

/** Shared legend, so the ring and the calendar always mean the same thing. */
export function CycleLegend() {
  const entries: { phase: CyclePhase; label: string }[] = [
    { phase: "menstrual", label: "Period" },
    { phase: "fertile", label: "Fertile window" },
    { phase: "ovulation", label: "Ovulation" },
    { phase: "luteal", label: "Luteal" },
    { phase: "follicular", label: "Follicular" },
  ];
  return (
    <ul className="flex flex-wrap justify-center gap-x-4 gap-y-2">
      {entries.map((entry) => (
        <li key={entry.phase} className="flex items-center gap-1.5 text-xs text-charcoal-ink/70 dark:text-night-ink/70">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: PHASE_COLOR[entry.phase] }}
          />
          {entry.label}
        </li>
      ))}
    </ul>
  );
}
