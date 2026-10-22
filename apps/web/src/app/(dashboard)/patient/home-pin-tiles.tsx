import Link from "next/link";
import { Suspense } from "react";
import {
  formatGlucose,
  GLUCOSE_UNIT_LABEL,
  HOME_PIN_LABEL,
  isHomeValuePin,
  type GlucoseDisplayUnit,
  type HomePinKey,
} from "@tarragon/shared";
import { StatTile } from "@/components/ui/stat-tile";
import { statTileValue } from "@/components/ui/stat-tile-value";
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

async function PinGrid(props: HomePinTilesProps) {
  const { patientId, pins, stats, glucoseUnit, screeningsDue, bpTileProps } = props;
  const { values: vitalValues, failed: failedVitals } = await getPinnedVitalValues(patientId, pins);

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {pins.map((pin) => {
        const icon = HOME_PIN_ICON[pin];
        switch (pin) {
          case "bp":
            return (
              <Tile key={pin} pin={pin}>
                <StatTile
                  icon={icon}
                  label="Latest BP"
                  {...statTileValue(
                    stats.latestBp ? `${stats.latestBp.systolic}/${stats.latestBp.diastolic}` : null,
                    "No reading yet",
                    "mmHg",
                  )}
                  {...bpTileProps}
                />
              </Tile>
            );
          case "glucose":
            return (
              <Tile key={pin} pin={pin}>
                <StatTile
                  icon={icon}
                  label="Latest glucose"
                  // In the reader's own unit, so the tile matches the number on their meter.
                  {...statTileValue(
                    formatGlucose(stats.latestGlucoseMmolL, glucoseUnit, { withUnit: false }),
                    "No reading yet",
                    GLUCOSE_UNIT_LABEL[glucoseUnit],
                  )}
                />
              </Tile>
            );
          case "active_meds":
            return (
              <Tile key={pin} pin={pin}>
                <StatTile
                  icon={icon}
                  label="Active meds"
                  {...statTileValue(
                    stats.activeMedicationCount === 0 ? null : stats.activeMedicationCount,
                    "None on your list yet",
                  )}
                />
              </Tile>
            );
          case "doses_today":
            return (
              <Tile key={pin} pin={pin}>
                <StatTile
                  icon={icon}
                  label="Doses today"
                  // dosesTotal counts scheduled slots, so 0 means "nothing is due today", not "none taken".
                  {...statTileValue(
                    stats.dosesTotal === 0 ? null : `${stats.dosesTaken}/${stats.dosesTotal}`,
                    "Nothing due today",
                  )}
                />
              </Tile>
            );
          case "screenings":
            return (
              <Tile key={pin} pin={pin}>
                <StatTile
                  icon={icon}
                  label={HOME_PIN_LABEL[pin]}
                  {...(screeningsDue.hasRiskAssessment
                    ? { value: String(screeningsDue.count) }
                    : { empty: { hint: "None scheduled yet" } })}
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
                  <StatTile
                    icon={icon}
                    label={HOME_PIN_LABEL[pin]}
                    {...statTileValue(reading?.value, hint, reading?.unit)}
                  />
                </Tile>
              );
            }
            // A shortcut: the page it opens has the detail, so the tile does not pretend to a number.
            return (
              <Tile key={pin} pin={pin}>
                <StatTile icon={icon} label={HOME_PIN_LABEL[pin]} empty={{ hint: "Tap to open" }} />
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
        <div aria-hidden className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {props.pins.map((pin) => (
            <div key={pin} className="h-24 animate-pulse rounded-xl bg-charcoal-ink/[0.07] dark:bg-night-ink/10" />
          ))}
        </div>
      }
    >
      <PinGrid {...props} />
    </Suspense>
  );
}
