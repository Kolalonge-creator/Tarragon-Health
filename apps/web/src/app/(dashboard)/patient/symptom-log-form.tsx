"use client";

import { useActionState, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { logSymptom } from "./actions";
import { activeEmergencyKey } from "@/lib/queries/emergency";
import { SYMPTOM_TYPES, type SymptomLogInput } from "@/lib/validation/symptoms";
import { PAEDIATRIC_SYMPTOM_TYPES, shouldOfferPaediatricSymptomTypes } from "@/lib/rules/pediatric-symptom-triage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError, FormSuccess, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";

const SYMPTOM_LABEL: Record<SymptomLogInput["symptom_type"], string> = {
  pain: "Pain",
  fatigue: "Fatigue",
  breathlessness: "Breathlessness",
  dizziness: "Dizziness",
  palpitations: "Palpitations (racing/irregular heartbeat)",
  swelling: "Swelling",
  nausea: "Nausea",
  chest_pain: "Chest pain or pressure",
  severe_headache: "Severe headache",
  visual_disturbance: "Vision changes (blurred, dimmed, or lost)",
  confusion: "Confusion or drowsiness",
  poor_feeding: "Feeding much less than usual, or refusing to feed",
  lethargy: "Unusually sleepy, floppy, or hard to wake",
  grunting_or_retractions: "Grunting, or the chest pulling in with each breath",
  dehydration_signs: "Fewer wet nappies, dry mouth, or no tears when crying",
  other: "Other",
};

const PEDIATRIC_TYPE_SET = new Set<string>(PAEDIATRIC_SYMPTOM_TYPES);
/** Adult symptom types, in their existing order, with 'other' always last. */
const ADULT_SYMPTOM_TYPES = SYMPTOM_TYPES.filter((t) => !PEDIATRIC_TYPE_SET.has(t));

/** Severity-slider track colour: calm green low, amber mid, red only at the
 * top end. Purely a visual cue, matches SYMPTOM_LABEL's own tone, never a
 * verdict, and the copy below the slider stays informational rather than
 * alarming either way (brand voice: no fear-based urgency). */
function severityTrackColor(severity: number): string {
  if (severity >= 8) return "accent-red-600";
  if (severity >= 6) return "accent-amber-500";
  return "accent-brand-green";
}

export function SymptomLogForm({
  patientId,
  ageYears = null,
  medicationId,
  drugName,
}: {
  patientId: string;
  /** The account being logged for, not the caller — pass the acting-for
   * subject's age (dashboard-context.ts's subjectDateOfBirth) so a parent
   * logging for a young child sees the paediatric-specific options
   * (§48.8: "must not simply reuse adult rules"). */
  ageYears?: number | null;
  /** Medication safety pathway 64.9: scopes this to "I'm experiencing a side effect" for one medication. */
  medicationId?: string;
  drugName?: string;
}) {
  const [severity, setSeverity] = useState(5);
  const [state, formAction, pending] = useActionState(logSymptom, undefined);
  const queryClient = useQueryClient();
  // The action returns one message for the whole log rather than a per-field
  // one, so every control on the form points at the same alert.
  const errorId = fieldErrorId("symptom-log");
  const invalid = Boolean(state?.error);
  const visibleTypes = shouldOfferPaediatricSymptomTypes(ageYears)
    ? [...ADULT_SYMPTOM_TYPES.filter((t) => t !== "other"), ...PAEDIATRIC_SYMPTOM_TYPES, "other" as const]
    : ADULT_SYMPTOM_TYPES;

  useEffect(() => {
    if (state?.success) {
      queryClient.invalidateQueries({ queryKey: ["symptom-logs", patientId] });
      // A high-severity symptom raises an emergency_events row server-side —
      // surface the EmergencyAlert dialog immediately rather than on next poll.
      queryClient.invalidateQueries({ queryKey: activeEmergencyKey(patientId) });
    }
  }, [state?.success, queryClient, patientId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{medicationId ? "Report a side effect" : "Log a symptom"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          {medicationId && (
            <>
              <input type="hidden" name="medication_id" value={medicationId} />
              <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                Reporting a side effect for {drugName ?? "this medication"}. Your care team will
                see this alongside your medication list.
              </p>
            </>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="symptom_type">Symptom</Label>
            <Select
              id="symptom_type"
              name="symptom_type"
              defaultValue="other"
              required
              {...fieldErrorProps(errorId, invalid)}
            >
              {visibleTypes.map((value) => (
                <option key={value} value={value}>
                  {SYMPTOM_LABEL[value]}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="severity">Severity</Label>
              <span className="text-sm font-semibold text-charcoal-ink dark:text-night-ink">{severity}/10</span>
            </div>
            <input
              id="severity"
              name="severity"
              type="range"
              min={1}
              max={10}
              value={severity}
              onChange={(event) => setSeverity(Number(event.target.value))}
              className={`w-full ${severityTrackColor(severity)}`}
              {...fieldErrorProps(errorId, invalid, "symptom-severity-hint")}
            />
            <p
              id="symptom-severity-hint"
              className="text-xs text-charcoal-ink/60 dark:text-night-ink/60"
            >
              1 = barely noticeable, 10 = worst you&apos;ve ever felt.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Note (optional)</Label>
            <Input
              id="description"
              name="description"
              type="text"
              maxLength={500}
              {...fieldErrorProps(errorId, invalid)}
            />
          </div>

          <FormError id={errorId} message={state?.error} />
          <FormSuccess message={state?.success && "Symptom logged."} />

          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save symptom"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
