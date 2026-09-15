"use client";

import { useActionState } from "react";
import { confirmDiabetesType } from "./foot-assessment-actions";
import { DIABETES_TYPES, DIABETES_TYPE_LABEL } from "@/lib/validation/diabetes-type";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Clinician confirmation of a patient's diabetes type. Drives real behaviour
 * once confirmed: the type-1 suspicion heuristic on the glucose red-flag
 * engine (glucose-red-flags.ts::suspectsType1) stands down, and this is the
 * authoritative record for anything that needs to distinguish type 1 from
 * type 2 (insulin is never optional in type 1; the metformin-first ladder
 * assumes type 2). Never overwrites the patient's own self-report — the two
 * are independent columns on patient_diabetes_profile.
 */
export function DiabetesTypeForm({
  patientId,
  patientReportedType,
}: {
  patientId: string;
  patientReportedType?: string | null;
}) {
  const [state, action, pending] = useActionState(confirmDiabetesType, undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Confirm diabetes type</CardTitle>
      </CardHeader>
      <CardContent>
        {patientReportedType && (
          <p className="mb-3 text-xs text-charcoal-ink/60">
            Patient self-reported:{" "}
            <span className="font-medium text-deep-forest">
              {DIABETES_TYPE_LABEL[patientReportedType as keyof typeof DIABETES_TYPE_LABEL] ??
                patientReportedType}
            </span>
            . Confirm or correct it below.
          </p>
        )}
        <form action={action} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="patient_id" value={patientId} />
          <div className="space-y-1.5">
            <Label htmlFor="clinician_diabetes_type">Type</Label>
            <Select
              id="clinician_diabetes_type"
              name="diabetes_type"
              defaultValue={patientReportedType ?? ""}
              required
            >
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
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Confirm"}
          </Button>
        </form>
        {state?.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
        {state?.success && <p className="mt-2 text-sm text-brand-green">Confirmed.</p>}
      </CardContent>
    </Card>
  );
}
