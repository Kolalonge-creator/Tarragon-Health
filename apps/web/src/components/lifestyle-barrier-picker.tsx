"use client";

import { useActionState, useState } from "react";
import { reportLifestyleBarrierAction, type BarrierActionState } from "./lifestyle-barrier-actions";
import {
  LIFESTYLE_BARRIER_CODES,
  LIFESTYLE_BARRIER_LABELS,
  LIFESTYLE_DOMAINS,
} from "@/lib/validation/lifestyle-barriers";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SEMANTIC_ICON } from "@/lib/icons";

/**
 * The spec §18.14 "what's making this difficult?" check-in — a small,
 * collapsed-by-default form embeddable on any domain tracking page. Kept
 * deliberately low-friction (a few taps, no required note) since it's meant
 * to be used in the moment a goal feels hard, not as a formal assessment.
 */
export function LifestyleBarrierPicker({ domain }: { domain: (typeof LIFESTYLE_DOMAINS)[number] }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<BarrierActionState, FormData>(
    async (prev, formData) => {
      const result = await reportLifestyleBarrierAction(prev, formData);
      if (result?.success) setOpen(false);
      return result;
    },
    undefined,
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 text-sm font-medium text-charcoal-ink/70 hover:text-brand-green"
      >
        <SEMANTIC_ICON.barrier className="h-4 w-4" strokeWidth={2} />
        What&apos;s making this difficult?
      </button>
    );
  }

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-lg border border-charcoal-ink/10 bg-soft-sage/40 p-4"
    >
      <input type="hidden" name="domain" value={domain} />
      <p className="text-sm font-medium text-charcoal-ink">What&apos;s making this difficult?</p>
      <div className="flex flex-wrap gap-2">
        {LIFESTYLE_BARRIER_CODES.map((code) => (
          <label
            key={code}
            className="flex items-center gap-1.5 rounded-full border border-charcoal-ink/15 bg-white px-3 py-1 text-xs has-[:checked]:border-brand-green has-[:checked]:bg-soft-sage"
          >
            <input type="checkbox" name="barrier_codes" value={code} className="h-3 w-3" />
            {LIFESTYLE_BARRIER_LABELS[code]}
          </label>
        ))}
      </div>
      <Textarea name="note" placeholder="Anything else you'd like your care team to know? (optional)" rows={2} />
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state?.success && <p className="text-sm text-brand-green">Thanks — your care team can see this.</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Share this"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
