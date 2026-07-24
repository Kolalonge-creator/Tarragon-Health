"use client";

import { useActionState, useMemo, useState } from "react";
import {
  submitObesityAssessment,
  createBariatricReferral,
  type ObesityActionState,
} from "./obesity-actions";
import {
  classifyObesity,
  aomEligible,
  bariatricReferralEligible,
  suggestClinicalStatus,
  EOSS_STAGES,
  type Sex,
} from "@/lib/obesity/classify";
import {
  OBESITY_COMPLICATIONS,
  OBESITY_COMPLICATION_LABELS,
  OBESITY_SECONDARY_CAUSES,
  OBESITY_SECONDARY_CAUSE_LABELS,
} from "@/lib/validation/obesity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const BMI_CATEGORY_LABELS: Record<string, string> = {
  underweight: "Underweight",
  healthy: "Healthy weight",
  overweight: "Overweight",
  obesity_class_i: "Obesity class I",
  obesity_class_ii: "Obesity class II",
  obesity_class_iii: "Obesity class III (severe)",
};

const WEIGHT_RELATED_COMPLICATIONS = new Set([
  "type2_diabetes",
  "hypertension",
  "osa",
  "nafld",
  "dyslipidaemia",
  "cardiovascular_disease",
  "osteoarthritis",
]);

function Checkbox({ name, value, label }: { name: string; value?: string; label: string }) {
  return (
    <label className="flex items-start gap-2 text-sm text-charcoal-ink/80">
      <input type="checkbox" name={name} value={value} className="mt-0.5 h-4 w-4" />
      <span>{label}</span>
    </label>
  );
}

export function ObesityAssessmentPanel({
  patientId,
  patientSex,
}: {
  patientId: string;
  patientSex: Sex | null;
}) {
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [waist, setWaist] = useState("");
  const [complications, setComplications] = useState<Set<string>>(new Set());
  const [functionalLimit, setFunctionalLimit] = useState(false);

  const [state, formAction, pending] = useActionState<ObesityActionState, FormData>(
    submitObesityAssessment.bind(null, patientId),
    undefined,
  );

  const classification = useMemo(() => {
    const h = Number(height);
    const w = Number(weight);
    if (!patientSex || !(h > 0) || !(w > 0)) return null;
    return classifyObesity({
      weightKg: w,
      heightCm: h,
      waistCm: waist ? Number(waist) : null,
      sex: patientSex,
    });
  }, [height, weight, waist, patientSex]);

  const hasWeightRelated = useMemo(
    () => [...complications].some((c) => WEIGHT_RELATED_COMPLICATIONS.has(c)),
    [complications],
  );
  const suggestion = suggestClinicalStatus({
    hasComplication: complications.size > 0,
    functionalLimitation: functionalLimit,
  });

  const bmi = classification?.bmi ?? null;
  const aom = bmi != null ? aomEligible(bmi, hasWeightRelated) : false;
  const bariatric =
    bmi != null
      ? bariatricReferralEligible({
          bmi,
          hasObesityComplication: hasWeightRelated,
          hasUncontrolledT2dm: complications.has("type2_diabetes"),
        })
      : false;

  function toggleComplication(code: string, checked: boolean) {
    setComplications((prev) => {
      const next = new Set(prev);
      if (checked) next.add(code);
      else next.delete(code);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Obesity assessment</CardTitle>
      </CardHeader>
      <CardContent>
        {!patientSex && (
          <p className="mb-4 text-sm text-amber-700">
            This patient has no sex on file — waist-risk thresholds are sex-specific, so set it before
            assessing.
          </p>
        )}
        <form action={formAction} className="space-y-5">
          {/* Measurements */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="height_cm">Height (cm)</Label>
              <Input
                id="height_cm"
                name="height_cm"
                type="number"
                step="0.1"
                required
                value={height}
                onChange={(e) => setHeight(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="weight_kg">Weight (kg)</Label>
              <Input
                id="weight_kg"
                name="weight_kg"
                type="number"
                step="0.1"
                required
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="waist_cm">Waist (cm, optional)</Label>
              <Input
                id="waist_cm"
                name="waist_cm"
                type="number"
                step="0.1"
                value={waist}
                onChange={(e) => setWaist(e.target.value)}
              />
            </div>
          </div>

          {/* Live objective classification */}
          {classification?.bmi != null && classification.bmiCategory && (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-mist-grey/40 p-3">
              <Badge>BMI {classification.bmi.toFixed(1)}</Badge>
              <Badge>{BMI_CATEGORY_LABELS[classification.bmiCategory]}</Badge>
              {classification.waistRisk && (
                <Badge variant={classification.waistRisk === "normal" ? "grey" : "amber"}>
                  Waist: {classification.waistRisk}
                </Badge>
              )}
              {classification.whtr != null && (
                <Badge variant={classification.whtrRaised ? "amber" : "grey"}>
                  WHtR {classification.whtr.toFixed(2)}
                </Badge>
              )}
              {classification.adiposityConfirmed != null && (
                <Badge variant={classification.adiposityConfirmed ? "amber" : "grey"}>
                  {classification.adiposityConfirmed ? "Adiposity confirmed" : "Adiposity not confirmed"}
                </Badge>
              )}
            </div>
          )}

          {/* Complication screen (§19) */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-charcoal-ink">
              Complications present (§19)
            </legend>
            <div className="grid grid-cols-2 gap-1.5">
              {OBESITY_COMPLICATIONS.map((code) => (
                <label key={code} className="flex items-start gap-2 text-sm text-charcoal-ink/80">
                  <input
                    type="checkbox"
                    name="complications"
                    value={code}
                    className="mt-0.5 h-4 w-4"
                    onChange={(e) => toggleComplication(code, e.target.checked)}
                  />
                  <span>{OBESITY_COMPLICATION_LABELS[code]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* Secondary-cause screen (§6.4) */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-charcoal-ink">
              Secondary / contributing causes to consider (§6.4)
            </legend>
            <div className="grid grid-cols-2 gap-1.5">
              {OBESITY_SECONDARY_CAUSES.map((code) => (
                <Checkbox
                  key={code}
                  name="secondary_causes"
                  value={code}
                  label={OBESITY_SECONDARY_CAUSE_LABELS[code]}
                />
              ))}
            </div>
          </fieldset>

          {/* Clinical judgement (§4.2 / §6.3) */}
          <div className="space-y-3 rounded-md border border-mist-grey p-3">
            <label className="flex items-start gap-2 text-sm text-charcoal-ink/80">
              <input
                type="checkbox"
                name="functional_limitation"
                className="mt-0.5 h-4 w-4"
                onChange={(e) => setFunctionalLimit(e.target.checked)}
              />
              <span>Functional limitation caused by excess adiposity</span>
            </label>
            <p className="text-xs text-charcoal-ink/60">
              Suggested: <strong>{suggestion.suggested}</strong> — {suggestion.rationale} This is your
              clinical decision to confirm.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="clinical_status">Clinical status</Label>
                <Select id="clinical_status" name="clinical_status" defaultValue="">
                  <option value="">— not yet decided —</option>
                  <option value="preclinical">Preclinical (risk state)</option>
                  <option value="clinical">Clinical (a disease)</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="eoss_stage">Edmonton stage (EOSS)</Label>
                <Select id="eoss_stage" name="eoss_stage" defaultValue="">
                  <option value="">— not staged —</option>
                  {EOSS_STAGES.map((s) => (
                    <option key={s.stage} value={s.stage}>
                      {s.label} — {s.description}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </div>

          {/* Treatment-ladder eligibility (§13.1 / §14.1) — informational */}
          {bmi != null && (
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant={aom ? "blue" : "grey"}>
                Anti-obesity medication: {aom ? "eligible" : "not eligible"}
              </Badge>
              <Badge variant={bariatric ? "blue" : "grey"}>
                Bariatric referral: {bariatric ? "eligible" : "not eligible"}
              </Badge>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" rows={2} />
          </div>

          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && <p className="text-sm text-brand-green">Assessment recorded.</p>}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Record assessment"}
          </Button>
        </form>

        <BariatricReferralForm patientId={patientId} eligibleHint={bariatric} />
      </CardContent>
    </Card>
  );
}

function BariatricReferralForm({
  patientId,
  eligibleHint,
}: {
  patientId: string;
  eligibleHint: boolean;
}) {
  const [state, formAction, pending] = useActionState<ObesityActionState, FormData>(
    createBariatricReferral.bind(null, patientId),
    undefined,
  );
  return (
    <form action={formAction} className="mt-6 space-y-3 border-t border-mist-grey pt-6">
      <p className="text-sm font-medium text-charcoal-ink">Metabolic / bariatric surgery referral (§14)</p>
      <p className="text-xs text-charcoal-ink/60">
        Uses the most recent assessment&apos;s BMI. Tarragon identifies candidates and refers — surgery is
        specialist, with lifelong follow-up.
        {eligibleHint ? " Current inputs meet a referral criterion." : ""}
      </p>
      <Checkbox name="has_obesity_complication" label="An obesity-related complication is present" />
      <Checkbox name="has_uncontrolled_t2dm" label="Type 2 diabetes not controlled by other means" />
      <div className="space-y-1.5">
        <Label htmlFor="bariatric_notes">Referral notes</Label>
        <Textarea id="bariatric_notes" name="notes" rows={2} />
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.success && <p className="text-sm text-brand-green">Referral recorded.</p>}
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Referring…" : "Refer for surgery assessment"}
      </Button>
    </form>
  );
}
