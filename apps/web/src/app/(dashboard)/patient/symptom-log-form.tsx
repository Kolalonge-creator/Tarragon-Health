"use client";

import { useActionState, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { logSymptom } from "./actions";
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
  other: "Other",
};

export function SymptomLogForm({ patientId }: { patientId: string }) {
  const [severity, setSeverity] = useState(5);
  const [state, formAction, pending] = useActionState(logSymptom, undefined);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (state?.success) {
      queryClient.invalidateQueries({ queryKey: ["symptom-logs", patientId] });
    }
  }, [state?.success, queryClient, patientId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log a symptom</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
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
            <Label htmlFor="severity">
              Severity — {severity}/10
            </Label>
            <input
              id="severity"
              name="severity"
              type="range"
              min={1}
              max={10}
              value={severity}
              onChange={(event) => setSeverity(Number(event.target.value))}
              className="w-full accent-brand-green"
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
