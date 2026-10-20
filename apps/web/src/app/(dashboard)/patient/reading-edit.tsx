"use client";

import { useActionState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Tables } from "@tarragon/shared";
import { en } from "@tarragon/i18n";
import { GLUCOSE_UNIT_LABEL } from "@tarragon/shared";
import { useGlucoseUnit } from "@/components/glucose-unit-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/ui/form-error";
import { correctOwnReading, type ObservationActionState } from "./observation-actions";

/**
 * S47a (BUILD-SPEC-v5 4.7): the "Changed" marker and the edit control for a logged number.
 *
 * Nothing is overwritten. A change makes a new row that points at the old one (S05b); the chart and the list show the new number, and this marker
 * says in words that it was changed (colour is never the only signal). Blood pressure is not editable here, and neither is anything the care team
 * recorded or reviewed: the database refuses those and the control is not offered.
 */
export const EDITABLE_VITAL_TYPES = [
  "glucose",
  "weight",
  "waist_circumference",
  "pulse",
  "temperature",
  "spo2",
  "water_ml",
  "sleep_hours",
  "mood",
] as const;

export function canOfferEdit(reading: Pick<Tables<"vitals_readings">, "vital_type" | "source" | "validated_by" | "logged_by_profile_id" | "patient_id">): boolean {
  return (
    (EDITABLE_VITAL_TYPES as readonly string[]).includes(reading.vital_type) &&
    reading.source === "manual" &&
    reading.validated_by === null &&
    (reading.logged_by_profile_id === null || reading.logged_by_profile_id === reading.patient_id)
  );
}

export function ChangedMarker({
  reading,
}: {
  reading: Pick<Tables<"vitals_readings">, "supersedes_id"> & Partial<Pick<Tables<"vitals_readings">, "patient_id" | "logged_by_profile_id">>;
}) {
  if (!reading.supersedes_id) return null;
  // a replacement entered by someone other than the person (the care team, a supporter) is not worded as her own change
  const byOther = Boolean(reading.logged_by_profile_id && reading.patient_id && reading.logged_by_profile_id !== reading.patient_id);
  const words = byOther ? en["observation.changed.a11y_other"] : en["observation.changed.a11y"];
  return (
    <span
      className="ml-2 inline-block rounded-full border border-charcoal-ink/30 px-2 py-0.5 text-[11px] font-medium text-charcoal-ink dark:border-night-ink/40 dark:text-night-ink"
      title={words}
      aria-label={words}
    >
      {en["observation.changed.marker"]}
    </span>
  );
}

export function EditReading({ reading }: { reading: Tables<"vitals_readings"> }) {
  const [state, action, pending] = useActionState<ObservationActionState, FormData>(correctOwnReading, undefined);
  const queryClient = useQueryClient();
  const glucoseUnit = useGlucoseUnit();
  // refresh the lists after the server answered (not on submit, which would race the action and show the old number)
  useEffect(() => {
    if (!state?.success) return;
    void queryClient.invalidateQueries({ queryKey: ["vitals-readings-page"] });
    void queryClient.invalidateQueries({ queryKey: ["vitals-readings"] });
    void queryClient.invalidateQueries({ queryKey: ["vitals-trend"] });
  }, [state, queryClient]);
  if (!canOfferEdit(reading)) return null;
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer text-deep-forest underline dark:text-brand-green-bright">Change this number</summary>
      <form action={action} className="mt-2 space-y-2" noValidate>
        <input type="hidden" name="reading_id" value={reading.id} />
        <input type="hidden" name="vital_type" value={reading.vital_type} />
        {reading.vital_type === "glucose" ? <input type="hidden" name="glucose_unit" value={glucoseUnit} /> : null}
        <div className="space-y-1">
          <Label htmlFor={`new_value_${reading.id}`}>The right number{reading.vital_type === "glucose" ? ` (${GLUCOSE_UNIT_LABEL[glucoseUnit]})` : ""}</Label>
          <Input id={`new_value_${reading.id}`} name="new_value" type="number" step="any" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`reason_${reading.id}`}>What was wrong?</Label>
          <Input id={`reason_${reading.id}`} name="reason" type="text" minLength={5} maxLength={300} required />
        </div>
        <p className="text-charcoal-ink/60 dark:text-night-ink/60">The first number is kept in your history, and your chart shows this one with a Changed marker.</p>
        <FormError id={`edit-error-${reading.id}`} message={state?.error} />
        {state?.success ? <p role="status">Changed. Thank you.</p> : null}
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save the change"}
        </Button>
      </form>
    </details>
  );
}
