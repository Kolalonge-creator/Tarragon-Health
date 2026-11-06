import Link from "next/link";
import { Suspense } from "react";
import {
  formatGlucose,
  GLUCOSE_UNIT_LABEL,
  HOME_PIN_LABEL,
  isHomeValuePin,
  type GlucoseDisplayUnit,
  type MeasurementUnits,
  type HomePinKey,
} from "@tarragon/shared";
import { STATUS_CLASSES } from "@tarragon/ui/status";
import { createClient } from "@/lib/supabase/server";
import { BigNumberTile } from "@/app/(dashboard)/patient/home/big-number-tile";
import { DoseBars } from "@/components/charts/dose-bars";
import { getPinSeries, type PinSeries } from "@/lib/patient/home-pin-series";
import { trendWord, whenLabel } from "@/lib/patient/trend-word";
import { loadDoseHistory } from "@/lib/medicines/dose-history-data";
import { HOME_PIN_HREF, HOME_PIN_ICON } from "@/lib/patient/home-pin-targets";
import { getPinnedVitalValues } from "@/lib/patient/home-pins";
import type { PatientSummaryStats } from "@/app/(dashboard)/patient/summary";

type BpTileProps = {
  tintClassName?: string;
  iconClassName?: string;
  status?: { text: string; tone: "green" | "amber" | "red" };
};

export interface HomePinTilesProps {
  patientId: string;
  pins: readonly HomePinKey[];
  stats: PatientSummaryStats;
  glucoseUnit: GlucoseDisplayUnit;
  units: MeasurementUnits;
  /** Only meaningful once a risk assessment exists; otherwise the tile says nothing is scheduled. */
  screeningsDue: { hasRiskAssessment: boolean; count: number };
  bpTileProps: BpTileProps;
}

function Tile({ pin, children }: { pin: HomePinKey; children: React.ReactNode }) {
  return (
    // No aria-label here: it would replace the tile's own text, and the reading is the point.
    <Link
      href={HOME_PIN_HREF[pin]}
      className="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green"
    >
      {children}
    </Link>
  );
}

const STATUS_TEXT = {
  green: STATUS_CLASSES.normal.text,
  amber: STATUS_CLASSES.attention.text,
  red: STATUS_CLASSES.critical.text,
} as const;

/** "Today, 08:10 · Steady this month", or whichever half exists. */
function detailFor(series: PinSeries | "failed" | undefined, nowMs: number): string | null {
  if (!series || series === "failed" || series.latestAt === null) return null;
  return [whenLabel(series.latestAt, nowMs), trendWord(series.points, nowMs)].filter(Boolean).join(" · ");
}

function pointsFor(series: PinSeries | "failed" | undefined): PinSeries["points"] | undefined {
  return series && series !== "failed" ? series.points : undefined;
}

/** Data + date work lives outside the component body (react-hooks/purity). */
async function loadGrid(patientId: string, pins: readonly HomePinKey[], units: MeasurementUnits) {
  const nowMs = Date.now();
  const [vitals, series, doses] = await Promise.all([
    getPinnedVitalValues(patientId, pins, units),
    getPinSeries(patientId, pins, nowMs),
    pins.includes("doses_today") ? loadDoseHistory(await createClient(), patientId, nowMs) : Promise.resolve(null),
  ]);
  return { nowMs, vitals, series, doses };
}

async function PinGrid(props: HomePinTilesProps) {
  const { patientId, pins, stats, glucoseUnit, units, screeningsDue, bpTileProps } = props;
  const { nowMs, vitals, series, doses } = await loadGrid(patientId, pins, units);
  const { values: vitalValues, failed: failedVitals } = vitals;

  return (
    <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 lg:grid-cols-4">
      {pins.map((pin) => {
        const icon = HOME_PIN_ICON[pin];
        switch (pin) {
          case "bp":
            return (
              <Tile key={pin} pin={pin}>
                <BigNumberTile
                  icon={icon}
                  label="Blood pressure"
                  {...(stats.latestBp ? { value: `${stats.latestBp.systolic}/${stats.latestBp.diastolic}`, unit: "mmHg" } : { empty: "No reading yet" })}
                  status={bpTileProps.status ? { text: bpTileProps.status.text, className: STATUS_TEXT[bpTileProps.status.tone] } : null}
                  tintClassName={bpTileProps.tintClassName}
                  iconClassName={bpTileProps.iconClassName}
                  detail={detailFor(series.bp, nowMs)}
                  points={pointsFor(series.bp)}
                  chartLabel="Top number of your blood pressure, last 30 days"
                />
              </Tile>
            );
          case "glucose": {
            const shown = formatGlucose(stats.latestGlucoseMmolL, glucoseUnit, { withUnit: false });
            return (
              <Tile key={pin} pin={pin}>
                <BigNumberTile
                  icon={icon}
                  label="Blood sugar"
                  // In the reader's own unit, so the tile matches the number on their meter.
                  {...(shown ? { value: shown, unit: GLUCOSE_UNIT_LABEL[glucoseUnit] } : { empty: "No reading yet" })}
                  detail={detailFor(series.glucose, nowMs)}
                  points={pointsFor(series.glucose)}
                />
              </Tile>
            );
          }
          case "active_meds":
            return (
              <Tile key={pin} pin={pin}>
                <BigNumberTile
                  icon={icon}
                  label="Active medicines"
                  {...(stats.activeMedicationCount === 0 ? { empty: "None on your list yet" } : { value: String(stats.activeMedicationCount) })}
                />
              </Tile>
            );
          case "doses_today": {
            // dosesTotal counts scheduled slots, so 0 means "nothing is due today", not "none taken".
            const today = stats.dosesTotal === 0 ? "Nothing due today" : `Today: ${stats.dosesTaken} of ${stats.dosesTotal} so far`;
            if (!doses || !doses.ok) {
              // The week could not be worked out (a failed read, or day-tied doses whose times could not be read): today's count
              // still loaded, so it leads, and the line under it says the week did not.
              return (
                <Tile key={pin} pin={pin}>
                  <BigNumberTile
                    icon={icon}
                    label="Doses today"
                    {...(stats.dosesTotal === 0 ? { empty: "Nothing due today" } : { value: `${stats.dosesTaken} of ${stats.dosesTotal}` })}
                    detail={doses ? "The last 7 days could not load just now" : null}
                  />
                </Tile>
              );
            }
            const week = doses.history.last7;
            const last7Days = doses.history.days.slice(-7);
            return (
              <Tile key={pin} pin={pin}>
                <BigNumberTile
                  icon={icon}
                  label="Doses, last 7 days"
                  {...(week.percent !== null
                    ? { value: `${week.percent}%`, unit: `${week.taken} of ${week.due}` }
                    : { empty: week.due === 0 ? "Nothing was due" : `${week.taken} of ${week.due} marked taken` })}
                  detail={today}
                  chart={week.due > 0 ? <DoseBars days={last7Days} compact /> : undefined}
                />
              </Tile>
            );
          }
          case "screenings":
            return (
              <Tile key={pin} pin={pin}>
                <BigNumberTile
                  icon={icon}
                  label={HOME_PIN_LABEL[pin]}
                  {...(screeningsDue.hasRiskAssessment ? { value: String(screeningsDue.count) } : { empty: "None scheduled yet" })}
                />
              </Tile>
            );
          default: {
            if (isHomeValuePin(pin)) {
              const reading = vitalValues[pin];
              // A failed read must not look like "no reading yet": a real reading may exist.
              const hint = failedVitals.includes(pin) ? "Couldn't load, tap to open" : "No reading yet";
              return (
                <Tile key={pin} pin={pin}>
                  <BigNumberTile
                    icon={icon}
                    label={HOME_PIN_LABEL[pin]}
                    {...(reading ? { value: reading.value, unit: reading.unit } : { empty: hint })}
                    detail={detailFor(series[pin], nowMs)}
                    points={pointsFor(series[pin])}
                  />
                </Tile>
              );
            }
            // A shortcut: the page it opens has the detail, so the tile does not pretend to a number.
            return (
              <Tile key={pin} pin={pin}>
                <BigNumberTile icon={icon} label={HOME_PIN_LABEL[pin]} empty="Tap to open" />
              </Tile>
            );
          }
        }
      })}
    </div>
  );
}

/**
 * The patient's pinned tiles. The vitals that are not in the summary stats load
 * on their own so the rest of the Overview does not wait for them.
 */
export function HomePinTiles(props: HomePinTilesProps) {
  if (props.pins.length === 0) return null;
  return (
    <Suspense
      fallback={
        <div aria-hidden className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 lg:grid-cols-4">
          {props.pins.map((pin) => (
            <div key={pin} className="h-40 animate-pulse rounded-xl bg-charcoal-ink/[0.07] dark:bg-night-ink/10" />
          ))}
        </div>
      }
    >
      <PinGrid {...props} />
    </Suspense>
  );
}
