"use client";

import { useActionState } from "react";
import { submitSocialDeterminantsCheck } from "./healthy-ageing-actions";
import { Button } from "@/components/ui/button";

const FACTORS: { name: string; label: string }[] = [
  { name: "living_alone", label: "I live alone" },
  { name: "transport_difficulty", label: "Getting to appointments is difficult" },
  { name: "financial_barrier", label: "Cost makes it hard to get care or medication" },
  { name: "caregiver_limitation", label: "The people who usually help me have limited time or ability" },
  { name: "healthcare_access_difficulty", label: "It's generally hard for me to reach healthcare" },
];

export function SocialDeterminantsForm() {
  const [state, formAction, pending] = useActionState(submitSocialDeterminantsCheck, undefined);

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
      {state?.success && <p className="text-sm text-brand-green">Thanks — recorded.</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
