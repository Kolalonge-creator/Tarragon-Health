"use client";

import { useVitalsReadings } from "@/lib/queries/vitals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { mmolLToMgDl, type Tables } from "@tarragon/shared";
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

/**
 * 53.9: "distinguish a consumer wearable estimate from a clinically
 * validated measurement — do not treat every smartwatch reading as a
 * diagnostic ECG." A synced-from-wearable reading gets the same clinical
 * classification badges as any other (BpLevelBadge etc. above don't change),
 * but this makes the provenance visible next to it rather than presenting a
 * wrist-worn estimate with the same unqualified confidence as a fingerstick
 * glucose test or a manual BP cuff reading. Manual and BLE clinical-device
 * (source='device') readings get no badge — those are already the
 * platform's two most-trusted sources and don't need a qualifier.
 */
function SourceBadge({ reading }: { reading: Tables<"vitals_readings"> }) {
  if (reading.source !== "wearable") return null;
  return (
    <span className="ml-2 inline-block rounded-full bg-charcoal-ink/10 px-2 py-0.5 text-[11px] font-medium text-charcoal-ink/60">
      Wearable estimate
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

function formatReading(reading: Tables<"vitals_readings">): string {
  switch (reading.vital_type) {
    case "blood_pressure":
      return `${reading.systolic}/${reading.diastolic} mmHg`;
    case "glucose": {
      const mmolL = reading.glucose_mmol_l;
      const mgDl = mmolL === null ? null : mmolLToMgDl(mmolL);
      return `${mmolL} mmol/L (${mgDl} mg/dL), ${reading.glucose_context ?? "—"}`;
    }
    case "weight":
      return `${reading.weight_kg} kg`;
    case "waist_circumference":
      return `${reading.waist_cm} cm (waist)`;
    case "pulse":
      return `${reading.pulse_bpm} bpm`;
    case "temperature":
      return `${reading.temperature_c}°C`;
    case "spo2":
      return `${reading.spo2_pct}%`;
    case "ketones":
      return reading.ketones_mmol_l !== null
        ? `${reading.ketones_mmol_l} mmol/L (blood ketones)`
        : `${reading.ketone_urine ?? "—"} (urine ketones)`;
    default:
      return "—";
  }
}

export function VitalsHistory({ patientId }: { patientId: string }) {
  const { data, isLoading, isError } = useVitalsReadings(patientId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.bp className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Recent readings
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600">Could not load your readings.</p>
        )}
        {data && data.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No readings logged yet.</p>
        )}
        {data && data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {data.map((reading) => (
              <li key={reading.id} className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium text-charcoal-ink">
                    {formatReading(reading)}
                    {reading.vital_type === "blood_pressure" && (
                      <BpLevelBadge reading={reading} />
                    )}
                    {reading.vital_type === "spo2" && <Spo2LevelBadge reading={reading} />}
                    {reading.vital_type === "temperature" && (
                      <TemperatureLevelBadge reading={reading} />
                    )}
                    {reading.vital_type === "pulse" && <PulseLevelBadge reading={reading} />}
                    <SourceBadge reading={reading} />
                  </p>
                  {reading.note && (
                    <p className="text-xs text-charcoal-ink/60">{reading.note}</p>
                  )}
                </div>
                <span className="text-xs text-charcoal-ink/60">
                  {formatPatientDateTime(reading.taken_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
