"use client";

import { useActionState } from "react";
import { setPatientReportedDiabetesType } from "./actions";
import { DIABETES_TYPES, DIABETES_TYPE_LABEL } from "@/lib/validation/diabetes-type";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Patient self-report of which diabetes they have. Real information — most
 * patients have known this since diagnosis — but self-report, so it's kept
 * separate from a clinician's own confirmation (patient_reported_type vs
 * confirmed_type). Once a doctor confirms a type from the clinician side,
 * that confirmation takes precedence everywhere this is read, but never
 * overwrites what the patient said.
 */
export function DiabetesTypeSelector({
  currentReported,
  confirmed,
}: {
  currentReported: string | null;
  confirmed: string | null;
}) {
  const [state, action, pending] = useActionState(setPatientReportedDiabetesType, undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Which diabetes do you have?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
      {confirmed ? (
        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
          Your care team has confirmed:{" "}
          <span className="font-medium text-deep-forest dark:text-brand-green-bright">
            {DIABETES_TYPE_LABEL[confirmed as keyof typeof DIABETES_TYPE_LABEL] ?? confirmed}
          </span>
        </p>
      ) : (
        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
          This helps your care team give you the right guidance (for example, insulin should
          never be stopped in type 1). Tell us what you were told at diagnosis; your care team
          will confirm it.
        </p>
      )}
      <form action={action} className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="diabetes_type">Type</Label>
          <Select id="diabetes_type" name="diabetes_type" defaultValue={currentReported ?? ""} required>
            <option value="" disabled>
              Select a type
            </option>
            {DIABETES_TYPES.map((t) => (
              <option key={t} value={t}>
                {DIABETES_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" disabled={pending} variant="outline" size="sm">
          {pending ? "Saving…" : "Save"}
        </Button>
      </form>
      {state?.error && <p className="text-sm text-red-600 dark:text-red-300">{state.error}</p>}
      {state?.success && <p className="text-sm text-brand-green dark:text-brand-green-bright">Saved.</p>}
      </CardContent>
    </Card>
  );
}
