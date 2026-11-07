"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { submitRiskAssessment } from "./actions";
import { discardRiskAssessmentDraft, loadRiskAssessmentDraft, saveRiskAssessmentDraft } from "./risk-assessment-draft-actions";
import { useActingFor } from "@/components/acting-for-context";
import {
  formDataToAnswers,
  missingAnswers,
  reviewSummary,
  type DraftAnswers,
  type MissingAnswer,
} from "@/lib/validation/risk-assessment-review";
import { formatPatientDate } from "@/lib/format-date";
import {
  CANCER_TYPES,
  CIGARETTES_PER_DAY,
  DIET_TAGS,
  EXISTING_DIAGNOSES,
  FIELD_STEP,
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
/** P14: after the four question steps, a "check your answers" step; the assessment is only submitted from there. */
const REVIEW_STEP = 5;
const STEP_LABELS = ["Family history", "Lifestyle", "Medical history", "Vaccination & screening", "Check your answers"];
/** Not a form field: whether "None of these" was ticked for diagnoses, kept in a saved draft so resuming shows it. */
const NO_DIAGNOSES_KEY = "no_diagnoses";

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

export function RiskAssessmentForm({ patientId, sex }: { patientId: string; /** Recorded sex, when known: the HPV vaccine question is only asked when it is not male. */ sex?: "male" | "female" | null }) {
  const [state, formAction, pending] = useActionState(submitRiskAssessment, undefined);
  const queryClient = useQueryClient();
  const { data: vitalsReadings } = useVitalsReadings(patientId);
  const { data: carePlans } = useCarePlans(patientId);
  const { data: priorResponses } = useRiskAssessmentResponses(patientId);

  const [step, setStep] = useState(1);
  // P14 save and resume. Only on the patient's own account: while acting for someone nothing is loaded or saved, so
  // their half-finished answers can never land on the supporter's own record.
  const acting = useActingFor();
  const draftQuery = useQuery({
    queryKey: ["risk-assessment-draft", patientId],
    queryFn: async () => {
      const r = await loadRiskAssessmentDraft();
      if (!r.ok) throw new Error(r.error);
      return r.draft;
    },
    enabled: !acting,
  });
  const [draftHandled, setDraftHandled] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [review, setReview] = useState<{ answers: DraftAnswers; missing: MissingAnswer[] } | null>(null);
  const pendingResume = useRef<DraftAnswers | null>(null);
  const [showCancerOther, setShowCancerOther] = useState(false);
  const [showDiagnosesOther, setShowDiagnosesOther] = useState(false);
  const [smokingStatus, setSmokingStatus] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [existingDiagnoses, setExistingDiagnoses] = useState<string[]>([]);
  const priorHpvYes = priorResponses?.find((r) => r.question_key === "hpv_vaccinated")?.response === true;
  // "None of these" is an answer in its own right (an empty list means the same thing to the server, but a blank list reads as
  // "I have not answered"). It is never submitted: it only clears the ticks and shows that the question was answered.
  const [noDiagnoses, setNoDiagnoses] = useState(false);
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
    if (existingDiagnoses.length === 0 && merged.length > 0 && !noDiagnoses) {
      setExistingDiagnoses(merged);
      if (merged.includes("other")) setShowDiagnosesOther(true);
    }
  }

  useEffect(() => {
    if (state?.success) {
      queryClient.invalidateQueries({ queryKey: ["risk-assessment-responses", patientId] });
      queryClient.invalidateQueries({ queryKey: ["prevention-risk-scores", patientId] });
      // A submitted assessment replaces the saved draft (own account only; nothing was saved while acting).
      if (!acting) {
        void discardRiskAssessmentDraft().then(() =>
          queryClient.invalidateQueries({ queryKey: ["risk-assessment-draft", patientId] })
        );
      }
    }
  }, [state?.success, queryClient, patientId, acting]);

  // Same bug, same fix as the signup form (see signup/signup-form.tsx):
  // React resets a <form action={...}>'s uncontrolled fields synchronously
  // at submit time, before the action even runs, so an error response wipes
  // every field the wizard isn't currently showing — not just the invalid
  // one. `noValidate` above is what first makes it possible to reach this
  // action with an error at all (previously the browser silently refused to
  // submit), so this restore effect matters more now, not less. Unlike
  // signup's handful of fields, this form has many, so the restore walks
  // the form's own elements generically rather than one ref per field.
  // height_cm/weight_kg/existing_diagnoses are deliberately skipped: they're
  // already React-controlled (value=/checked= from state, not defaultValue),
  // so they never get wiped in the first place — the native reset can't
  // touch what React itself owns and re-asserts on every render.
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const values = state?.values as Record<string, unknown> | undefined;
    const form = formRef.current;
    if (!values || !form) return;
    for (const el of Array.from(form.elements)) {
      if (
        !(el instanceof HTMLInputElement) &&
        !(el instanceof HTMLSelectElement) &&
        !(el instanceof HTMLTextAreaElement)
      ) {
        continue;
      }
      const name = el.name;
      if (!name || !(name in values)) continue;
      if (name === "existing_diagnoses" || name === "height_cm" || name === "weight_kg") continue;
      const value = values[name];
      if (el instanceof HTMLInputElement && el.type === "checkbox") {
        el.checked = Array.isArray(value) ? value.includes(el.value) : Boolean(value);
      } else if (typeof value === "string") {
        el.value = value;
      }
    }
  }, [state]);

  // Two bits of React state track what the effect above just told the DOM
  // directly (imperative DOM writes don't fire React's onChange), so the
  // conditional UI they drive doesn't silently disagree with the restored
  // fields. Adjusted during render, same pattern as prefillSource/
  // diagnosesPrefillSource above, rather than inside the effect itself
  // (react-hooks/set-state-in-effect) — see the comment on that pattern.
  const [restoredFrom, setRestoredFrom] = useState<typeof state>(undefined);
  if (state !== restoredFrom) {
    setRestoredFrom(state);
    // An answer that is missing on another step is reported where the buttons are, so open the step that holds it.
    const errorStep = state?.error && state.field ? FIELD_STEP[state.field] : undefined;
    if (errorStep) setStep(errorStep);
    const values = state?.values as Record<string, unknown> | undefined;
    if (typeof values?.smoking_status === "string") setSmokingStatus(values.smoking_status);
    if (Array.isArray(values?.family_cancer_types)) {
      setShowCancerOther(values.family_cancer_types.includes("other"));
    }
  }

  function currentAnswers(): DraftAnswers {
    const form = formRef.current;
    const answers = form ? formDataToAnswers(new FormData(form)) : {};
    if (noDiagnoses && existingDiagnoses.length === 0) answers[NO_DIAGNOSES_KEY] = "on";
    return answers;
  }

  function openReview() {
    const answers = currentAnswers();
    setReview({ answers, missing: missingAnswers(answers) });
    setStep(REVIEW_STEP);
  }

  async function saveForLater() {
    setSaveState("saving");
    setSaveError(null);
    const r = await saveRiskAssessmentDraft({ answers: currentAnswers(), step });
    if (r.ok) {
      setSaveState("saved");
      queryClient.invalidateQueries({ queryKey: ["risk-assessment-draft", patientId] });
    } else {
      setSaveState("failed");
      setSaveError(r.error);
    }
  }

  /** Puts a saved draft back into the form: the uncontrolled fields directly, the controlled ones through state. */
  function resume(answers: DraftAnswers, savedStep: number) {
    const form = formRef.current;
    const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
    setSmokingStatus(str(answers.smoking_status));
    setHeightCm(str(answers.height_cm));
    setWeightKg(str(answers.weight_kg));
    const dx = Array.isArray(answers.existing_diagnoses) ? answers.existing_diagnoses : [];
    setExistingDiagnoses(dx);
    setNoDiagnoses(answers[NO_DIAGNOSES_KEY] === "on" && dx.length === 0);
    setShowDiagnosesOther(dx.includes("other"));
    const cancers = Array.isArray(answers.family_cancer_types) ? answers.family_cancer_types : [];
    setShowCancerOther(cancers.includes("other"));
    if (form) {
      for (const el of Array.from(form.elements)) {
        if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLSelectElement)) continue;
        const name = el.name;
        if (!name || name === "existing_diagnoses" || name === "height_cm" || name === "weight_kg") continue;
        const value = answers[name];
        if (el instanceof HTMLInputElement && el.type === "checkbox") {
          el.checked = Array.isArray(value) ? value.includes(el.value) : value === el.value || value === "on";
        } else if (typeof value === "string") {
          el.value = value;
        }
      }
    }
    // Fields that only appear after a choice (cigarettes, "other" details) mount on the next render; the effect below sets them.
    pendingResume.current = answers;
    setStep(Math.min(Math.max(savedStep, 1), STEP_COUNT));
    setDraftHandled(true);
  }
  useEffect(() => {
    const answers = pendingResume.current;
    const form = formRef.current;
    if (!answers || !form) return;
    pendingResume.current = null;
    for (const name of ["cigarettes_per_day", "family_cancer_other_detail", "existing_diagnoses_other_detail"]) {
      const el = form.elements.namedItem(name);
      const value = answers[name];
      if ((el instanceof HTMLInputElement || el instanceof HTMLSelectElement) && typeof value === "string") el.value = value;
    }
  });

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
        {/* noValidate: without it, a required field on a step the visitor
            isn't currently viewing (e.g. Lifestyle's smoking_status) silently
            kills the final submit — Chrome logs "An invalid form control ...
            is not focusable" to the console and the click on "Save
            assessment" just does nothing, no error, no request, nothing.
            The `hidden` attribute does NOT reliably bar a control from
            constraint validation the way the comment below once assumed
            (confirmed empirically 2026-09-18: reproduced on step 4 with
            step 2 left blank). Server-side Zod validation
            (riskAssessmentSchema) still enforces the same required fields —
            noValidate only means a real, visible `state.error` now surfaces
            instead of a silent no-op. */}
        <form ref={formRef} action={formAction} className="space-y-6" noValidate>
          {/* disabled={pending}: without it, a visitor who notices and
              corrects a mistake while the first submission is still in
              flight can have that correction silently overwritten once the
              restore effect above runs on the response — same race the
              signup form closes with disabled={pending} on each field
              individually; one <fieldset> does it for every field here at
              once. */}
          <fieldset disabled={pending} className="space-y-6 m-0 min-w-0 border-0 p-0">
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
            A few honest answers help us tell you what to check and when. This isn&apos;t
            a diagnosis, just a starting point for your care.
          </p>

          <div className="flex items-center gap-2 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            <span className="whitespace-nowrap">
              {step === REVIEW_STEP ? STEP_LABELS[REVIEW_STEP - 1] : `Step ${step} of ${STEP_COUNT}: ${STEP_LABELS[step - 1]}`}
            </span>
            <div className="h-1.5 flex-1 rounded-full bg-charcoal-ink/10 dark:bg-night-ink/15">
              <div
                className="h-1.5 rounded-full bg-brand-green transition-all"
                style={{ width: `${(Math.min(step, STEP_COUNT) / STEP_COUNT) * 100}%` }}
              />
            </div>
          </div>

          {/* Every step stays mounted (hidden, not unmounted) across the
              whole wizard: an unmounted step's uncontrolled inputs lose
              their DOM nodes and are silently missing from FormData at
              final submit. `hidden` does NOT reliably bar these inputs from
              native constraint validation while off-screen (see the
              `noValidate` comment on the <form> above) — that's now handled
              at the form level instead. */}
          {!acting && draftQuery.isError ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-300">
              Couldn&apos;t load your saved answers. You can still fill in the assessment now.
            </p>
          ) : null}
          {!acting && draftQuery.data && !draftHandled ? (
            <div className="space-y-2 rounded-lg border border-brand-green/30 p-3">
              <p className="text-sm text-charcoal-ink dark:text-night-ink">
                You saved this assessment on {formatPatientDate(draftQuery.data.updatedAt)} without finishing it.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    if (draftQuery.data) resume(draftQuery.data.answers, draftQuery.data.step);
                  }}
                >
                  Continue where you left off
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDraftHandled(true);
                    void discardRiskAssessmentDraft();
                  }}
                >
                  Start again
                </Button>
              </div>
            </div>
          ) : null}

          <div className={stepClass} hidden={step !== 1}>
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

          <div className={stepClass} hidden={step !== 2}>
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
                  <option value="never">Never smoked</option>
                  <option value="former">Used to smoke</option>
                  <option value="current">Currently smoke</option>
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

          <div className={stepClass} hidden={step !== 3}>
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
              legend="Existing diagnoses (select any, or choose None of these)"
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
                if (checked) setNoDiagnoses(false);
                if (value === "other") setShowDiagnosesOther(checked);
              }}
            />
            <label className="flex items-center gap-1.5 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={noDiagnoses && existingDiagnoses.length === 0}
                onChange={(e) => {
                  setNoDiagnoses(e.target.checked);
                  if (e.target.checked) {
                    setExistingDiagnoses([]);
                    setShowDiagnosesOther(false);
                  }
                }}
              />
              None of these
            </label>
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

          <div className={stepClass} hidden={step !== 4}>
            <h3 className="text-sm font-semibold text-charcoal-ink dark:text-night-ink">
              Vaccination &amp; screening history
            </h3>
            {/* Left out for a man (the question is about cervical risk) unless his last answer was yes: submitting without the tick would
                overwrite that yes with no. */}
            {(sex !== "male" || priorHpvYes) && <Checkbox name="hpv_vaccinated" label="I've had the HPV vaccine" />}
            <div className="space-y-1.5">
              <Label htmlFor="other_vaccines_detail">Any other vaccines? (optional)</Label>
              <Input id="other_vaccines_detail" name="other_vaccines_detail" type="text" maxLength={300} />
            </div>
            <Checkbox name="prior_abnormal_result" label="I've had an abnormal result from a screening test before" />
          </div>

          <div className={stepClass} hidden={step !== REVIEW_STEP}>
            <h3 className="text-sm font-semibold text-charcoal-ink dark:text-night-ink">Check your answers</h3>
            {review && review.missing.length > 0 ? (
              <div role="status" className="space-y-2 rounded-lg border border-amber-300 p-3 dark:border-amber-700">
                <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">More information needed</p>
                <ul className="space-y-1">
                  {review.missing.map((m) => (
                    <li key={m.field} className="flex flex-wrap items-center justify-between gap-2 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
                      <span>{m.message}</span>
                      <Button type="button" size="sm" variant="outline" onClick={() => setStep(m.step)}>
                        Go to {STEP_LABELS[m.step - 1].toLowerCase()}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
                Everything needed is answered. Check the answers below, then save the assessment.
              </p>
            )}
            {review
              ? reviewSummary(review.answers, { askHpv: sex !== "male" || priorHpvYes }).map((section) => (
                  <div key={section.step} className="space-y-1 border-t border-charcoal-ink/10 pt-2 dark:border-night-ink/15">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{section.title}</p>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setStep(section.step)}>
                        Change
                      </Button>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm">
                      {section.lines.map((line) => (
                        <div key={line.label} className="contents">
                          <dt className="text-charcoal-ink/60 dark:text-night-ink/60">{line.label}</dt>
                          <dd className="text-charcoal-ink dark:text-night-ink">{line.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))
              : null}
          </div>

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
              <Button type="button" className="ml-auto" onClick={openReview}>
                Check your answers
              </Button>
            )}
            {step === REVIEW_STEP && (
              <Button type="submit" className="ml-auto" disabled={pending}>
                {pending ? "Saving…" : "Save assessment"}
              </Button>
            )}
          </div>
          {!acting ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="ghost" disabled={saveState === "saving"} onClick={saveForLater}>
                {saveState === "saving" ? "Saving…" : "Save and finish later"}
              </Button>
              {saveState === "saved" ? (
                <p role="status" className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">
                  Saved. Only you can see it, and you can come back to finish it.
                </p>
              ) : null}
              {saveState === "failed" ? (
                <p role="alert" className="text-xs text-red-600 dark:text-red-300">{saveError}</p>
              ) : null}
            </div>
          ) : null}
          </fieldset>
        </form>
      </CardContent>
    </Card>
  );
}
