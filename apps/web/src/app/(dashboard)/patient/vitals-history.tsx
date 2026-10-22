"use client";

import { useAssistedEntryAttribution, useVitalsReadingsPage } from "@/lib/queries/vitals";
import { useOwnTriageResults } from "@/lib/queries/triage-results";
import { ReadingTriageNote } from "./reading-triage-note";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  assistedEntryLabel,
  DEFAULT_MEASUREMENT_UNITS,
  formatGlucose,
  formatLength,
  formatTemperature,
  formatWeight,
  type GlucoseDisplayUnit,
  type MeasurementUnits,
  type Tables,
} from "@tarragon/shared";
import { useMeasurementUnits } from "@/components/measurement-units-provider";
import { useGlucoseUnit } from "@/components/glucose-unit-provider";
import { SEMANTIC_ICON } from "@/lib/icons";
import { classifyBpLevel, BP_LEVEL_LABEL, type BpLevel } from "@/lib/rules/bp-classification";
import { classifySpo2Level, SPO2_LEVEL_LABEL, type Spo2Level } from "@/lib/rules/spo2-classification";
import { classifyPulseLevel, PULSE_LEVEL_LABEL, type PulseLevel } from "@/lib/rules/pulse-classification";
import {
  classifyTemperatureLevel,
  TEMPERATURE_LEVEL_LABEL,
  type TemperatureLevel,
} from "@/lib/rules/temperature-classification";
import { VITAL_LEVEL_BADGE_CLASSNAME as LEVEL_STYLE } from "@/lib/rules/vital-level-style";

import { formatPatientDateTime } from "@/lib/format-date";
import { ChangedMarker, EditReading } from "./reading-edit";
import { SourceBadge, WristSpo2Note } from "@/components/source-badge";
import { t } from "@tarragon/i18n";
const BP_LEVEL_STYLE: Record<Exclude<BpLevel, "unknown">, string> = LEVEL_STYLE;

function BpLevelBadge({ reading }: { reading: Tables<"vitals_readings"> }) {
  const level = classifyBpLevel(reading.systolic, reading.diastolic);
  if (level === "unknown") return null;
  return (
    <span
      className={`ml-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${BP_LEVEL_STYLE[level]}`}
    >
      {BP_LEVEL_LABEL[level]}
    </span>
  );
}

const SPO2_LEVEL_STYLE: Record<Exclude<Spo2Level, "unknown">, string> = LEVEL_STYLE;

function Spo2LevelBadge({ reading }: { reading: Tables<"vitals_readings"> }) {
  const level = classifySpo2Level(reading.spo2_pct);
  if (level === "unknown") return null;
  return (
    <span
      className={`ml-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${SPO2_LEVEL_STYLE[level]}`}
    >
      {SPO2_LEVEL_LABEL[level]}
    </span>
  );
}

const PULSE_LEVEL_STYLE: Record<Exclude<PulseLevel, "unknown">, string> = LEVEL_STYLE;

function PulseLevelBadge({ reading }: { reading: Tables<"vitals_readings"> }) {
  const level = classifyPulseLevel(reading.pulse_bpm);
  if (level === "unknown") return null;
  return (
    <span
      className={`ml-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${PULSE_LEVEL_STYLE[level]}`}
    >
      {PULSE_LEVEL_LABEL[level]}
    </span>
  );
}

const TEMPERATURE_LEVEL_STYLE: Record<Exclude<TemperatureLevel, "unknown">, string> = LEVEL_STYLE;

function TemperatureLevelBadge({ reading }: { reading: Tables<"vitals_readings"> }) {
  const level = classifyTemperatureLevel(reading.temperature_c);
  if (level === "unknown") return null;
  return (
    <span
      className={`ml-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${TEMPERATURE_LEVEL_STYLE[level]}`}
    >
      {TEMPERATURE_LEVEL_LABEL[level]}
    </span>
  );
}

function formatReading(
  reading: Tables<"vitals_readings">,
  unit: GlucoseDisplayUnit,
  units: MeasurementUnits = DEFAULT_MEASUREMENT_UNITS,
): string {
  switch (reading.vital_type) {
    case "blood_pressure":
      return `${reading.systolic}/${reading.diastolic} mmHg`;
    case "glucose": {
      // Both units, but the reader's own leads. The secondary stays: a
      // patient showing this screen to a doctor or pharmacist should not have
      // to convert for whichever unit that person thinks in.
      const primary = formatGlucose(reading.glucose_mmol_l, unit);
      const secondary = formatGlucose(reading.glucose_mmol_l, unit === "mg_dl" ? "mmol_l" : "mg_dl");
      if (primary === null) return `—, ${reading.glucose_context ?? "—"}`;
      return `${primary} (${secondary}), ${reading.glucose_context ?? "—"}`;
    }
    // In the reader's own unit; when that is not the stored one, the stored figure follows in brackets so a
    // doctor or pharmacist looking over the shoulder can read it too.
    case "weight": {
      const primary = formatWeight(reading.weight_kg, units.weight);
      return units.weight === "kg" || primary === null ? `${reading.weight_kg} kg` : `${primary} (${reading.weight_kg} kg)`;
    }
    case "waist_circumference": {
      const primary = formatLength(reading.waist_cm, units.length);
      return units.length === "cm" || primary === null ? `${reading.waist_cm} cm (waist)` : `${primary} (${reading.waist_cm} cm) waist`;
    }
    case "pulse":
      return `${reading.pulse_bpm} bpm`;
    case "temperature": {
      const primary = formatTemperature(reading.temperature_c, units.temperature);
      return units.temperature === "c" || primary === null ? `${reading.temperature_c}°C` : `${primary} (${reading.temperature_c}°C)`;
    }
    case "spo2":
      return `${reading.spo2_pct}%`;
    case "ketones":
      return reading.ketones_mmol_l !== null
        ? `${reading.ketones_mmol_l} mmol/L (blood ketones)`
        : `${reading.ketone_urine ?? "—"} (urine ketones)`;
    // S47a: water, sleep and mood keep their one number in value_numeric
    case "water_ml":
      return `${reading.value_numeric} ml (water)`;
    case "sleep_hours":
      return `${reading.value_numeric} hours (sleep)`;
    case "mood":
      return `Mood ${reading.value_numeric} of 5`;
    default:
      return "—";
  }
}

/** Said instead of "Typed by you" whenever a helper entered the reading (assisted entry). */
function AssistedEntryNote({ name, kind, viewerIsHelper }: { name: string | null; kind: "caregiver" | "pharmacy"; viewerIsHelper: boolean }) {
  return (
    <span
      data-testid="assisted-entry-note"
      className="ml-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-100"
    >
      {assistedEntryLabel(name, viewerIsHelper ? "helper" : "patient", kind)}
    </span>
  );
}

export function VitalsHistory({ patientId, viewerId }: { patientId: string; viewerId?: string }) {
  const glucoseUnit = useGlucoseUnit();
  const measurementUnits = useMeasurementUnits();
  const { data, isLoading, isError, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useVitalsReadingsPage(patientId);
  const readings = data?.pages.flatMap((p) => p.rows) ?? [];
  const assistedIds = readings.filter((r) => r.assisted_entry).map((r) => r.id);
  const { data: attribution } = useAssistedEntryAttribution(patientId, assistedIds);
  // P6: the grade the patient was shown for each reading that has one. A failed load only leaves the note out.
  const { data: triageResults } = useOwnTriageResults(readings.flatMap((r) => (r.triage_event_id ? [r.triage_event_id] : [])));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.bp className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} aria-hidden />
          Recent readings
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600 dark:text-red-300">Could not load your readings.</p>
        )}
        {!isLoading && readings.length === 0 && (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">No readings logged yet.</p>
        )}
        {readings.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
            {readings.map((reading) => (
              <li key={reading.id} className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
                    {formatReading(reading, glucoseUnit, measurementUnits)}
                    {reading.vital_type === "blood_pressure" && (
                      <BpLevelBadge reading={reading} />
                    )}
                    {reading.vital_type === "spo2" && <Spo2LevelBadge reading={reading} />}
                    {reading.vital_type === "temperature" && (
                      <TemperatureLevelBadge reading={reading} />
                    )}
                    {reading.vital_type === "pulse" && <PulseLevelBadge reading={reading} />}
                    {reading.assisted_entry ? (
                      <AssistedEntryNote
                        name={attribution?.get(reading.id)?.actorName ?? null}
                        kind={attribution?.get(reading.id)?.actorKind ?? "caregiver"}
                        viewerIsHelper={viewerId != null && reading.logged_by_profile_id === viewerId}
                      />
                    ) : (
                      <SourceBadge source={reading.source} origin={reading.entry_origin} />
                    )}
                    <ChangedMarker reading={reading} />
                  </p>
                  <WristSpo2Note source={reading.source} vitalType={reading.vital_type} />
                  {reading.entry_origin === "pharmacy_machine" && (
                    <p data-testid="pharmacy-note" className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                      {reading.place_label ? `${reading.place_label}. ` : ""}
                      {t("pharm.history_note")}
                    </p>
                  )}
                  {reading.note && (
                    <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{reading.note}</p>
                  )}
                  <ReadingTriageNote result={reading.triage_event_id ? triageResults?.get(reading.triage_event_id) : undefined} />
                  <EditReading reading={reading} />
                </div>
                <span className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                  {formatPatientDateTime(reading.taken_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {hasNextPage && (
          <div className="mt-3 flex justify-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isFetchingNextPage}
              onClick={() => fetchNextPage()}
            >
              {isFetchingNextPage ? "Loading…" : "See more"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
