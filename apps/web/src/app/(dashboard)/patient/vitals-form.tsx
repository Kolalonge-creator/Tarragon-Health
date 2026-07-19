"use client";

import { useActionState, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { logVital } from "./actions";
import type { GlucoseUnit } from "@/lib/validation/vitals";
import { checkVitalReading, type ReadingCheckInput, type ReadingCheckResult } from "@/lib/vitals/reading-check";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const VITAL_TYPES = [
  { value: "blood_pressure", label: "Blood pressure" },
  { value: "glucose", label: "Glucose" },
  { value: "weight", label: "Weight" },
  { value: "pulse", label: "Pulse" },
  { value: "temperature", label: "Temperature" },
  { value: "spo2", label: "SpO2" },
] as const;

type VitalType = (typeof VITAL_TYPES)[number]["value"];

/** Builds the cross-check input from the submitted form, or null when the
 *  fields are empty/non-numeric (leave those to the server's hard validation). */
function buildCheckInput(
  vitalType: VitalType,
  glucoseUnit: GlucoseUnit,
  form: FormData
): ReadingCheckInput | null {
  const num = (name: string): number => Number(form.get(name));
  const has = (...names: string[]): boolean =>
    names.every((n) => {
      const v = form.get(n);
      return typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v));
    });

  switch (vitalType) {
    case "blood_pressure":
      return has("systolic", "diastolic")
        ? { vitalType, systolic: num("systolic"), diastolic: num("diastolic") }
        : null;
    case "glucose":
      return has("glucose_value") ? { vitalType, value: num("glucose_value"), unit: glucoseUnit } : null;
    case "weight":
      return has("weight_kg") ? { vitalType, weightKg: num("weight_kg") } : null;
    case "pulse":
      return has("pulse_bpm") ? { vitalType, pulseBpm: num("pulse_bpm") } : null;
    case "temperature":
      return has("temperature_c") ? { vitalType, temperatureC: num("temperature_c") } : null;
    case "spo2":
      return has("spo2_pct") ? { vitalType, spo2Pct: num("spo2_pct") } : null;
  }
}

export function VitalsForm({ patientId }: { patientId: string }) {
  const [vitalType, setVitalType] = useState<VitalType>("blood_pressure");
  const [glucoseUnit, setGlucoseUnit] = useState<GlucoseUnit>("mmol_l");
  const [state, formAction, pending] = useActionState(logVital, undefined);
  const queryClient = useQueryClient();

  // The cross-check prompt: when set, we hold the reading and ask the patient to
  // double-check it before saving. `pendingForm` is the exact FormData captured
  // at prompt time so "Save anyway" logs precisely what they entered.
  const [recheck, setRecheck] = useState<Extract<ReadingCheckResult, { status: "recheck" }> | null>(null);
  const [pendingForm, setPendingForm] = useState<FormData | null>(null);

  // `save()` clears the prompt before dispatching, so by the time a success
  // lands there is nothing to reset here — just refresh the history list.
  useEffect(() => {
    if (state?.success) {
      queryClient.invalidateQueries({ queryKey: ["vitals-readings", patientId] });
    }
  }, [state?.success, queryClient, patientId]);

  function save(form: FormData) {
    setRecheck(null);
    setPendingForm(null);
    formAction(form);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = buildCheckInput(vitalType, glucoseUnit, form);
    if (input) {
      const result = checkVitalReading(input);
      if (result.status === "recheck") {
        setRecheck(result);
        setPendingForm(form);
        return;
      }
    }
    save(form);
  }

  // Any edit to the reading dismisses a standing prompt, so the next submit is
  // re-evaluated against the new value rather than the stale one.
  function clearRecheck() {
    if (recheck) {
      setRecheck(null);
      setPendingForm(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log a reading</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="hidden" name="vital_type" value={vitalType} />
          <div className="space-y-1.5">
            <Label htmlFor="vital_type_select">Reading type</Label>
            <Select
              id="vital_type_select"
              value={vitalType}
              onChange={(event) => {
                setVitalType(event.target.value as VitalType);
                clearRecheck();
              }}
            >
              {VITAL_TYPES.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>

          {vitalType === "blood_pressure" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="systolic">Systolic (mmHg)</Label>
                <Input id="systolic" name="systolic" type="number" required onChange={clearRecheck} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="diastolic">Diastolic (mmHg)</Label>
                <Input id="diastolic" name="diastolic" type="number" required onChange={clearRecheck} />
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
                    onChange={clearRecheck}
                  />
                  <input type="hidden" name="glucose_unit" value={glucoseUnit} />
                  <Select
                    aria-label="Glucose unit"
                    value={glucoseUnit}
                    onChange={(event) => {
                      setGlucoseUnit(event.target.value as GlucoseUnit);
                      clearRecheck();
                    }}
                    className="w-28"
                  >
                    <option value="mmol_l">mmol/L</option>
                    <option value="mg_dl">mg/dL</option>
                  </Select>
                </div>
                <p className="text-xs text-charcoal-ink/60">
                  {glucoseUnit === "mmol_l" ? "e.g. 5.6 mmol/L" : "e.g. 100 mg/dL"} — check
                  your glucometer&apos;s display unit before entering.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="glucose_context">Context</Label>
                <Select id="glucose_context" name="glucose_context" required defaultValue="">
                  <option value="" disabled>
                    Select context
                  </option>
                  <option value="fasting">Fasting</option>
                  <option value="random">Random</option>
                  <option value="post_meal">Post-meal</option>
                </Select>
              </div>
            </div>
          )}

          {vitalType === "weight" && (
            <div className="space-y-1.5">
              <Label htmlFor="weight_kg">Weight (kg)</Label>
              <Input id="weight_kg" name="weight_kg" type="number" step="0.1" required onChange={clearRecheck} />
            </div>
          )}

          {vitalType === "pulse" && (
            <div className="space-y-1.5">
              <Label htmlFor="pulse_bpm">Pulse (bpm)</Label>
              <Input id="pulse_bpm" name="pulse_bpm" type="number" required onChange={clearRecheck} />
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
                onChange={clearRecheck}
              />
            </div>
          )}

          {vitalType === "spo2" && (
            <div className="space-y-1.5">
              <Label htmlFor="spo2_pct">SpO2 (%)</Label>
              <Input id="spo2_pct" name="spo2_pct" type="number" required onChange={clearRecheck} />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="note">Note (optional)</Label>
            <Input id="note" name="note" type="text" maxLength={500} />
          </div>

          {recheck && pendingForm && (
            <div
              className="rounded-lg border border-amber-200 bg-amber-50 p-4"
              role="alertdialog"
              aria-label="Please double-check this reading"
            >
              <p className="text-sm font-medium text-amber-800">{recheck.heading}</p>
              <p className="mt-1 text-sm text-amber-800/90">{recheck.message}</p>
              <p className="mt-3 text-xs font-medium uppercase tracking-wide text-amber-800/70">
                How to take a more accurate reading
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-charcoal-ink/80">
                {recheck.tips.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-charcoal-ink/70">
                If you&apos;ve re-taken it and this is right, go ahead and save it — your care team
                will still see it.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" disabled={pending} onClick={() => save(pendingForm)}>
                  {pending ? "Saving…" : "Save this reading"}
                </Button>
                <Button type="button" variant="outline" disabled={pending} onClick={clearRecheck}>
                  Re-enter it
                </Button>
              </div>
            </div>
          )}

          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && <p className="text-sm text-brand-green">Reading logged.</p>}

          {!recheck && (
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save reading"}
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
