"use client";

import { useState } from "react";
import {
  useProtocolDrafts,
  useCreateProtocolDraft,
  useSetProtocolDraftStatus,
  useProtocolDraftComments,
  useAddProtocolDraftComment,
  usePromoteProtocolDraft,
  useRejectProtocolDraft,
  type ProtocolDraft,
} from "@/lib/queries/protocol-drafts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { protocolContentText } from "./protocol-content-text";

const STATUS_BADGE: Record<string, { variant: BadgeProps["variant"]; label: string }> = {
  draft: { variant: "grey", label: "Draft" },
  in_review: { variant: "blue", label: "In review" },
  promoted: { variant: "green", label: "Promoted" },
  rejected: { variant: "red", label: "Rejected" },
};

function DraftComments({ draftId }: { draftId: string }) {
  const { data: comments, isLoading } = useProtocolDraftComments(draftId);
  const addComment = useAddProtocolDraftComment();
  const [body, setBody] = useState("");

  return (
    <div className="space-y-3 border-t border-charcoal-ink/10 pt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">Review comments</p>
      {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
      {!isLoading && (comments?.length ?? 0) === 0 && (
        <p className="text-sm text-charcoal-ink/60">No review comments yet.</p>
      )}
      <ul className="space-y-2">
        {comments?.map((c) => (
          <li key={c.id} className="rounded-md bg-charcoal-ink/5 p-2 text-sm">
            <p className="text-charcoal-ink">{c.body}</p>
            <p className="mt-1 text-xs text-charcoal-ink/50">
              {c.commented_by?.full_name ?? "Unknown"} ·{" "}
              {new Date(c.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            </p>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input
          placeholder="Leave a review comment…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <Button
          size="sm"
          disabled={body.trim().length === 0 || addComment.isPending}
          onClick={() =>
            addComment.mutate({ draftId, body: body.trim() }, { onSuccess: () => setBody("") })
          }
        >
          Comment
        </Button>
      </div>
    </div>
  );
}

function DraftCard({ draft }: { draft: ProtocolDraft }) {
  const [expanded, setExpanded] = useState(false);
  const setStatus = useSetProtocolDraftStatus();
  const promote = usePromoteProtocolDraft();
  const reject = useRejectProtocolDraft();
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);

  const badge = STATUS_BADGE[draft.status] ?? STATUS_BADGE.draft;
  const open = draft.status === "draft" || draft.status === "in_review";

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">{draft.title}</CardTitle>
            <CardDescription>
              {draft.protocol_id} · {draft.authored_by?.full_name ?? "Unknown author"}
            </CardDescription>
          </div>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-charcoal-ink/80">{draft.change_summary}</p>
        {draft.evidence_basis && (
          <p className="text-xs text-charcoal-ink/60">
            <span className="font-medium">Evidence basis: </span>
            {draft.evidence_basis}
          </p>
        )}
        {draft.status === "rejected" && draft.rejected_reason && (
          <p className="text-sm text-red-700">Rejected: {draft.rejected_reason}</p>
        )}

        {/* Same defect as the signed-version list had before this file's
            sibling fix: content was written by the create-draft form and
            never rendered anywhere, so "Promote & sign" was a blind click.
            Open by default here, unlike the signed list's disclosure --
            reading the draft before approving it is the whole point of a
            review step, not an optional extra. */}
        {protocolContentText(draft.content) && (
          <details className="mt-1" open>
            <summary className="cursor-pointer text-xs font-medium text-brand-green">
              Read this draft
            </summary>
            <pre className="mt-2 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg bg-warm-ivory p-3 font-sans text-sm leading-relaxed text-charcoal-ink/90">
              {protocolContentText(draft.content)}
            </pre>
          </details>
        )}

        {open && (
          <div className="flex flex-wrap gap-2">
            {draft.status === "draft" && (
              <Button
                size="sm"
                variant="outline"
                disabled={setStatus.isPending}
                onClick={() => setStatus.mutate({ draftId: draft.id, status: "in_review" })}
              >
                Send for review
              </Button>
            )}
            <Button
              size="sm"
              disabled={promote.isPending}
              title="Signs this as a new protocol_versions row (Director only)"
              onClick={() => promote.mutate(draft.id)}
            >
              {promote.isPending ? "Promoting…" : "Promote & sign"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowReject((s) => !s)}>
              Reject
            </Button>
            <Button size="sm" variant="outline" onClick={() => setExpanded((e) => !e)}>
              {expanded ? "Hide comments" : "Show comments"}
            </Button>
          </div>
        )}
        {promote.isError && <p className="text-sm text-red-600">{(promote.error as Error).message}</p>}
        {reject.isError && <p className="text-sm text-red-600">{(reject.error as Error).message}</p>}

        {showReject && (
          <div className="flex gap-2">
            <Input
              placeholder="Reason for rejecting this draft"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={rejectReason.trim().length === 0 || reject.isPending}
              onClick={() =>
                reject.mutate(
                  { draftId: draft.id, reason: rejectReason.trim() },
                  { onSuccess: () => setShowReject(false) }
                )
              }
            >
              Confirm reject
            </Button>
          </div>
        )}

        {expanded && <DraftComments draftId={draft.id} />}
      </CardContent>
    </Card>
  );
}

/**
 * Pre-signing review stage for a protocol (docs spec §88.4/§88.5) — an
 * author drafts, any clinical staff may comment, only the Director promotes
 * (signs into protocol_versions, unchanged) or rejects. Sits alongside the
 * existing direct-sign form: a Director can still sign a version directly
 * for a fast-moving change, this is the path for one that benefits from
 * review first.
 */
export function ProtocolDraftsManager() {
  const { data: drafts, isLoading, isError } = useProtocolDrafts();
  const create = useCreateProtocolDraft();

  const [protocolId, setProtocolId] = useState("");
  const [title, setTitle] = useState("");
  const [changeSummary, setChangeSummary] = useState("");
  const [contentText, setContentText] = useState("");
  const [evidenceBasis, setEvidenceBasis] = useState("");

  const canSubmit = protocolId.trim().length > 0 && title.trim().length > 0 && changeSummary.trim().length > 0;

  if (isLoading) return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  if (isError || !drafts) return <p className="text-sm text-red-600">Could not load protocol drafts.</p>;

  const open = drafts.filter((d) => d.status === "draft" || d.status === "in_review");
  const closed = drafts.filter((d) => d.status === "promoted" || d.status === "rejected");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Draft a protocol for review</CardTitle>
          <CardDescription>
            Any clinical-tier team member can start a draft and get review comments before a Director
            signs it. Use this for a change that benefits from a second opinion; use the direct-sign
            form below for a fast-moving one.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="draft-protocol-id">protocol_id</Label>
              <Input id="draft-protocol-id" value={protocolId} onChange={(e) => setProtocolId(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="draft-title">Title</Label>
              <Input id="draft-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="draft-change-summary">Change summary</Label>
            <Input
              id="draft-change-summary"
              value={changeSummary}
              onChange={(e) => setChangeSummary(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="draft-evidence">Evidence basis (optional)</Label>
            <Input id="draft-evidence" value={evidenceBasis} onChange={(e) => setEvidenceBasis(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="draft-content">Protocol content</Label>
            <Textarea id="draft-content" rows={6} value={contentText} onChange={(e) => setContentText(e.target.value)} />
          </div>
          {create.isError && <p className="text-sm text-red-600">{(create.error as Error).message}</p>}
          <Button
            disabled={!canSubmit || create.isPending}
            onClick={() =>
              create.mutate(
                {
                  protocolId: protocolId.trim(),
                  title: title.trim(),
                  changeSummary: changeSummary.trim(),
                  content: { text: contentText.trim() },
                  evidenceBasis: evidenceBasis.trim(),
                },
                {
                  onSuccess: () => {
                    setProtocolId("");
                    setTitle("");
                    setChangeSummary("");
                    setContentText("");
                    setEvidenceBasis("");
                  },
                }
              )
            }
          >
            {create.isPending ? "Saving…" : "Save draft"}
          </Button>
        </CardContent>
      </Card>

      {open.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-heading text-base font-semibold text-charcoal-ink">Open drafts</h3>
          {open.map((d) => (
            <DraftCard key={d.id} draft={d} />
          ))}
        </div>
      )}

      {closed.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-heading text-base font-semibold text-charcoal-ink">Promoted / rejected</h3>
          {closed.map((d) => (
            <DraftCard key={d.id} draft={d} />
          ))}
        </div>
      )}
    </div>
  );
}
