"use client";

import { useVitalsReadings } from "@/lib/queries/vitals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { mmolLToMgDl, type Tables } from "@tarragon/shared";
import { SEMANTIC_ICON } from "@/lib/icons";
import { classifyBpLevel, BP_LEVEL_LABEL, type BpLevel } from "@/lib/rules/bp-classification";

// Clinical dashboard status colours (a separate system from brand colour, per
// the brand guide). Non-diagnostic label; the actual escalation is raised
// server-side by the BP red-flag trigger.
const BP_LEVEL_STYLE: Record<Exclude<BpLevel, "unknown">, string> = {
  green: "bg-emerald-100 text-emerald-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800",
  emergency: "bg-red-600 text-white",
};

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

function formatReading(reading: Tables<"vitals_readings">): string {
  switch (reading.vital_type) {
    case "blood_pressure":
      return `${reading.systolic}/${reading.diastolic} mmHg`;
    case "glucose": {
      const mmolL = reading.glucose_mmol_l;
      const mgDl = mmolL === null ? null : mmolLToMgDl(mmolL);
      return `${mmolL} mmol/L (${mgDl} mg/dL) — ${reading.glucose_context ?? "—"}`;
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
                  </p>
                  {reading.note && (
                    <p className="text-xs text-charcoal-ink/60">{reading.note}</p>
                  )}
                </div>
                <span className="text-xs text-charcoal-ink/60">
                  {new Date(reading.taken_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
