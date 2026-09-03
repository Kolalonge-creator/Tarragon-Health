"use client";

import { useActionState, useEffect, useState } from "react";
import { reportBreastSymptoms } from "./womens-health-actions";
import { useBreastSymptomReports, useInvalidateWomensHealth } from "@/lib/queries/womens-health";
import {
  BREAST_SYMPTOM_TYPES,
  BREAST_SYMPTOM_LABEL,
  type BreastSymptomType,
} from "@/lib/validation/womens-health";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Breast health — symptom reporting (§44.11), deliberately a separate card
 * from breast screening (see the Prevention section's screening ladder):
 * noticing a lump or discharge is not "due for a mammogram", it's a possible
 * investigation trigger now. Submitting raises a clinical clinician_review
 * alert server-side (breast_symptom_reports_raise_alert trigger) — this
 * card never decides urgency itself.
 */
export function BreastSymptomCard({ patientId }: { patientId: string }) {
  const reports = useBreastSymptomReports(patientId);
  const invalidate = useInvalidateWomensHealth(patientId);
  const [state, formAction, pending] = useActionState(reportBreastSymptoms, undefined);
  const [symptomTypes, setSymptomTypes] = useState<Set<BreastSymptomType>>(new Set());

  useEffect(() => {
    if (state?.success) invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.success]);

  function toggle(type: BreastSymptomType) {
    setSymptomTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Breast health: report a symptom</CardTitle>
        <CardDescription>
          Noticed something new? Report it here for clinical assessment, separate from your
          routine breast screening.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form action={formAction} className="space-y-4">
          <div className="space-y-1.5">
            <Label>What have you noticed?</Label>
            <div className="flex flex-wrap gap-2">
              {BREAST_SYMPTOM_TYPES.map((type) => {
                const isOn = symptomTypes.has(type);
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => toggle(type)}
                    aria-pressed={isOn}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                      isOn
                        ? "border-brand-green bg-brand-green text-white"
                        : "border-charcoal-ink/20 bg-white text-charcoal-ink hover:border-brand-green/50"
                    )}
                  >
                    {BREAST_SYMPTOM_LABEL[type]}
                  </button>
                );
              })}
            </div>
            {[...symptomTypes].map((type) => (
              <input key={type} type="hidden" name="symptom_types" value={type} />
            ))}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="laterality">Side</Label>
              <Select id="laterality" name="laterality" defaultValue="">
                <option value="">Not sure</option>
                <option value="left">Left</option>
                <option value="right">Right</option>
                <option value="both">Both</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="duration_note">How long?</Label>
              <Input id="duration_note" name="duration_note" placeholder="e.g. about a week" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Anything else?</Label>
            <Input id="notes" name="notes" />
          </div>

          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && (
            <p className="text-sm text-brand-green">
              Reported. Your care team has been notified for clinical assessment.
            </p>
          )}

          <Button type="submit" size="sm" disabled={pending || symptomTypes.size === 0}>
            {pending ? "Reporting…" : "Report symptom"}
          </Button>
        </form>

        {reports.data && reports.data.length > 0 && (
          <div className="space-y-1.5 border-t border-charcoal-ink/10 pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">
              Past reports
            </p>
            {reports.data.slice(0, 5).map((r) => (
              <p key={r.id} className="text-sm text-charcoal-ink/80">
                {new Date(r.created_at).toLocaleDateString()}:{" "}
                {r.symptom_types.map((t) => BREAST_SYMPTOM_LABEL[t]).join(", ")}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
