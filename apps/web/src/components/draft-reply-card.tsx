"use client";

import { useState } from "react";
import { useDraftReply, useGenerateDraftReply, type CareMessageDraftReply } from "@/lib/queries/care-messages";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function formatGeneratedAt(value: string): string {
  return new Date(value).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * AI-drafted reply suggestion for a staff member replying in a
 * care_messages thread -- the Care Coordinator-side counterpart to
 * CaseBriefCard on the doctor side (case-brief-card.tsx), same mechanism
 * (Claude Haiku, fail-open, "AI-drafted" badge never confusable with a real
 * attribution claim).
 *
 * Deliberately display-only text, exactly like case-brief-card.tsx's
 * draftReviewNote: it is never pre-loaded into the compose Textarea below.
 * The model drafts prose for a human to read; it never occupies the field
 * whose submission actually reaches the patient. Pre-filling the send box
 * would invite sending a reply the coordinator never really read -- the
 * same "confirmed unread" failure this codebase already designed against
 * once for the doctor review-note field.
 */
export function DraftReplyCard({ threadId }: { threadId: string }) {
  const { data: draft, isLoading } = useDraftReply(threadId);
  const generate = useGenerateDraftReply();
  const [error, setError] = useState<string | null>(null);

  function onGenerate() {
    setError(null);
    generate.mutate(threadId, {
      onError: () => setError("Couldn't generate a draft reply — write your own reply below."),
    });
  }

  const isBusy = generate.isPending;

  return (
    <Card variant="soft">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm">Suggested reply</CardTitle>
          <Badge variant="grey">AI-drafted — not yet reviewed</Badge>
        </div>
        <CardDescription>
          Read this, then write your own reply below — it is never sent for you.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}

        {!isLoading && !draft && (
          <div className="space-y-2">
            <p className="text-sm text-charcoal-ink/60">No suggestion generated yet.</p>
            <Button size="sm" variant="outline" disabled={isBusy} onClick={onGenerate}>
              {isBusy ? "Drafting…" : "Draft reply"}
            </Button>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
        )}

        {!isLoading && draft?.status === "failed" && (
          <div className="space-y-2">
            <p className="text-sm text-charcoal-ink/60">
              Couldn&apos;t draft a suggestion — write your own reply below.
            </p>
            <Button size="sm" variant="outline" disabled={isBusy} onClick={onGenerate}>
              {isBusy ? "Retrying…" : "Try again"}
            </Button>
          </div>
        )}

        {!isLoading && draft?.status === "generated" && (
          <DraftReplyBody draft={draft} isBusy={isBusy} onRegenerate={onGenerate} error={error} />
        )}
      </CardContent>
    </Card>
  );
}

function DraftReplyBody({
  draft,
  isBusy,
  onRegenerate,
  error,
}: {
  draft: CareMessageDraftReply;
  isBusy: boolean;
  onRegenerate: () => void;
  error: string | null;
}) {
  return (
    <div className="space-y-3">
      {draft.needs_clinical_review && (
        <Badge variant="amber">
          May need clinical input{draft.review_reason ? ` — ${draft.review_reason}` : ""}
        </Badge>
      )}

      <p className="whitespace-pre-wrap rounded-md bg-charcoal-ink/[0.03] p-3 text-sm text-charcoal-ink">
        {draft.draft_text}
      </p>

      {draft.needs_clinical_review && (
        <p className="text-xs text-charcoal-ink/60">
          This only covers a short holding reply — if this needs a doctor&apos;s attention, raise it
          through the escalation worklist rather than replying here alone.
        </p>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-charcoal-ink/50">Generated {formatGeneratedAt(draft.generated_at)}</p>
        <Button size="sm" variant="outline" disabled={isBusy} onClick={onRegenerate}>
          {isBusy ? "Regenerating…" : "Regenerate"}
        </Button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
