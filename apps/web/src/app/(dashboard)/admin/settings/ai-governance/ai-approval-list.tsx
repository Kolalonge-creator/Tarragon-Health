"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  approveAiGuardrailsAction,
  approveAiKnowledgeSourcesAction,
  reviewAiEvaluationRunAction,
  type AiGovernanceActionState,
} from "./actions";

export interface AiApprovalItem {
  id: string;
  headline: string;
  detail: string;
  /** Extra line the person should read before approving (enforcement, source). */
  meta: string;
}

function Feedback({ state }: { state: AiGovernanceActionState }) {
  if (state?.error) return <p className="text-sm text-red-600">{state.error}</p>;
  if (state?.success) return <p className="text-sm text-brand-green">{state.success}</p>;
  return null;
}

function ItemText({ i }: { i: AiApprovalItem }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-sm font-medium text-charcoal-ink">{i.headline}</p>
      <p className="text-sm text-charcoal-ink/80">{i.detail}</p>
      <p className="text-xs text-charcoal-ink/60">{i.meta}</p>
    </div>
  );
}

/**
 * Guardrails are approved one AI system at a time: the person reads the whole
 * list shown here and approves it with the count they read, so the database
 * refuses if a rule was added in the meantime.
 */
export function AiGuardrailApproval({
  systemCode,
  systemName,
  items,
}: {
  systemCode: string;
  systemName: string;
  items: AiApprovalItem[];
}) {
  const [state, action, pending] = useActionState<AiGovernanceActionState, FormData>(approveAiGuardrailsAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="systemCode" value={systemCode} />
      <input type="hidden" name="expectedCount" value={items.length} />
      <p className="text-sm font-medium text-charcoal-ink/80">
        {systemName} <span className="font-mono text-xs text-charcoal-ink/50">· {systemCode}</span>
      </p>
      <ul className="divide-y divide-charcoal-ink/10 rounded-lg border border-charcoal-ink/10 bg-white">
        {items.map((i) => (
          <li key={i.id} className="p-3">
            <ItemText i={i} />
          </li>
        ))}
      </ul>
      <Textarea name="note" rows={2} placeholder="What you reviewed, and any conditions (optional)" />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Approving…" : `I have read these ${items.length}: approve them`}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

/**
 * Knowledge sources are approved by tick box. Nothing is ticked to start
 * with: approving is the Chief Medical Officer's own judgement, so the page
 * never pre-selects on their behalf.
 */
export function AiKnowledgeSourceApproval({ items }: { items: AiApprovalItem[] }) {
  const [state, action, pending] = useActionState<AiGovernanceActionState, FormData>(approveAiKnowledgeSourcesAction, undefined);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <form action={action} className="space-y-3">
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
            <ItemText i={i} />
          </li>
        ))}
      </ul>
      <Textarea name="note" rows={2} placeholder="What you reviewed, and any conditions (optional)" />
      <Button type="submit" size="sm" disabled={pending || picked.size === 0}>
        {pending ? "Approving…" : `Approve ${picked.size} knowledge source${picked.size === 1 ? "" : "s"}`}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export interface AiRunReviewItem extends AiApprovalItem {
  /** The outcome shown on the page (pass, fail or needs_review). The database refuses if the run was rescored since. */
  outcome: "pass" | "fail" | "needs_review";
}

/**
 * One finished evaluation result. Reading it is the person's own judgement, so nothing is pre-filled; the outcome shown is sent back
 * with the run so the database refuses if the result changed after the page loaded. A fail stays a fail: this records that it was read.
 */
export function AiRunReview({ item }: { item: AiRunReviewItem }) {
  const [state, action, pending] = useActionState<AiGovernanceActionState, FormData>(reviewAiEvaluationRunAction, undefined);
  return (
    <form action={action} className="space-y-2 p-3">
      <input type="hidden" name="runId" value={item.id} />
      <input type="hidden" name="expectedOutcome" value={item.outcome} />
      <ItemText i={item} />
      <Textarea name="note" rows={1} placeholder="What you checked (optional)" />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Recording…" : "I have read this result"}
      </Button>
      <Feedback state={state} />
    </form>
  );
}
