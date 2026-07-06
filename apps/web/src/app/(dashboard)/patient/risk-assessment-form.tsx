"use client";

import { useActionState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { submitRiskAssessment } from "./actions";
import {
  CANCER_TYPES,
  DIET_TAGS,
  EXISTING_DIAGNOSES,
} from "@/lib/validation/risk-assessment";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function CheckboxGroup({
  legend,
  name,
  options,
}: {
  legend: string;
  name: string;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium text-charcoal-ink">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {options.map(({ value, label }) => (
          <label key={value} className="flex items-center gap-1.5 text-sm text-charcoal-ink/80">
            <input type="checkbox" name={name} value={value} className="h-4 w-4" />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Checkbox({ name, label }: { name: string; label: string }) {
  return (
    <label className="flex items-center gap-1.5 text-sm text-charcoal-ink/80">
      <input type="checkbox" name={name} className="h-4 w-4" />
      {label}
    </label>
  );
}

export function RiskAssessmentForm({ patientId }: { patientId: string }) {
  const [state, formAction, pending] = useActionState(submitRiskAssessment, undefined);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (state?.success) {
      queryClient.invalidateQueries({ queryKey: ["risk-assessment-responses", patientId] });
      queryClient.invalidateQueries({ queryKey: ["prevention-risk-scores", patientId] });
    }
  }, [state?.success, queryClient, patientId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Risk assessment</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-6">
          <p className="text-sm text-charcoal-ink/60">
            A few honest answers help us tell you what to check and when — this isn&apos;t
            a diagnosis, just a starting point for your care.
          </p>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-charcoal-ink">Family history</h3>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <Checkbox name="family_diabetes" label="Diabetes" />
              <Checkbox name="family_hypertension" label="Hypertension" />
              <Checkbox name="family_heart_disease" label="Heart disease" />
              <Checkbox name="family_sickle_cell" label="Sickle cell" />
            </div>
            <CheckboxGroup
              legend="Family history of cancer (select any)"
              name="family_cancer_types"
              options={CANCER_TYPES.map((value) => ({
                value,
                label: value.charAt(0).toUpperCase() + value.slice(1),
              }))}
            />
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-charcoal-ink">Lifestyle</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="smoking_status">Smoking</Label>
                <Select id="smoking_status" name="smoking_status" required defaultValue="">
                  <option value="" disabled>
                    Select
                  </option>
                  <option value="never">Never</option>
                  <option value="former">Former</option>
                  <option value="current">Current</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="alcohol_use">Alcohol</Label>
                <Select id="alcohol_use" name="alcohol_use" required defaultValue="">
                  <option value="" disabled>
                    Select
                  </option>
                  <option value="none">None</option>
                  <option value="moderate">Moderate</option>
                  <option value="heavy">Heavy</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exercise_frequency">Exercise</Label>
                <Select id="exercise_frequency" name="exercise_frequency" required defaultValue="">
                  <option value="" disabled>
                    Select
                  </option>
                  <option value="none">None</option>
                  <option value="1_2_per_week">1–2 times/week</option>
                  <option value="3_plus_per_week">3+ times/week</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sleep_quality">Sleep quality</Label>
                <Select id="sleep_quality" name="sleep_quality" required defaultValue="">
                  <option value="" disabled>
                    Select
                  </option>
                  <option value="poor">Poor</option>
                  <option value="fair">Fair</option>
                  <option value="good">Good</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="stress_level">Stress level</Label>
                <Select id="stress_level" name="stress_level" required defaultValue="">
                  <option value="" disabled>
                    Select
                  </option>
                  <option value="low">Low</option>
                  <option value="moderate">Moderate</option>
                  <option value="high">High</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="height_cm">Height (cm)</Label>
                <Input id="height_cm" name="height_cm" type="number" required />
              </div>
            </div>
            <CheckboxGroup
              legend="Diet pattern (select any)"
              name="diet_pattern"
              options={DIET_TAGS.map((value) => ({
                value,
                label: value.split("_").join(" "),
              }))}
            />
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-charcoal-ink">
              Past medical history &amp; medications
            </h3>
            <CheckboxGroup
              legend="Existing diagnoses (select any)"
              name="existing_diagnoses"
              options={EXISTING_DIAGNOSES.map((value) => ({
                value,
                label: value.split("_").join(" "),
              }))}
            />
            <div className="space-y-1.5">
              <Label htmlFor="current_medications">Current medications (optional)</Label>
              <Input id="current_medications" name="current_medications" type="text" maxLength={500} />
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-charcoal-ink">
              Vaccination &amp; screening history
            </h3>
            <Checkbox name="hpv_vaccinated" label="I've had the HPV vaccine" />
            <Checkbox name="prior_abnormal_result" label="I've had an abnormal screening result before" />
          </div>

          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && (
            <p className="text-sm text-brand-green">
              Thanks — your care plan preview below reflects your answers.
            </p>
          )}

          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save assessment"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
