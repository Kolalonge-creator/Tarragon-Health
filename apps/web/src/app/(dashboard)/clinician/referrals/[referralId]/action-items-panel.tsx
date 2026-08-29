"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addSpecialistReferralActionItemAction } from "@/lib/specialist-reports/actions";
import { useSpecialistReferralActionItems } from "@/lib/queries/specialist-consultation";
import { RECOMMENDATION_ACTION_TYPES, type RecommendationActionType } from "@/lib/specialist-reports/extract";

const ACTION_TYPE_LABEL: Record<RecommendationActionType, string> = {
  repeat_test: "Repeat test",
  investigation: "Investigation",
  follow_up_appointment: "Follow-up appointment",
  medication_review: "Medication review (doctor)",
  care_plan_review: "Care plan review (doctor)",
  other: "Other",
};

function formatDate(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function AddItemForm({ referralId }: { referralId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [actionType, setActionType] = useState<RecommendationActionType>("follow_up_appointment");
  const [dueAt, setDueAt] = useState("");
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        + Add action item by hand
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-charcoal-ink/15 p-3">
      <Input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="e.g. Repeat HbA1c in 3 months"
        className="h-8 text-xs"
      />
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={actionType}
          onChange={(e) => setActionType(e.target.value as RecommendationActionType)}
          className="rounded border border-charcoal-ink/20 px-1 py-0.5 text-xs"
        >
          {RECOMMENDATION_ACTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {ACTION_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <Input
          type="date"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          className="h-8 w-36 text-xs"
        />
        <Button
          type="button"
          size="sm"
          disabled={pending || description.trim().length === 0}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await addSpecialistReferralActionItemAction({
                referral_id: referralId,
                action_type: actionType,
                description: description.trim(),
                due_at: dueAt ? new Date(dueAt).toISOString() : undefined,
              });
              if (result.error) setError(result.error);
              else {
                setDescription("");
                setDueAt("");
                setOpen(false);
              }
            });
          }}
        >
          {pending ? "Adding…" : "Add"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/**
 * Spec §70.4/§70.6/§70.11 — every accepted specialist recommendation as a
 * tracked, owned item. "Owner" here is worklist-level, not a named
 * individual: a repeat_test/investigation/follow_up_appointment/other item
 * routes to the Care Coordinator outreach worklist (self-claim on action,
 * same idiom as every other outreach task); a medication_review/
 * care_plan_review item routes to the doctor care-plan-review worklist.
 * "Resolved" is read live off that routed row — see the query hook.
 */
export function ActionItemsSection({ referralId }: { referralId: string }) {
  const { data: items, isLoading, isError } = useSpecialistReferralActionItems(referralId);

  return (
    <div className="space-y-3">
      {isLoading && <p className="text-xs text-charcoal-ink/60">Loading…</p>}
      {isError && <p className="text-xs text-red-600">Could not load action items.</p>}
      {items && items.length === 0 && (
        <p className="text-xs text-charcoal-ink/60">No action items yet from this referral.</p>
      )}
      {items && items.length > 0 && (
        <ul className="divide-y divide-charcoal-ink/10">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2 py-2">
              <Badge variant={item.resolved ? "green" : "amber"}>
                {item.resolved === null ? "—" : item.resolved ? "Resolved" : "Open"}
              </Badge>
              <span className="text-xs font-medium text-charcoal-ink">
                {ACTION_TYPE_LABEL[item.action_type as RecommendationActionType] ?? item.action_type}
              </span>
              <span className="min-w-0 flex-1 text-xs text-charcoal-ink/80">{item.description}</span>
              {item.due_at && (
                <span className="text-[0.65rem] text-charcoal-ink/50">due {formatDate(item.due_at)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <AddItemForm referralId={referralId} />
    </div>
  );
}
