"use client";

import { useActionState } from "react";
import type { MessageKey } from "@tarragon/i18n";
import { readFounderViewAction } from "@/lib/outcomes/dashboard-actions";
import { FOUNDER_IDLE, type FounderState } from "@/lib/outcomes/founder-state";
import { ComparisonPanel, OutcomesPanel, tt } from "./outcomes-panels";

const MESSAGE: Record<"off" | "refused" | "reason" | "failed", MessageKey> = {
  off: "outcomes.dash.founder.off",
  refused: "outcomes.dash.founder.refused",
  reason: "outcomes.dash.founder.reason_needed",
  failed: "outcomes.dash.founder.error",
};

/**
 * The founder's unfrozen view. The warning is rendered whatever the state (before, during, after and on every error) and is not dismissible. The
 * figures live only in this component's state: they are not stored, not put in the address, and there is no download for them anywhere.
 */
export function FounderView() {
  const [state, action, pending] = useActionState<FounderState, FormData>(readFounderViewAction, FOUNDER_IDLE);
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div role="alert" className="rounded-xl border-2 border-red-700 bg-red-50 p-4 text-base font-semibold text-red-950" data-testid="founder-banner">
        {tt("outcomes.dash.founder.banner")}
      </div>
      <header className="space-y-1">
        <h1 className="font-heading text-xl font-semibold text-charcoal-ink">{tt("outcomes.dash.founder.title")}</h1>
        <p className="text-sm text-charcoal-ink/70">{tt("outcomes.dash.founder.intro")}</p>
      </header>

      <form action={action} className="space-y-2 rounded-xl border border-charcoal-ink/10 p-4">
        <label className="block text-sm">
          {tt("outcomes.dash.founder.reason")}
          <textarea name="reason" required minLength={10} maxLength={500} rows={2} className="mt-1 block w-full rounded-lg border border-charcoal-ink/20 px-3 py-2 text-sm" />
        </label>
        <button type="submit" disabled={pending} className="min-h-11 rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white">
          {tt("outcomes.dash.founder.open")}
        </button>
      </form>

      {state.status === "error" && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">{tt(MESSAGE[state.message])}</p>}

      {state.status === "ok" && (
        <>
          <p className="text-sm font-medium">{tt("outcomes.dash.founder.as_of", { date: state.view.as_of })}</p>
          <OutcomesPanel outcomes={state.view.outcomes} />
          <ComparisonPanel comparison={state.view.comparison} />
        </>
      )}
    </div>
  );
}
