"use client";

import { useState } from "react";
import {
  useHealthEducationFeedbackQueue,
  useResolveContentFeedback,
  HEALTH_EDUCATION_FEEDBACK_OPTIONS,
  type HealthEducationFeedbackRow,
} from "@/lib/queries/health-education";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

const FEEDBACK_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  HEALTH_EDUCATION_FEEDBACK_OPTIONS.map(({ value, label }) => [value, label])
);

const STATUS_BADGE: Record<string, "grey" | "blue" | "green"> = {
  open: "grey",
  reviewed: "blue",
  resolved: "green",
};

function FeedbackRow({ row }: { row: HealthEducationFeedbackRow }) {
  const resolve = useResolveContentFeedback();
  const [note, setNote] = useState(row.review_note ?? "");

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={row.feedback_type === "report_incorrect" ? "amber" : "grey"}>
          {FEEDBACK_TYPE_LABEL[row.feedback_type] ?? row.feedback_type}
        </Badge>
        <Badge variant={STATUS_BADGE[row.status] ?? "grey"}>{row.status}</Badge>
        <span className="text-sm font-medium text-charcoal-ink">
          {row.content?.title ?? "(content removed)"}
        </span>
        <span className="text-xs text-charcoal-ink/40">
          {new Date(row.created_at).toLocaleDateString()}
        </span>
      </div>
      {row.patient?.full_name && (
        <p className="text-xs text-charcoal-ink/50">From {row.patient.full_name}</p>
      )}
      {row.comment && <p className="text-sm text-charcoal-ink/80">&ldquo;{row.comment}&rdquo;</p>}

      {row.status !== "resolved" && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Review note (optional)"
            className="h-8 w-64 text-xs"
          />
          {row.status === "open" && (
            <Button
              size="sm"
              variant="outline"
              disabled={resolve.isPending}
              onClick={() => resolve.mutate({ id: row.id, status: "reviewed", reviewNote: note })}
            >
              Mark reviewed
            </Button>
          )}
          <Button
            size="sm"
            disabled={resolve.isPending}
            onClick={() => resolve.mutate({ id: row.id, status: "resolved", reviewNote: note })}
          >
            Resolve
          </Button>
        </div>
      )}
      {resolve.isError && <p className="text-xs text-red-600">Could not update this report.</p>}
    </li>
  );
}

export function FeedbackQueueManager() {
  const { data: rows, isLoading, isError } = useHealthEducationFeedbackQueue();
  const [showResolved, setShowResolved] = useState(false);

  const visible = (rows ?? []).filter((r) => showResolved || r.status !== "resolved");
  const openCount = (rows ?? []).filter((r) => r.status === "open").length;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Feedback governance queue</CardTitle>
            <CardDescription>
              {openCount} open report{openCount === 1 ? "" : "s"}. &ldquo;Report incorrect
              information&rdquo; is the one that needs a clinical look; helpful/unclear/want-more are
              engagement signal only.
            </CardDescription>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-charcoal-ink/60">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
            />
            Show resolved
          </label>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load feedback.</p>}
        {visible.length === 0 && !isLoading && (
          <p className="text-sm text-charcoal-ink/60">Nothing here.</p>
        )}
        {visible.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {visible.map((row) => (
              <FeedbackRow key={row.id} row={row} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
