"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { signRiskAcceptance, type SignState } from "./actions";

export function SignForm({ maxDate }: { maxDate: string }) {
  const [state, action, pending] = useActionState<SignState, FormData>(signRiskAcceptance, undefined);
  return (
    <form action={action} className="space-y-3">
      <label className="block text-sm" htmlFor="ai-risk-summary">The risk you are accepting, in your own words</label>
      <Textarea id="ai-risk-summary" name="summary" rows={4} required minLength={20} />
      <label className="block text-sm" htmlFor="ai-risk-until">Valid until (no later than {maxDate})</label>
      <input id="ai-risk-until" name="valid_until" type="date" max={maxDate} required className="rounded-md border border-charcoal-ink/20 px-2 py-1 text-sm" />
      <div>
        <Button type="submit" disabled={pending}>{pending ? "Signing..." : "Sign as Chief Medical Officer"}</Button>
      </div>
      {state?.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state?.done && <p role="status" className="text-sm text-brand-green">Signed.</p>}
    </form>
  );
}
