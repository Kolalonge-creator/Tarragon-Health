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
import { FormError, fieldErrorId } from "@/components/ui/form-error";
import { useRemountOnActionResult } from "@/lib/forms/use-remount-on-action-result";
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
  defaultCheckedValues,
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
  /** Uncontrolled-mode only (ignored if `checkedValues` is set, which is
   * already immune to this): which options to check by default, from the
   * server's echoed submitted values — see useRemountOnActionResult. */
  defaultCheckedValues?: string[];
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
                : { defaultChecked: defaultCheckedValues?.includes(value) })}
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Checkbox({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-1.5 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
      <input type="checkbox" name={name} className="h-4 w-4" defaultChecked={defaultChecked} />
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
  const errorId = fieldErrorId("risk-assessment");

  // Most of this wizard's fields are plain uncontrolled inputs with no
  // React-side tracking at all, so — same bug as signup/patient-location,
  // same fix — a rejected submission (a Zod failure that slips past the
  // client-side checks below, or any server-side error past that) used to
  // wipe every one of the 4 steps' answers with nothing to retype from.
  // `values` is what the server echoes back on any failure; `attempt` forces
  // the whole form to remount so fresh `defaultValue`/`defaultChecked` props
  // built from it actually take (see the hook's own comment for why a plain
  // prop change on an already-mounted uncontrolled input doesn't do this).
  const attempt = useRemountOnActionResult(state, (s) => Boolean(s?.error), errorId);
  const values = state?.values;

  const [step, setStep] = useState(1);
  const [showCancerOther, setShowCancerOther] = useState(values?.family_cancer_types?.includes("other") ?? false);
  const [showDiagnosesOther, setShowDiagnosesOther] = useState(
    values?.existing_diagnoses?.includes("other") ?? false
  );
  const [smokingStatus, setSmokingStatus] = useState(values?.smoking_status ?? "");
  const [heightCm, setHeightCm] = useState(values?.height_cm ?? "");
  const [weightKg, setWeightKg] = useState(values?.weight_kg ?? "");
  const [existingDiagnoses, setExistingDiagnoses] = useState<string[]>(values?.existing_diagnoses ?? []);
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

  /**
   * `hidden` (and the `display: none` it produces) does NOT exempt a
   * control from native constraint validation, despite the comment this
   * once carried — only genuinely inert/disabled controls are excluded.
   * A `required` field left unanswered on an earlier, currently-hidden
   * step therefore still blocks the browser's own pre-submit check; since
   * that control has no layout box, the browser can't focus or show its
   * error bubble either, so it just cancels the submit with nothing
   * visible at all (confirmed via a real click-through: "Save assessment"
   * silently did nothing after skipping a Lifestyle field). `noValidate`
   * below hands validation to this handler instead, which finds the first
   * invalid control, switches to the step that owns it, and asks the
   * browser to (re-)report validity once that step is actually rendered.
   */
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    const form = e.currentTarget;
    const invalid = form.querySelector<HTMLElement>(":invalid");
    if (!invalid) return;
    e.preventDefault();
    const stepEl = invalid.closest<HTMLElement>("[data-step]");
    const stepIndex = stepEl ? Number(stepEl.dataset.step) : NaN;
    if (Number.isInteger(stepIndex) && stepIndex !== step) {
      setStep(stepIndex);
      requestAnimationFrame(() => form.reportValidity());
    } else {
      form.reportValidity();
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Risk assessment</CardTitle>
      </CardHeader>
      <CardContent>
        <form key={attempt} action={formAction} onSubmit={handleSubmit} noValidate className="space-y-6">
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

          {/* Every step stays mounted (hidden, not unmounted) across the
              whole wizard: an unmounted step's uncontrolled inputs lose
              their DOM nodes and are silently missing from FormData at
              final submit. `hidden` does NOT bar a `required` field from
              native constraint validation though (a common assumption
              that doesn't hold) — `data-step` + `handleSubmit` above is
              what actually keeps an off-screen required field from
              silently blocking submission. */}
          <div className={stepClass} hidden={step !== 1} data-step={1}>
            <h3 className="text-sm font-semibold text-charcoal-ink dark:text-night-ink">Family history</h3>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <Checkbox name="family_diabetes" label="Diabetes" defaultChecked={values?.family_diabetes} />
              <Checkbox
                name="family_hypertension"
                label="Hypertension"
                defaultChecked={values?.family_hypertension}
              />
              <Checkbox
                name="family_heart_disease"
                label="Heart disease"
                defaultChecked={values?.family_heart_disease}
              />
              <Checkbox name="family_sickle_cell" label="Sickle cell" defaultChecked={values?.family_sickle_cell} />
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
              defaultCheckedValues={values?.family_cancer_types}
            />
            {showCancerOther && (
              <div className="space-y-1.5">
                <Label htmlFor="family_cancer_other_detail">Which cancer type?</Label>
                {/* required: riskAssessmentSchema's superRefine demands this
                    whenever "other" is checked; without it, handleSubmit's
                    :invalid check can't catch a blank one client-side, so it
                    would reach the server and fail there instead. */}
                <Input
                  id="family_cancer_other_detail"
                  name="family_cancer_other_detail"
                  type="text"
                  maxLength={300}
                  defaultValue={values?.family_cancer_other_detail}
                  required
                />
              </div>
            )}
          </div>

          <div className={stepClass} hidden={step !== 2} data-step={2}>
            <h3 className="text-sm font-semibold text-charcoal-ink dark:text-night-ink">Lifestyle</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="smoking_status">Smoking</Label>
                {/* defaultValue is fed from the live `smokingStatus` state
                    rather than a static "": this select is otherwise
                    plain-uncontrolled (only `onChange` updates separate
                    state, for the cigarettes_per_day condition below), so
                    on remount it would reset to blank even though
                    `smokingStatus` itself — tracked in this component,
                    unaffected by the <form> remounting — still correctly
                    remembers the last pick. */}
                <Select
                  id="smoking_status"
                  name="smoking_status"
                  required
                  defaultValue={smokingStatus}
                  onChange={(e) => setSmokingStatus(e.target.value)}
                >
                  <option value="" disabled>
                    Select
                  </option>
                  <option value="never">Never smoked</option>
                  <option value="former">Used to smoke</option>
                  <option value="current">Currently smoke</option>
                </Select>
              </div>
              {/* `hidden`, not a conditional unmount: toggling smoking_status
                  away from "current" and back within step 2 (no wizard
                  navigation at all) used to discard whatever cigarette count
                  was already picked, the same "unmounted uncontrolled input
                  loses its value" problem the step-vs-hidden comment above
                  describes for step navigation — this field just had its own
                  smaller version of it. `required` is conditional to match
                  riskAssessmentSchema's superRefine (only demanded when
                  smoking_status is "current"); a field that's merely hidden,
                  not irrelevant, must not become an unconditionally-required
                  landmine for handleSubmit's :invalid check above. */}
              <div className="space-y-1.5" hidden={smokingStatus !== "current"}>
                <Label htmlFor="cigarettes_per_day">Cigarettes per day</Label>
                <Select
                  id="cigarettes_per_day"
                  name="cigarettes_per_day"
                  required={smokingStatus === "current"}
                  defaultValue={values?.cigarettes_per_day ?? ""}
                >
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
              <div className="space-y-1.5">
                <Label htmlFor="alcohol_use">Alcohol</Label>
                <Select id="alcohol_use" name="alcohol_use" required defaultValue={values?.alcohol_use ?? ""}>
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
                  defaultValue={values?.exercise_days_per_week}
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
                  defaultValue={values?.exercise_minutes_per_session}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sleep_hours">Sleep (hours/night)</Label>
                <Select id="sleep_hours" name="sleep_hours" required defaultValue={values?.sleep_hours ?? ""}>
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
                <Select id="stress_level" name="stress_level" required defaultValue={values?.stress_level ?? ""}>
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
                {/* min/max match riskAssessmentSchema's own bounds (100-230cm)
                    so an out-of-range value is caught by handleSubmit's
                    client-side :invalid check and jumps back to this step,
                    instead of reaching the server, failing there, and
                    wiping every step's answers with nothing to explain why. */}
                <Input
                  id="height_cm"
                  name="height_cm"
                  type="number"
                  required
                  min={100}
                  max={230}
                  value={heightCm}
                  onChange={(e) => setHeightCm(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="weight_kg">Weight (kg)</Label>
                {/* min/max match riskAssessmentSchema's own bounds (20-300kg,
                    optional) — same reasoning as height_cm above. */}
                <Input
                  id="weight_kg"
                  name="weight_kg"
                  type="number"
                  min={20}
                  max={300}
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
              defaultCheckedValues={values?.diet_pattern}
            />
          </div>

          <div className={stepClass} hidden={step !== 3} data-step={3}>
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
                {/* required: same reasoning as family_cancer_other_detail
                    above — riskAssessmentSchema's superRefine requires this
                    whenever "other" is checked. */}
                <Input
                  id="existing_diagnoses_other_detail"
                  name="existing_diagnoses_other_detail"
                  type="text"
                  maxLength={300}
                  defaultValue={values?.existing_diagnoses_other_detail}
                  required
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="current_medications">Current medications (optional)</Label>
              <Input
                id="current_medications"
                name="current_medications"
                type="text"
                maxLength={500}
                defaultValue={values?.current_medications}
              />
            </div>
          </div>

          <div className={stepClass} hidden={step !== 4} data-step={4}>
            <h3 className="text-sm font-semibold text-charcoal-ink dark:text-night-ink">
              Vaccination &amp; screening history
            </h3>
            <Checkbox name="hpv_vaccinated" label="I've had the HPV vaccine" defaultChecked={values?.hpv_vaccinated} />
            <div className="space-y-1.5">
              <Label htmlFor="other_vaccines_detail">Any other vaccines? (optional)</Label>
              <Input
                id="other_vaccines_detail"
                name="other_vaccines_detail"
                type="text"
                maxLength={300}
                defaultValue={values?.other_vaccines_detail}
              />
            </div>
            <Checkbox
              name="prior_abnormal_result"
              label="I've had an abnormal screening result before"
              defaultChecked={values?.prior_abnormal_result}
            />
          </div>

          <FormError id={errorId} message={state?.error} />
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
