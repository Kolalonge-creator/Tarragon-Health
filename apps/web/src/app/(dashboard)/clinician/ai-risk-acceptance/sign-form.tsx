"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MAX_ACCEPTANCE_DAYS, MAX_ACCEPTANCE_DAYS_NO_RERUN } from "@/lib/clinician/ai-risk-acceptance";
import { signRiskAcceptance, type SignState } from "./actions";

export function SignForm({ maxDate, maxDateNoRerun }: { maxDate: string; maxDateNoRerun: string }) {
  const [state, action, pending] = useActionState<SignState, FormData>(signRiskAcceptance, undefined);
  return (
    <form action={action} className="space-y-3">
      <label className="block text-sm" htmlFor="ai-risk-summary">The risk you are accepting, in your own words</label>
      <Textarea id="ai-risk-summary" name="summary" rows={4} required minLength={20} />
      <label className="block text-sm" htmlFor="ai-risk-run">Re-evaluation run this relies on (its id)</label>
      <input id="ai-risk-run" name="evaluation_run_id" className="w-full rounded-md border border-charcoal-ink/20 px-2 py-1 text-sm" />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="no_rerun_yet" /> No re-evaluation has been re-run yet (valid for at most {MAX_ACCEPTANCE_DAYS_NO_RERUN} days, until {maxDateNoRerun})
      </label>
      <label className="block text-sm" htmlFor="ai-risk-until">Valid until (at most {MAX_ACCEPTANCE_DAYS} days with a re-run, until {maxDate})</label>
      <input id="ai-risk-until" name="valid_until" type="date" max={maxDate} required className="rounded-md border border-charcoal-ink/20 px-2 py-1 text-sm" />
      <div>
        <Button type="submit" disabled={pending}>{pending ? "Signing..." : "Sign as Chief Medical Officer"}</Button>
      </div>
      {state?.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state?.done && <p role="status" className="text-sm text-brand-green">Signed.</p>}
    </form>
  );
}
