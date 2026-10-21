"use client";

import { useActionState } from "react";
import { recordCuffCheckPair } from "./cuff-check-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Enter the clinic reading and the patient's own cuff reading taken together at a visit. Stored apart from the home log; clinician-only. */
export function CuffCheckForm({ patientId }: { patientId: string }) {
  const [state, action, pending] = useActionState(recordCuffCheckPair, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="patient_id" value={patientId} />
      <p className="text-sm text-charcoal-ink/70">
        Take the clinic reading and a reading with the patient&apos;s own cuff at the same visit, one straight after the other, and enter both. Several pairs over time show
        whether the patient&apos;s cuff reads differently from yours. This is about the cuff, not the patient, and it is not shown to the patient.
      </p>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="sr-only">Readings</legend>
        <div className="space-y-1.5">
          <Label htmlFor="cuff-clinic-systolic">Clinic cuff, systolic</Label>
          <Input id="cuff-clinic-systolic" name="clinic_systolic" type="number" inputMode="numeric" min={60} max={260} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cuff-clinic-diastolic">Clinic cuff, diastolic</Label>
          <Input id="cuff-clinic-diastolic" name="clinic_diastolic" type="number" inputMode="numeric" min={30} max={160} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cuff-own-systolic">Patient&apos;s own cuff, systolic</Label>
          <Input id="cuff-own-systolic" name="own_systolic" type="number" inputMode="numeric" min={60} max={260} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cuff-own-diastolic">Patient&apos;s own cuff, diastolic</Label>
          <Input id="cuff-own-diastolic" name="own_diastolic" type="number" inputMode="numeric" min={30} max={160} required />
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="cuff-measured-at">Measured</Label>
          <Input id="cuff-measured-at" name="measured_at" type="datetime-local" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cuff-device-label">Patient&apos;s cuff (brand and model, optional)</Label>
          <Input id="cuff-device-label" name="device_label" type="text" maxLength={80} />
        </div>
      </div>
      {state?.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
      {state?.success ? <p role="status" className="text-sm text-green-800">Saved.</p> : null}
      <Button type="submit" className="min-h-11" disabled={pending}>Save the pair</Button>
    </form>
  );
}
