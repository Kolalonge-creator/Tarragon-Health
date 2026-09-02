"use client";

import { useActionState, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { recordCdsDecision } from "./cds-actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { CdsRecommendation, CdsPriority } from "@/lib/cds/types";

const PRIORITY_BADGE: Record<CdsPriority, { label: string; variant: "red" | "amber" | "grey" }> = {
  high: { label: "High priority", variant: "red" },
  medium: { label: "Medium priority", variant: "amber" },
  low: { label: "Low priority", variant: "grey" },
};

type DecisionChoice = "accepted" | "actioned" | "overridden" | "deferred";

const DECISION_LABEL: Record<DecisionChoice, string> = {
  accepted: "Accept",
  actioned: "Actioned now",
  overridden: "Override",
  deferred: "Defer",
};

/**
 * One recommendation, point-of-care (§38.4): the trigger text answers §38.13
 * ("Why am I seeing this?"), the source label is always visible (§38.5), and
 * the decision control is how §38.12 gets its reason/clinician/timestamp and
 * §38.14 gets a documented outcome. Nothing here can block anything else on
 * the page — this only records what the clinician chose.
 */
export function CdsRecommendationCard({
  recommendation,
  patientId,
  organisationId,
}: {
  recommendation: CdsRecommendation;
  patientId: string;
  organisationId: string;
}) {
  const action = recordCdsDecision.bind(null, patientId, organisationId);
  const [state, formAction, pending] = useActionState(action, undefined);
  const [decision, setDecision] = useState<DecisionChoice>("accepted");
  const router = useRouter();
  const priorityBadge = PRIORITY_BADGE[recommendation.priority];

  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state?.success, router]);

  if (state?.success) {
    return (
      <div className="rounded-lg border border-brand-green/30 bg-brand-green/5 p-3 text-sm text-charcoal-ink/70">
        Recorded: {DECISION_LABEL[decision]} — {recommendation.title}
      </div>
    );
  }

  const needsReason = decision === "overridden" || decision === "deferred";

  return (
    <div className="space-y-2 rounded-lg border border-charcoal-ink/10 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={priorityBadge.variant}>{priorityBadge.label}</Badge>
        <p className="text-sm font-medium text-charcoal-ink">{recommendation.title}</p>
      </div>
      {/* §38.13 — "Why am I seeing this?" is always shown, not hidden behind a click. */}
      <p className="text-sm text-charcoal-ink/70">{recommendation.triggerText}</p>
      <p className="text-xs text-charcoal-ink/50">Source: {recommendation.sourceLabel}</p>

      <form action={formAction} className="space-y-2 pt-1">
        <input type="hidden" name="recommendationKey" value={recommendation.key} />
        <input type="hidden" name="recommendationFingerprint" value={recommendation.fingerprint} />
        <input type="hidden" name="category" value={recommendation.category} />
        <input type="hidden" name="priority" value={recommendation.priority} />
        <input type="hidden" name="title" value={recommendation.title} />
        <input type="hidden" name="triggerText" value={recommendation.triggerText} />
        <input type="hidden" name="sourceLabel" value={recommendation.sourceLabel} />

        <div className="flex flex-wrap items-center gap-2">
          <Select
            name="decision"
            value={decision}
            onChange={(e) => setDecision(e.target.value as DecisionChoice)}
            className="w-auto"
          >
            {(Object.keys(DECISION_LABEL) as DecisionChoice[]).map((d) => (
              <option key={d} value={d}>
                {DECISION_LABEL[d]}
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Record decision"}
          </Button>
        </div>

        {decision === "actioned" && (
          <Textarea name="outcomeNote" rows={2} placeholder="What was done (documented outcome, §38.14)" />
        )}

        {needsReason && (
          <Textarea
            name="overrideReason"
            required
            rows={2}
            placeholder={decision === "overridden" ? "Reason for overriding (required)" : "Reason for deferring (required)"}
          />
        )}

        {decision === "deferred" && (
          <div className="flex items-center gap-2 text-sm text-charcoal-ink/70">
            <label htmlFor={`suppress-until-${recommendation.key}`}>Comes back on</label>
            <Input
              id={`suppress-until-${recommendation.key}`}
              type="date"
              name="suppressUntil"
              required
              className="w-auto"
            />
          </div>
        )}

        {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
      </form>
    </div>
  );
}
