"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { submitRiskAssessment } from "./actions";
import {
  CANCER_TYPES,
  CIGARETTES_PER_DAY,
  DIET_TAGS,
  EXISTING_DIAGNOSES,
  SLEEP_HOURS,
} from "@/lib/validation/risk-assessment";
import { useVitalsReadings } from "@/lib/queries/vitals";
import { useCarePlans } from "@/lib/queries/care-plans";
import { useRiskAssessmentResponses } from "@/lib/queries/risk-assessment";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Enums } from "@tarragon/shared";

const STEP_COUNT = 4;
const STEP_LABELS = ["Family history", "Lifestyle", "Medical history", "Vaccination & screening"];

/** Best-effort care_plan_condition → EXISTING_DIAGNOSES mapping. Only the
 * conditions with an obvious equivalent map; obesity/ckd/asthma/copd/
 * heart_failure/other have no EXISTING_DIAGNOSES counterpart and are
 * deliberately left unmapped rather than forced into "other". */
const CONDITION_TO_DIAGNOSIS: Partial<Record<Enums<"care_plan_condition">, string>> = {
  hypertension: "hypertension",
  diabetes: "diabetes",
  cardiovascular: "heart_disease",
};

function CheckboxGroup({
  legend,
  name,
  options,
  onChange,
  checkedValues,
  onToggle,
}: {
  legend: string;
  name: string;
  options: readonly { value: string; label: string }[];
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** When provided, checkboxes become controlled (checked reflects this
   * list) so a prefill computed after data loads actually shows up —
   * mirrors the height/weight "adjust state during render" prefill below. */
  checkedValues?: string[];
  onToggle?: (value: string, checked: boolean) => void;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1" onChange={onChange}>
        {options.map(({ value, label }) => (
          <label key={value} className="flex items-center gap-1.5 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
            <input
              type="checkbox"
              name={name}
              value={value}
              className="h-4 w-4"
              {...(checkedValues
                ? {
                    checked: checkedValues.includes(value),
                    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                      onToggle?.(value, e.target.checked),
                  }
                : {})}
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Checkbox({ name, label }: { name: string; label: string }) {
  return (
    <label className="flex items-center gap-1.5 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
      <input type="checkbox" name={name} className="h-4 w-4" />
      {label}
    </label>
  );
}

const stepClass = "space-y-3";

export function RiskAssessmentForm({ patientId }: { patientId: string }) {
  const [state, formAction, pending] = useActionState(submitRiskAssessment, undefined);
  const queryClient = useQueryClient();
  const { data: vitalsReadings } = useVitalsReadings(patientId);
  const { data: carePlans } = useCarePlans(patientId);
  const { data: priorResponses } = useRiskAssessmentResponses(patientId);

  const [step, setStep] = useState(1);
  const [showCancerOther, setShowCancerOther] = useState(false);
  const [showDiagnosesOther, setShowDiagnosesOther] = useState(false);
  const [smokingStatus, setSmokingStatus] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [existingDiagnoses, setExistingDiagnoses] = useState<string[]>([]);
  // Adjust state during render (React's endorsed pattern for "prefill once
  // a query result arrives") rather than in an effect, so it can't cascade
  // an extra render — see https://react.dev/learn/you-might-not-need-an-effect.
  const [prefillSource, setPrefillSource] = useState<typeof vitalsReadings>(undefined);
  if (vitalsReadings !== prefillSource) {
    setPrefillSource(vitalsReadings);
    const latestWeightRow = vitalsReadings?.find((v) => v.vital_type === "weight");
    if (weightKg === "" && latestWeightRow?.weight_kg != null) {
      setWeightKg(String(latestWeightRow.weight_kg));
    }
  }
  // Same pattern, for the patient's own most recent answers + what their
  // care team already knows — don't make them re-declare a height they
  // already told us, or a condition their own active care plan proves.
  const [diagnosesPrefillSource, setDiagnosesPrefillSource] = useState<{
    priorResponses: typeof priorResponses;
    carePlans: typeof carePlans;
  }>({ priorResponses: undefined, carePlans: undefined });
  if (
    priorResponses !== diagnosesPrefillSource.priorResponses ||
    carePlans !== diagnosesPrefillSource.carePlans
  ) {
    setDiagnosesPrefillSource({ priorResponses, carePlans });

    const priorHeight = priorResponses?.find((r) => r.question_key === "height_cm");
    if (heightCm === "" && typeof priorHeight?.response === "number") {
      setHeightCm(String(priorHeight.response));
    }

    const priorDiagnoses = priorResponses?.find((r) => r.question_key === "existing_diagnoses");
    const fromPriorAnswer = Array.isArray(priorDiagnoses?.response)
      ? (priorDiagnoses.response as string[])
      : [];
    const fromCarePlans = (carePlans ?? [])
      .map((plan) => CONDITION_TO_DIAGNOSIS[plan.condition])
      .filter((v): v is string => v != null);
    const merged = [...new Set([...fromPriorAnswer, ...fromCarePlans])];
    if (existingDiagnoses.length === 0 && merged.length > 0) {
      setExistingDiagnoses(merged);
      if (merged.includes("other")) setShowDiagnosesOther(true);
    }
  }

  useEffect(() => {
    if (state?.success) {
      queryClient.invalidateQueries({ queryKey: ["risk-assessment-responses", patientId] });
      queryClient.invalidateQueries({ queryKey: ["prevention-risk-scores", patientId] });
    }
  }, [state?.success, queryClient, patientId]);

  const bmi = useMemo(() => {
    const height = Number(heightCm);
    const weight = Number(weightKg);
    if (!height || !weight) return null;
    return weight / (height / 100) ** 2;
  }, [heightCm, weightKg]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Risk assessment</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-6">
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
            A few honest answers help us tell you what to check and when. This isn&apos;t
            a diagnosis, just a starting point for your care.
          </p>

          <div className="flex items-center gap-2 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            <span className="whitespace-nowrap">
              Step {step} of {STEP_COUNT}: {STEP_LABELS[step - 1]}
            </span>
            <div className="h-1.5 flex-1 rounded-full bg-charcoal-ink/10 dark:bg-night-ink/15">
              <div
                className="h-1.5 rounded-full bg-brand-green transition-all"
                style={{ width: `${(step / STEP_COUNT) * 100}%` }}
              />
            </div>
          </div>

          {step === 1 && (
          <div className={stepClass}>
            <h3 className="text-sm font-semibold text-charcoal-ink dark:text-night-ink">Family history</h3>
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
              onChange={(e) => {
                if (e.target.value === "other") setShowCancerOther(e.target.checked);
              }}
            />
            {showCancerOther && (
              <div className="space-y-1.5">
                <Label htmlFor="family_cancer_other_detail">Which cancer type?</Label>
                <Input
                  id="family_cancer_other_detail"
                  name="family_cancer_other_detail"
                  type="text"
                  maxLength={300}
                />
              </div>
            )}
          </div>
          )}

          {step === 2 && (
          <div className={stepClass}>
            <h3 className="text-sm font-semibold text-charcoal-ink dark:text-night-ink">Lifestyle</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="smoking_status">Smoking</Label>
                <Select
                  id="smoking_status"
                  name="smoking_status"
                  required
                  defaultValue=""
                  onChange={(e) => setSmokingStatus(e.target.value)}
                >
                  <option value="" disabled>
                    Select
                  </option>
                  <option value="never">Never</option>
                  <option value="former">Former</option>
                  <option value="current">Current</option>
                </Select>
              </div>
              {smokingStatus === "current" && (
                <div className="space-y-1.5">
                  <Label htmlFor="cigarettes_per_day">Cigarettes per day</Label>
                  <Select id="cigarettes_per_day" name="cigarettes_per_day" required defaultValue="">
                    <option value="" disabled>
                      Select
                    </option>
                    {CIGARETTES_PER_DAY.map((value) => (
                      <option key={value} value={value}>
                        {value.split("_").join("–")}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
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
                <Label htmlFor="exercise_days_per_week">Exercise days/week</Label>
                <Input
                  id="exercise_days_per_week"
                  name="exercise_days_per_week"
                  type="number"
                  min={0}
                  max={7}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exercise_minutes_per_session">Minutes per session</Label>
                <Input
                  id="exercise_minutes_per_session"
                  name="exercise_minutes_per_session"
                  type="number"
                  min={0}
                  max={300}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sleep_hours">Sleep (hours/night)</Label>
                <Select id="sleep_hours" name="sleep_hours" required defaultValue="">
                  <option value="" disabled>
                    Select
                  </option>
                  {SLEEP_HOURS.map((value) => (
                    <option key={value} value={value}>
                      {value.split("_").join(" ")}
                    </option>
                  ))}
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
                <Input
                  id="height_cm"
                  name="height_cm"
                  type="number"
                  required
                  value={heightCm}
                  onChange={(e) => setHeightCm(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="weight_kg">Weight (kg)</Label>
                <Input
                  id="weight_kg"
                  name="weight_kg"
                  type="number"
                  value={weightKg}
                  onChange={(e) => setWeightKg(e.target.value)}
                />
                {bmi && <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">BMI: {bmi.toFixed(1)}</p>}
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
          )}

          {step === 3 && (
          <div className={stepClass}>
            <h3 className="text-sm font-semibold text-charcoal-ink dark:text-night-ink">
              Past medical history &amp; medications
            </h3>
            {existingDiagnoses.length > 0 && (
              <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">
                Pre-filled from your care team&apos;s records and your last assessment.
                Remove anything that&apos;s no longer right.
              </p>
            )}
            <CheckboxGroup
              legend="Existing diagnoses (select any)"
              name="existing_diagnoses"
              options={EXISTING_DIAGNOSES.map((value) => ({
                value,
                label: value.split("_").join(" "),
              }))}
              checkedValues={existingDiagnoses}
              onToggle={(value, checked) => {
                setExistingDiagnoses((prev) =>
                  checked ? [...new Set([...prev, value])] : prev.filter((v) => v !== value)
                );
                if (value === "other") setShowDiagnosesOther(checked);
              }}
            />
            {showDiagnosesOther && (
              <div className="space-y-1.5">
                <Label htmlFor="existing_diagnoses_other_detail">Which diagnosis?</Label>
                <Input
                  id="existing_diagnoses_other_detail"
                  name="existing_diagnoses_other_detail"
                  type="text"
                  maxLength={300}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="current_medications">Current medications (optional)</Label>
              <Input id="current_medications" name="current_medications" type="text" maxLength={500} />
            </div>
          </div>
          )}

          {step === 4 && (
          <div className={stepClass}>
            <h3 className="text-sm font-semibold text-charcoal-ink dark:text-night-ink">
              Vaccination &amp; screening history
            </h3>
            <Checkbox name="hpv_vaccinated" label="I've had the HPV vaccine" />
            <div className="space-y-1.5">
              <Label htmlFor="other_vaccines_detail">Any other vaccines? (optional)</Label>
              <Input id="other_vaccines_detail" name="other_vaccines_detail" type="text" maxLength={300} />
            </div>
            <Checkbox name="prior_abnormal_result" label="I've had an abnormal screening result before" />
          </div>
          )}

          {state?.error && <p className="text-sm text-red-600 dark:text-red-300">{state.error}</p>}
          {state?.success && (
            <p className="text-sm text-brand-green dark:text-brand-green-bright">
              Thanks, your care plan preview below reflects your answers.
            </p>
          )}

          <div className="flex justify-between">
            {step > 1 && (
              <Button type="button" variant="outline" onClick={() => setStep((s) => s - 1)}>
                Previous
              </Button>
            )}
            {step < STEP_COUNT && (
              <Button type="button" className="ml-auto" onClick={() => setStep((s) => s + 1)}>
                Next
              </Button>
            )}
            {step === STEP_COUNT && (
              <Button type="submit" className="ml-auto" disabled={pending}>
                {pending ? "Saving…" : "Save assessment"}
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
