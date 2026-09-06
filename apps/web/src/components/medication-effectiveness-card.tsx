import { createClient } from "@/lib/supabase/server";
import { loadMedicationEffectiveness } from "@/lib/clinical/patient-clinical-context";
import { MEDICATION_EFFECTIVENESS_DISCLAIMER } from "@/lib/rules/medication-effectiveness";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

/**
 * Medication safety pathway 64.11 — "medication started -> monitoring ->
 * outcome": a before/after view for each active BP/glucose medication.
 * Renders nothing when the patient has no medication in this view's scope
 * (see medication-effectiveness.ts) — a patient on no antihypertensive or
 * glucose-lowering drug has nothing this card can say.
 */
export async function MedicationEffectivenessCard({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const rows = await loadMedicationEffectiveness(supabase, patientId);
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Is it working?</CardTitle>
        <CardDescription>{MEDICATION_EFFECTIVENESS_DISCLAIMER}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
          {rows.map((row) => (
            <li key={row.medicationId} className="space-y-1 py-3">
              <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{row.drugName}</p>
              {!row.summary ? (
                <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                  Not enough readings yet, before and since starting this medication, to show a
                  before/after comparison.
                </p>
              ) : row.summary.vitalType === "blood_pressure" ? (
                <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">
                  Before: <span className="font-medium">{row.summary.beforeSystolic}/{row.summary.beforeDiastolic}</span>{" "}
                  ({row.summary.beforeCount} readings) → After:{" "}
                  <span className="font-medium">{row.summary.afterSystolic}/{row.summary.afterDiastolic}</span>{" "}
                  ({row.summary.afterCount} readings)
                </p>
              ) : (
                <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">
                  Before: <span className="font-medium">{row.summary.beforeGlucoseMmolL} mmol/L</span>{" "}
                  ({row.summary.beforeCount} readings) → After:{" "}
                  <span className="font-medium">{row.summary.afterGlucoseMmolL} mmol/L</span>{" "}
                  ({row.summary.afterCount} readings)
                </p>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
