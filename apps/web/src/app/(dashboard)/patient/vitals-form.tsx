"use client";

import { useActionState, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { logVital } from "./actions";
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

export function VitalsForm({ patientId }: { patientId: string }) {
  const [vitalType, setVitalType] = useState<VitalType>("blood_pressure");
  const [state, formAction, pending] = useActionState(logVital, undefined);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (state?.success) {
      queryClient.invalidateQueries({ queryKey: ["vitals-readings", patientId] });
    }
  }, [state?.success, queryClient, patientId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log a reading</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="vital_type" value={vitalType} />
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

          {vitalType === "blood_pressure" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="systolic">Systolic (mmHg)</Label>
                <Input id="systolic" name="systolic" type="number" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="diastolic">Diastolic (mmHg)</Label>
                <Input id="diastolic" name="diastolic" type="number" required />
              </div>
            </div>
          )}

          {vitalType === "glucose" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="glucose_mmol_l">Glucose (mmol/L)</Label>
                <Input
                  id="glucose_mmol_l"
                  name="glucose_mmol_l"
                  type="number"
                  step="0.1"
                  required
                />
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
              <Input id="weight_kg" name="weight_kg" type="number" step="0.1" required />
            </div>
          )}

          {vitalType === "pulse" && (
            <div className="space-y-1.5">
              <Label htmlFor="pulse_bpm">Pulse (bpm)</Label>
              <Input id="pulse_bpm" name="pulse_bpm" type="number" required />
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
              />
            </div>
          )}

          {vitalType === "spo2" && (
            <div className="space-y-1.5">
              <Label htmlFor="spo2_pct">SpO2 (%)</Label>
              <Input id="spo2_pct" name="spo2_pct" type="number" required />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="note">Note (optional)</Label>
            <Input id="note" name="note" type="text" maxLength={500} />
          </div>

          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && (
            <p className="text-sm text-brand-green">Reading logged.</p>
          )}

          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save reading"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
