"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { approveAiItemsAction, type AiGovernanceActionState } from "./actions";

export interface AiApprovalItem {
  id: string;
  /** Name of the AI system this belongs to, or null for a source open to every system. */
  systemName: string | null;
  headline: string;
  detail: string;
  /** Extra line the person should read before approving (enforcement, citation label, source). */
  meta: string;
}

/**
 * One list of unapproved guardrails or knowledge sources with a tick box on
 * each. Nothing is ticked to start with: approving is the Chief Medical
 * Officer's own judgement, so the page never pre-selects on their behalf.
 * "Tick all shown" is a convenience for someone who has just read the list.
 */
export function AiApprovalList({
  kind,
  items,
}: {
  kind: "guardrails" | "knowledge_sources";
  items: AiApprovalItem[];
}) {
  const [state, action, pending] = useActionState<AiGovernanceActionState, FormData>(approveAiItemsAction, undefined);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const noun = kind === "guardrails" ? "guardrail" : "knowledge source";

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="kind" value={kind} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button type="button" variant="outline" size="sm" onClick={() => setPicked(new Set(items.map((i) => i.id)))}>
          Tick all shown
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setPicked(new Set())}>
          Clear
        </Button>
        <span className="text-charcoal-ink/60">{picked.size} of {items.length} ticked</span>
      </div>

      <ul className="divide-y divide-charcoal-ink/10 rounded-lg border border-charcoal-ink/10 bg-white">
        {items.map((i) => (
          <li key={i.id} className="flex gap-3 p-3">
            <input
              type="checkbox"
              name="ids"
              value={i.id}
              checked={picked.has(i.id)}
              onChange={() => toggle(i.id)}
              aria-label={`Approve ${i.headline}`}
              className="mt-1 h-4 w-4 shrink-0"
            />
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium text-charcoal-ink">
                {i.headline}
                <span className="font-normal text-charcoal-ink/50"> · {i.systemName ?? "all AI systems"}</span>
              </p>
              <p className="text-sm text-charcoal-ink/80">{i.detail}</p>
              <p className="text-xs text-charcoal-ink/60">{i.meta}</p>
            </div>
          </li>
        ))}
      </ul>

      <Textarea name="note" rows={2} placeholder="What you reviewed, and any conditions (optional)" />
      <Button type="submit" size="sm" disabled={pending || picked.size === 0}>
        {pending ? "Approving…" : `Approve ${picked.size} ${noun}${picked.size === 1 ? "" : "s"}`}
      </Button>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.success && <p className="text-sm text-brand-green">{state.success}</p>}
    </form>
  );
}
