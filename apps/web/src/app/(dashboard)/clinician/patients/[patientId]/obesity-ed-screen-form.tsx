"use client";

import { useActionState } from "react";
import { submitObesityEdScreen, type ObesityActionState } from "./obesity-actions";
import {
  ED_DISORDERED_BEHAVIOURS,
  ED_DISORDERED_BEHAVIOUR_LABELS,
} from "@/lib/validation/obesity";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SCOFF_ITEMS: { name: string; label: string }[] = [
  { name: "scoff_sick", label: "Do you make yourself Sick because you feel uncomfortably full?" },
  { name: "scoff_control", label: "Do you worry you have lost Control over how much you eat?" },
  { name: "scoff_one_stone", label: "Have you recently lost more than One stone (6.35 kg) in 3 months?" },
  { name: "scoff_fat", label: "Do you believe yourself to be Fat when others say you are too thin?" },
  { name: "scoff_food_dominates", label: "Would you say that Food dominates your life?" },
];

export function ObesityEdScreenForm({ patientId }: { patientId: string }) {
  const [state, formAction, pending] = useActionState<ObesityActionState, FormData>(
    submitObesityEdScreen.bind(null, patientId),
    undefined,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Eating-disorder &amp; mental-health screen</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-charcoal-ink/70">
          Mandatory before any weight-loss plan (§6.5, §18). A positive screen automatically pauses
          weight-loss tasks and raises a doctor alert — treat the eating disorder or mental-health need
          first.
        </p>
        <form action={formAction} className="space-y-5">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-charcoal-ink">SCOFF</legend>
            {SCOFF_ITEMS.map((item) => (
              <label key={item.name} className="flex items-start gap-2 text-sm text-charcoal-ink/80">
                <input type="checkbox" name={item.name} className="mt-0.5 h-4 w-4" />
                <span>{item.label}</span>
              </label>
            ))}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-charcoal-ink">Disordered-eating behaviours</legend>
            {ED_DISORDERED_BEHAVIOURS.map((code) => (
              <label key={code} className="flex items-start gap-2 text-sm text-charcoal-ink/80">
                <input type="checkbox" name="disordered_behaviours" value={code} className="mt-0.5 h-4 w-4" />
                <span>{ED_DISORDERED_BEHAVIOUR_LABELS[code]}</span>
              </label>
            ))}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-charcoal-ink">Mood</legend>
            <label className="flex items-start gap-2 text-sm text-charcoal-ink/80">
              <input type="checkbox" name="low_mood" className="mt-0.5 h-4 w-4" />
              <span>Marked low mood, hopelessness or worsening anxiety</span>
            </label>
            <label className="flex items-start gap-2 text-sm font-medium text-red-700">
              <input type="checkbox" name="self_harm_risk" className="mt-0.5 h-4 w-4" />
              <span>Any thoughts of self-harm or suicide (emergency response)</span>
            </label>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="ed_notes">Notes</Label>
            <Textarea id="ed_notes" name="notes" rows={2} />
          </div>

          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && state.positive && (
            <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              Screen positive. Weight-loss tasks have been paused and a doctor alert raised — review and
              refer per §18 before resuming weight-loss care.
            </p>
          )}
          {state?.success && !state.positive && (
            <p className="text-sm text-brand-green">Screen recorded — no eating-disorder / mental-health flag.</p>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Record screen"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
