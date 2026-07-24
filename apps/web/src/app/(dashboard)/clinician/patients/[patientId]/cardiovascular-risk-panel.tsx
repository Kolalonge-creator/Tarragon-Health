"use client";

import { useActionState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveCvProfile, type SaveCvProfileState } from "./cv-profile-actions";
import type { CvRiskAssessment } from "@/lib/rules/cv-risk";

export type CvProfileFlags = {
  established_ascvd: boolean;
  prior_mi: boolean;
  prior_stroke_tia: boolean;
  prior_pad: boolean;
  prior_revascularisation: boolean;
  familial_hypercholesterolaemia: boolean;
  notes: string | null;
};

const FLAG_FIELDS: { name: keyof CvProfileFlags; label: string }[] = [
  { name: "established_ascvd", label: "Established ASCVD" },
  { name: "prior_mi", label: "Prior heart attack (MI)" },
  { name: "prior_stroke_tia", label: "Prior stroke / TIA" },
  { name: "prior_pad", label: "Peripheral arterial disease" },
  { name: "prior_revascularisation", label: "Prior revascularisation (stent/CABG)" },
  { name: "familial_hypercholesterolaemia", label: "Familial hypercholesterolaemia" },
];

const STATIN_LABEL: Record<CvRiskAssessment["statinRecommendation"], string> = {
  secondary_prevention_recommended:
    "Lipid-lowering therapy near-automatic (secondary / high risk) — review & decide.",
  primary_risk_based_recommended:
    "Statin is a lifestyle-first conversation (risk above threshold) — not automatic.",
  primary_lifestyle_first: "Lifestyle first — statin not routinely indicated.",
  insufficient_data: "Not enough data to stratify — gather a lipid panel + risk factors.",
};

const RISK_VARIANT: Record<string, "red" | "amber" | "blue" | "grey" | "green"> = {
  low: "green",
  moderate: "amber",
  high: "amber",
  very_high: "red",
};

export function CardiovascularRiskPanel({
  patientId,
  assessment,
  initialProfile,
}: {
  patientId: string;
  assessment: CvRiskAssessment | null;
  initialProfile: CvProfileFlags | null;
}) {
  const [state, formAction, pending] = useActionState<SaveCvProfileState, FormData>(
    (prev, formData) => saveCvProfile(patientId, prev, formData),
    undefined
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Cardiovascular risk &amp; lipids
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {assessment ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={assessment.preventionCategory === "secondary" ? "red" : "blue"}>
                {assessment.preventionCategory === "secondary"
                  ? "Secondary / high risk"
                  : "Primary prevention"}
              </Badge>
              <Badge variant={RISK_VARIANT[assessment.riskCategory] ?? "grey"}>
                {assessment.riskCategory.replace("_", " ")} risk
              </Badge>
              {assessment.atTarget !== null && (
                <Badge variant={assessment.atTarget ? "green" : "red"}>
                  {assessment.atTarget ? "At target" : "Above target"}
                </Badge>
              )}
              {!assessment.configSigned && (
                <Badge variant="grey">Provisional — awaiting Medical-Director sign-off</Badge>
              )}
            </div>

            <p className="text-sm text-charcoal-ink/80">
              {STATIN_LABEL[assessment.statinRecommendation]}
            </p>
            <p className="text-xs text-charcoal-ink/60">
              Targets: LDL ≤ {assessment.ldlTargetMgDl} mg/dL · Non-HDL ≤{" "}
              {assessment.nonHdlTargetMgDl} mg/dL. Lipid decisions follow total CV risk, not the
              cholesterol value alone.
            </p>

            {assessment.escalations.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-800">
                  Flagged for review
                </p>
                <ul className="list-disc space-y-1 pl-4 text-sm text-amber-900">
                  {assessment.escalations.map((e) => (
                    <li key={e.code}>{e.label}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-amber-800/80">
                  These are prompts for your clinical judgement — no medication is started
                  automatically.
                </p>
              </div>
            )}

            {assessment.rationale.length > 0 && (
              <details className="text-xs text-charcoal-ink/60">
                <summary className="cursor-pointer">Why</summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {assessment.rationale.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </details>
            )}
            <p className="text-xs text-charcoal-ink/50">{assessment.populationNote}</p>
          </div>
        ) : (
          <p className="text-sm text-charcoal-ink/60">
            Not enough data yet to assess cardiovascular risk.
          </p>
        )}

        <form action={formAction} className="space-y-3 border-t border-charcoal-ink/10 pt-4">
          <p className="text-sm font-medium text-charcoal-ink">
            Cardiovascular history (sets primary vs secondary prevention)
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {FLAG_FIELDS.map((f) => (
              <label key={f.name} className="flex items-center gap-2 text-sm text-charcoal-ink/80">
                <input
                  type="checkbox"
                  name={f.name}
                  defaultChecked={Boolean(initialProfile?.[f.name])}
                  className="h-4 w-4 rounded border-charcoal-ink/30"
                />
                {f.label}
              </label>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cv_notes">Notes</Label>
            <Textarea
              id="cv_notes"
              name="notes"
              rows={2}
              defaultValue={initialProfile?.notes ?? ""}
              placeholder="Optional context for the cardiovascular history."
            />
          </div>
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && <p className="text-sm text-brand-green">Saved.</p>}
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save cardiovascular history"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
