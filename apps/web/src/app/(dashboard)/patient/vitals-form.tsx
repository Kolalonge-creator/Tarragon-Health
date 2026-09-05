"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { logVital } from "./actions";
import type { GlucoseUnit } from "@/lib/validation/vitals";
import { vitalsReadingSchema } from "@/lib/validation/vitals";
import { crosscheckVital, type VitalCrosscheck } from "@/lib/vitals/plausibility";
import { VITAL_TYPES, type VitalType } from "@/lib/vitals/vital-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError, FormSuccess, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";

type KetoneKind = "blood" | "urine";

export function VitalsForm({
  patientId,
  lockedType,
  title,
}: {
  patientId: string;
  /** When set, hides the reading-type selector and locks the form to this
   * type — powers the /patient/quick-log/[type] deep-link pages so a
   * WhatsApp/SMS reminder can link straight to "log glucose" with no extra
   * taps, instead of landing on the full dashboard and hunting for it. */
  lockedType?: VitalType;
  title?: string;
}) {
  const [vitalType, setVitalType] = useState<VitalType>(lockedType ?? "blood_pressure");
  const [glucoseUnit, setGlucoseUnit] = useState<GlucoseUnit>("mmol_l");
  const [ketoneKind, setKetoneKind] = useState<KetoneKind>("blood");
  const [state, formAction, pending] = useActionState(logVital, undefined);
  const queryClient = useQueryClient();

  // Crosscheck nudge: when a reading lands outside the normal band we ask the
  // patient to confirm it before saving, and show how to take a cleaner
  // reading — but never block it (a real abnormal value must still reach the
  // record). confirmedRef is a one-shot bypass so the confirm button can
  // re-submit the same form past the guard without waiting on a state update.
  const formRef = useRef<HTMLFormElement>(null);
  const confirmedRef = useRef(false);
  const [crosscheck, setCrosscheck] = useState<VitalCrosscheck | null>(null);

  // The action returns one message for the reading as a whole rather than a
  // per-field one, so every reading input for the selected type points at the
  // same alert and is marked invalid together. Announcing it at all is the
  // change that matters: before this, a rejected reading was inserted silently
  // below the button and a screen-reader user got no feedback whatsoever.
  const errorId = fieldErrorId("vitals-form");
  const readingErrorProps = fieldErrorProps(errorId, Boolean(state?.error));

  useEffect(() => {
    if (state?.success) {
      queryClient.invalidateQueries({ queryKey: ["vitals-readings", patientId] });
    }
  }, [state?.success, queryClient, patientId]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (confirmedRef.current) {
      confirmedRef.current = false; // consume the one-shot bypass, let the action run
      return;
    }
    const raw = Object.fromEntries(new FormData(event.currentTarget).entries());
    const parsed = vitalsReadingSchema.safeParse(raw);
    // If it doesn't even parse, let the Server Action surface the field error.
    if (!parsed.success) return;
    const result = crosscheckVital(parsed.data);
    if (result) {
      event.preventDefault();
      setCrosscheck(result);
    }
  }

  function confirmAndSave() {
    confirmedRef.current = true;
    setCrosscheck(null);
    formRef.current?.requestSubmit();
  }

  // Any edit (including changing the reading type) invalidates a pending
  // crosscheck so the patient re-confirms the corrected value.
  function resetGuard() {
    confirmedRef.current = false;
    setCrosscheck((current) => (current ? null : current));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title ?? "Log a reading"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          ref={formRef}
          action={formAction}
          onSubmit={handleSubmit}
          onChange={resetGuard}
          className="space-y-4"
        >
          <input type="hidden" name="vital_type" value={vitalType} />
          {!lockedType && (
            <div className="space-y-1.5">
              <Label htmlFor="vital_type_select">Reading type</Label>
              <Select
                id="vital_type_select"
                value={vitalType}
                onChange={(event) => setVitalType(event.target.value as VitalType)}
              >
                {VITAL_TYPES.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {vitalType === "blood_pressure" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="systolic">Systolic (mmHg)</Label>
                <Input id="systolic" name="systolic" type="number" required {...readingErrorProps} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="diastolic">Diastolic (mmHg)</Label>
                <Input id="diastolic" name="diastolic" type="number" required {...readingErrorProps} />
              </div>
            </div>
          )}

          {vitalType === "glucose" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="glucose_value">Glucose</Label>
                <div className="flex gap-2">
                  <Input
                    id="glucose_value"
                    name="glucose_value"
                    type="number"
                    step={glucoseUnit === "mmol_l" ? "0.1" : "1"}
                    required
                    className="flex-1"
                    {...fieldErrorProps(
                      errorId,
                      Boolean(state?.error),
                      "glucose-unit-hint"
                    )}
                  />
                  <input type="hidden" name="glucose_unit" value={glucoseUnit} />
                  <Select
                    aria-label="Glucose unit"
                    value={glucoseUnit}
                    onChange={(event) => setGlucoseUnit(event.target.value as GlucoseUnit)}
                    className="w-28"
                  >
                    <option value="mmol_l">mmol/L</option>
                    <option value="mg_dl">mg/dL</option>
                  </Select>
                </div>
                <p
                  id="glucose-unit-hint"
                  className="text-xs text-charcoal-ink/60 dark:text-night-ink/60"
                >
                  {glucoseUnit === "mmol_l" ? "e.g. 5.6 mmol/L" : "e.g. 100 mg/dL"}; check
                  your glucometer&apos;s display unit before entering.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="glucose_context">Context</Label>
                <Select
                  id="glucose_context"
                  name="glucose_context"
                  required
                  defaultValue=""
                  {...readingErrorProps}
                >
                  <option value="" disabled>
                    Select context
                  </option>
                  <option value="fasting">Fasting</option>
                  <option value="pre_meal">Before a meal</option>
                  <option value="post_meal">2 hours after a meal</option>
                  <option value="bedtime">Bedtime</option>
                  <option value="night">During the night</option>
                  <option value="random">Random</option>
                </Select>
              </div>
            </div>
          )}

          {vitalType === "ketones" && (
            <div className="space-y-4">
              <p className="rounded-md bg-brand-green/5 dark:bg-brand-green/15 p-3 text-xs text-charcoal-ink/70 dark:text-night-ink/70">
                Ketone testing is <strong>optional</strong>: only if you have a blood ketone
                meter or urine strips. Most people don&apos;t, and that&apos;s fine. If your
                sugar is high and you can&apos;t test ketones, just log your glucose reading and
                your care team will contact you to check how you&apos;re feeling and guide you.
              </p>
              <input type="hidden" name="ketone_kind" value={ketoneKind} />
              <div className="space-y-1.5">
                <Label htmlFor="ketone_kind_select">Ketone test</Label>
                <Select
                  id="ketone_kind_select"
                  value={ketoneKind}
                  onChange={(event) => setKetoneKind(event.target.value as KetoneKind)}
                >
                  <option value="blood">Blood ketone meter (mmol/L)</option>
                  <option value="urine">Urine dipstick</option>
                </Select>
              </div>
              {ketoneKind === "blood" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="ketones_mmol_l">Blood ketones (mmol/L)</Label>
                  <Input
                    id="ketones_mmol_l"
                    name="ketones_mmol_l"
                    type="number"
                    step="0.1"
                    required
                    {...readingErrorProps}
                  />
                  <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                    Test your ketones if your glucose stays high or you feel unwell,
                    especially if you have type 1 diabetes.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="ketone_urine">Urine ketone level</Label>
                  <Select
                    id="ketone_urine"
                    name="ketone_urine"
                    required
                    defaultValue=""
                    {...readingErrorProps}
                  >
                    <option value="" disabled>
                      Match the strip colour
                    </option>
                    <option value="negative">Negative</option>
                    <option value="trace">Trace</option>
                    <option value="small">Small</option>
                    <option value="moderate">Moderate</option>
                    <option value="large">Large</option>
                  </Select>
                </div>
              )}
            </div>
          )}

          {vitalType === "weight" && (
            <div className="space-y-1.5">
              <Label htmlFor="weight_kg">Weight (kg)</Label>
              <Input
                id="weight_kg"
                name="weight_kg"
                type="number"
                step="0.1"
                required
                {...readingErrorProps}
              />
            </div>
          )}

          {vitalType === "pulse" && (
            <div className="space-y-1.5">
              <Label htmlFor="pulse_bpm">Pulse (bpm)</Label>
              <Input id="pulse_bpm" name="pulse_bpm" type="number" required {...readingErrorProps} />
            </div>
          )}

          {vitalType === "temperature" && (
            <div className="space-y-1.5">
              <Label htmlFor="temperature_c">Temperature (°C)</Label>
              <Input
                id="temperature_c"
                name="temperature_c"
                type="number"
                step="0.1"
                required
                {...readingErrorProps}
              />
            </div>
          )}

          {vitalType === "spo2" && (
            <div className="space-y-1.5">
              <Label htmlFor="spo2_pct">SpO2 (%)</Label>
              <Input id="spo2_pct" name="spo2_pct" type="number" required {...readingErrorProps} />
            </div>
          )}

          {vitalType === "waist_circumference" && (
            <div className="space-y-1.5">
              <Label htmlFor="waist_cm">Waist circumference (cm)</Label>
              <Input
                id="waist_cm"
                name="waist_cm"
                type="number"
                step="0.5"
                required
                {...fieldErrorProps(errorId, Boolean(state?.error), "waist-measure-hint")}
              />
              <p
                id="waist-measure-hint"
                className="text-xs text-charcoal-ink/60 dark:text-night-ink/60"
              >
                Measure around your middle, just above the hip bones, after breathing out.
                A raised measurement is 94 cm or more for men, 80 cm or more for women.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="note">Note (optional)</Label>
            <Input
              id="note"
              name="note"
              type="text"
              maxLength={500}
              {...fieldErrorProps(errorId, false, "vitals-note-hint")}
            />
            <p id="vitals-note-hint" className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              Anything worth remembering about this reading. Up to 500 characters.
            </p>
          </div>

          {crosscheck && (
            <div
              role="alert"
              className="rounded-lg border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/15 p-3 text-sm"
            >
              <p className="font-medium text-amber-900 dark:text-amber-300">{crosscheck.message}</p>
              <p className="mt-1 text-amber-900/80 dark:text-amber-300/90">Tips for an accurate reading:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-amber-900/80 dark:text-amber-300/90">
                {crosscheck.tips.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" size="sm" disabled={pending} onClick={confirmAndSave}>
                  {pending ? "Saving…" : "Yes, this reading is correct: save it"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setCrosscheck(null)}
                >
                  I&apos;ll re-check it
                </Button>
              </div>
            </div>
          )}

          <FormError id={errorId} message={state?.error} />
          <FormSuccess message={state?.success && "Reading logged."} />

          {!crosscheck && (
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save reading"}
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
