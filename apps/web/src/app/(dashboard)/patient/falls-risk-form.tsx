"use client";

import { useActionState } from "react";
import { submitFallsRiskCheck } from "./healthy-ageing-actions";
import { Button } from "@/components/ui/button";

const FACTORS: { name: string; label: string }[] = [
  { name: "previous_falls_12mo", label: "A fall in the last 12 months" },
  { name: "mobility_impairment", label: "Trouble with balance or walking" },
  { name: "high_risk_medications", label: "On medication that can affect balance or alertness" },
  { name: "environmental_hazards", label: "Loose rugs, poor lighting, or stairs without rails at home" },
  { name: "balance_concern", label: "Feeling unsteady on your feet" },
];

export function FallsRiskForm() {
  const [state, formAction, pending] = useActionState(submitFallsRiskCheck, undefined);

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex flex-col gap-1.5">
        {FACTORS.map((f) => (
          <label key={f.name} className="flex items-center gap-1.5 text-sm text-charcoal-ink/80">
            <input type="checkbox" name={f.name} className="h-4 w-4" />
            {f.label}
          </label>
        ))}
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.success && <p className="text-sm text-brand-green">Thanks — flagged for your care team.</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
