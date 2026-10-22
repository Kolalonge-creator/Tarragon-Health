"use client";

import { useActionState } from "react";
import { updateMeasurementUnits } from "./measurement-units-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { MeasurementUnits } from "@tarragon/shared";

const GROUPS = [
  { name: "weight_display_unit", key: "weight", legend: "Weight", options: [{ value: "kg", label: "kilograms (kg)" }, { value: "lb", label: "pounds (lb)" }] },
  { name: "temperature_display_unit", key: "temperature", legend: "Temperature", options: [{ value: "c", label: "Celsius (°C)" }, { value: "f", label: "Fahrenheit (°F)" }] },
  { name: "length_display_unit", key: "length", legend: "Waist", options: [{ value: "cm", label: "centimetres (cm)" }, { value: "in", label: "inches (in)" }] },
] as const;

/**
 * Which units the patient reads weight, temperature and waist in. Changes how readings are shown and which unit a
 * new entry is typed in; readings are stored in one unit throughout, so nothing already logged is altered.
 */
export function MeasurementUnitsForm({ initial }: { initial: MeasurementUnits }) {
  const [state, formAction, pending] = useActionState(updateMeasurementUnits, undefined);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Units</CardTitle>
        <CardDescription>Pick the units you are used to. Your blood sugar unit is set separately above.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          {GROUPS.map((g) => (
            <fieldset key={g.name} className="space-y-2">
              <legend className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{g.legend}</legend>
              <div className="flex flex-wrap gap-3">
                {g.options.map((o) => (
                  <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-xl border border-charcoal-ink/10 px-3 py-2 text-sm dark:border-night-ink/15">
                    <input type="radio" name={g.name} value={o.value} defaultChecked={initial[g.key] === o.value} className="h-4 w-4 accent-brand-green" />
                    {o.label}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            This only changes how your readings are shown and typed in. Nothing you have already logged is altered, and you can switch back any time.
          </p>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
            {state?.success && <span className="text-sm text-brand-green dark:text-brand-green-bright">Saved.</span>}
            {state?.error && <span className="text-sm text-red-600 dark:text-red-400">{state.error}</span>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
