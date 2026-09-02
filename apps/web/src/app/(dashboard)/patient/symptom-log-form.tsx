"use client";

import { useActionState, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { logSymptom } from "./actions";
import { activeEmergencyKey } from "@/lib/queries/emergency";
import { SYMPTOM_TYPES, type SymptomLogInput } from "@/lib/validation/symptoms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
  other: "Other",
};

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
  medicationId,
  drugName,
}: {
  patientId: string;
  /** Medication safety pathway 64.9: scopes this to "I'm experiencing a side effect" for one medication. */
  medicationId?: string;
  drugName?: string;
}) {
  const [severity, setSeverity] = useState(5);
  const [state, formAction, pending] = useActionState(logSymptom, undefined);
  const queryClient = useQueryClient();

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
              <p className="text-xs text-charcoal-ink/60">
                Reporting a side effect for {drugName ?? "this medication"}. Your care team will
                see this alongside your medication list.
              </p>
            </>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="symptom_type">Symptom</Label>
            <Select id="symptom_type" name="symptom_type" defaultValue="other" required>
              {SYMPTOM_TYPES.map((value) => (
                <option key={value} value={value}>
                  {SYMPTOM_LABEL[value]}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="severity">Severity</Label>
              <span className="text-sm font-semibold text-charcoal-ink">{severity}/10</span>
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
            />
            <p className="text-xs text-charcoal-ink/60">
              1 = barely noticeable, 10 = worst you&apos;ve ever felt.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Note (optional)</Label>
            <Input id="description" name="description" type="text" maxLength={500} />
          </div>

          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && (
            <p className="text-sm text-brand-green">Symptom logged.</p>
          )}

          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save symptom"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
