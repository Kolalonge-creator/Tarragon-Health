"use client";

import { useVitalsReadings } from "@/lib/queries/vitals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { mmolLToMgDl, type Tables } from "@tarragon/shared";
import { SEMANTIC_ICON } from "@/lib/icons";

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
    case "waist_circumference":
      return `${reading.waist_cm} cm`;
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
