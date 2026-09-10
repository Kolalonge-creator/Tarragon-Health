"use client";

import { useActionState } from "react";
import { updateGlucoseDisplayUnit } from "./glucose-unit-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";
import { type GlucoseDisplayUnit } from "@tarragon/shared";

const OPTIONS: Array<{ value: GlucoseDisplayUnit; label: string; hint: string }> = [
  { value: "mg_dl", label: "mg/dL", hint: "Most meters sold in Nigeria, e.g. 110" },
  { value: "mmol_l", label: "mmol/L", hint: "Some meters and most lab reports, e.g. 6.1" },
];

/**
 * Which unit the patient reads their own sugar figures in.
 *
 * The point of this setting is that a number on the screen should match the
 * number on the meter in their hand. It changes display and the entry form's
 * default only — readings themselves are stored in one unit throughout, so
 * switching never rewrites anything already logged, which is what the note
 * under the buttons tells the patient in their own words.
 */
export function GlucoseUnitForm({ initial }: { initial: GlucoseDisplayUnit }) {
  const [state, formAction, pending] = useActionState(updateGlucoseDisplayUnit, undefined);
  const Icon = SEMANTIC_ICON.diabetes;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon aria-hidden className="h-5 w-5 text-brand-green dark:text-brand-green-bright" />
          Blood sugar unit
        </CardTitle>
        <CardDescription>
          Pick whichever one your own meter shows, so you never have to convert.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="sr-only">Blood sugar unit</legend>
            {OPTIONS.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-charcoal-ink/10 p-3 hover:border-brand-green/40 dark:border-night-ink/15 dark:hover:border-brand-green-bright/40"
              >
                <input
                  type="radio"
                  name="glucose_display_unit"
                  value={option.value}
                  defaultChecked={initial === option.value}
                  className="mt-1 h-4 w-4 accent-brand-green"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-charcoal-ink dark:text-night-ink">
                    {option.label}
                  </span>
                  <span className="block text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                    {option.hint}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            Changing this only changes how your readings are shown. Nothing you have already logged
            is altered, and you can switch back any time.
          </p>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            {state?.success && (
              <span className="text-sm text-brand-green dark:text-brand-green-bright">Saved.</span>
            )}
            {state?.error && (
              <span className="text-sm text-red-600 dark:text-red-400">{state.error}</span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
