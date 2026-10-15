"use client";

import { useActionState } from "react";
import { recordClinicBp } from "./clinic-bp-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Enter a blood pressure measured at a visit. Stored apart from the patient's home readings; clinician-only. */
export function ClinicBpForm({ patientId }: { patientId: string }) {
  const [state, action, pending] = useActionState(recordClinicBp, undefined);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Clinic blood pressure</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <input type="hidden" name="patient_id" value={patientId} />
          <p className="text-sm text-charcoal-ink/70">
            A reading measured at a visit. It is kept apart from the patient&apos;s home log, raises no home alert and is not shown to the patient.
            With a complete seven-day home average it can bring up a possible white-coat or masked pattern for your review once that rule is switched on.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="clinic-systolic">Systolic</Label>
              <Input id="clinic-systolic" name="systolic" type="number" inputMode="numeric" min={60} max={260} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="clinic-diastolic">Diastolic</Label>
              <Input id="clinic-diastolic" name="diastolic" type="number" inputMode="numeric" min={30} max={160} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="clinic-measured-at">Measured</Label>
              <Input id="clinic-measured-at" name="measured_at" type="datetime-local" required />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="clinic-note">Note (optional)</Label>
            <Input id="clinic-note" name="note" type="text" maxLength={200} />
          </div>
          {state?.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
          {state?.success ? <p role="status" className="text-sm text-green-800">Saved.</p> : null}
          <Button type="submit" className="min-h-11" disabled={pending}>Save clinic reading</Button>
        </form>
      </CardContent>
    </Card>
  );
}
