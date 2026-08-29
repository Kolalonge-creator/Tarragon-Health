"use client";

import { useState } from "react";
import {
  useSupportTicket,
  useSupportTicketComments,
  useAddTicketComment,
  useAdvanceTicketStatus,
  useAssignTicket,
  useBumpTechnicalTier,
  useEscalateTicketToClinical,
} from "@/lib/queries/support-tickets";
import { SUPPORT_TICKET_CATEGORY_LABEL } from "@/lib/validation/support-tickets";
import { TICKET_STATUS_BADGE, TICKET_PRIORITY_BADGE } from "@/lib/worklist/ticket-badge";
import { StaffAttributionLine } from "@/components/staff-attribution-line";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const TECHNICAL_TIER_LABEL: Record<number, string> = { 1: "Tier 1 support", 2: "Tier 2", 3: "Engineering" };

export function StaffTicketDetail({
  ticketId,
  canEscalate,
  currentProfileId,
}: {
  ticketId: string;
  canEscalate: boolean;
  currentProfileId: string | null;
}) {
  const { data: ticket, isLoading } = useSupportTicket(ticketId);
  const { data: comments } = useSupportTicketComments(ticketId);
  const addComment = useAddTicketComment();
  const advanceStatus = useAdvanceTicketStatus();
  const assign = useAssignTicket();
  const bumpTier = useBumpTechnicalTier();
  const escalate = useEscalateTicketToClinical();

  const [reply, setReply] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [resolutionNote, setResolutionNote] = useState("");
  const [showResolveForm, setShowResolveForm] = useState(false);
  const [escalationNote, setEscalationNote] = useState("");
  const [showEscalateForm, setShowEscalateForm] = useState(false);

  if (isLoading || !ticket) {
    return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  }

  const statusBadge = TICKET_STATUS_BADGE[ticket.status];
  const priorityBadge = TICKET_PRIORITY_BADGE[ticket.priority];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-2 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-heading text-lg font-semibold text-charcoal-ink">{ticket.subject}</h2>
              <p className="text-xs text-charcoal-ink/60">
                {ticket.patient?.full_name ?? "Patient"} · {SUPPORT_TICKET_CATEGORY_LABEL[ticket.category]}
              </p>
            </div>
            <div className="flex gap-2">
              <Badge variant={priorityBadge.variant}>{priorityBadge.label}</Badge>
              <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
            </div>
          </div>
          <p className="text-sm text-charcoal-ink">{ticket.description}</p>
          <StaffAttributionLine
            label="Assigned to"
            staffId={ticket.assigned_to}
            staffName={ticket.assigned_staff?.full_name}
            at={ticket.assigned_at}
          />
          {ticket.escalated_alert_id && (
            <p className="text-sm font-medium text-amber-700">Flagged for clinical review</p>
          )}
        </CardContent>
      </Card>

      {ticket.category === "clinical_navigation" && !ticket.escalated_alert_id && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          Keep replies here to routing and logistics — if this needs a clinical judgment call, flag
          it for clinical review below rather than answering it yourself.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {ticket.status === "new" && !ticket.assigned_to && currentProfileId && (
          <Button size="sm" disabled={assign.isPending} onClick={() => assign.mutate({ ticketId, assigneeId: currentProfileId })}>
            Assign to me
          </Button>
        )}
        {(ticket.status === "assigned" || ticket.status === "awaiting_patient") && (
          <Button
            size="sm"
            variant="outline"
            disabled={advanceStatus.isPending}
            onClick={() => advanceStatus.mutate({ ticketId, to: "in_progress" })}
          >
            Mark in progress
          </Button>
        )}
        {(ticket.status === "in_progress" || ticket.status === "assigned") && (
          <Button
            size="sm"
            variant="outline"
            disabled={advanceStatus.isPending}
            onClick={() => advanceStatus.mutate({ ticketId, to: "awaiting_patient" })}
          >
            Waiting on patient
          </Button>
        )}
        {["assigned", "in_progress", "awaiting_patient"].includes(ticket.status) && !showResolveForm && (
          <Button size="sm" onClick={() => setShowResolveForm(true)}>
            Mark resolved
          </Button>
        )}
        {ticket.status === "resolved" && (
          <Button size="sm" disabled={advanceStatus.isPending} onClick={() => advanceStatus.mutate({ ticketId, to: "closed" })}>
            Close
          </Button>
        )}
        {ticket.category === "technical" && ticket.technical_tier < 3 && (
          <Button
            size="sm"
            variant="outline"
            disabled={bumpTier.isPending}
            onClick={() => bumpTier.mutate(ticketId)}
          >
            Escalate to {TECHNICAL_TIER_LABEL[ticket.technical_tier + 1]}
          </Button>
        )}
        {canEscalate && !ticket.escalated_alert_id && !showEscalateForm && (
          <Button size="sm" variant="outline" onClick={() => setShowEscalateForm(true)}>
            Flag for clinical review
          </Button>
        )}
      </div>

      {showResolveForm && (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <p className="text-sm font-medium text-charcoal-ink">What fixed it?</p>
            <textarea
              value={resolutionNote}
              onChange={(event) => setResolutionNote(event.target.value)}
              rows={3}
              className="w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2.5 text-sm text-charcoal-ink"
            />
            <Button
              size="sm"
              disabled={!resolutionNote.trim() || advanceStatus.isPending}
              onClick={() =>
                advanceStatus.mutate(
                  { ticketId, to: "resolved", note: resolutionNote },
                  { onSuccess: () => setShowResolveForm(false) }
                )
              }
            >
              {advanceStatus.isPending ? "Saving…" : "Resolve"}
            </Button>
          </CardContent>
        </Card>
      )}

      {showEscalateForm && (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <p className="text-sm font-medium text-charcoal-ink">Why does this need clinical review?</p>
            <textarea
              value={escalationNote}
              onChange={(event) => setEscalationNote(event.target.value)}
              rows={3}
              className="w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2.5 text-sm text-charcoal-ink"
            />
            <Button
              size="sm"
              disabled={!escalationNote.trim() || escalate.isPending}
              onClick={() =>
                escalate.mutate(
                  { ticketId, note: escalationNote },
                  { onSuccess: () => setShowEscalateForm(false) }
                )
              }
            >
              {escalate.isPending ? "Sending…" : "Send to clinical review"}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {(comments ?? []).map((comment) => (
          <div
            key={comment.id}
            className={`rounded-lg px-4 py-3 text-sm ${
              comment.is_internal
                ? "border border-dashed border-amber-400 bg-amber-50"
                : comment.author_role === "staff"
                  ? "mr-8 bg-charcoal-ink/5"
                  : "ml-8 bg-brand-green/10"
            }`}
          >
            <p className="mb-1 text-xs font-medium text-charcoal-ink/60">
              {comment.author_role === "patient" ? "Patient" : comment.author?.full_name ?? "Care team"}
              {comment.is_internal ? " · internal note" : ""} ·{" "}
              {new Date(comment.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            </p>
            <p className="text-charcoal-ink">{comment.body}</p>
          </div>
        ))}
      </div>

      {ticket.status !== "closed" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!reply.trim()) return;
            addComment.mutate(
              { ticketId, body: reply, isInternal },
              { onSuccess: () => setReply("") }
            );
          }}
          className="space-y-2"
        >
          <textarea
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            rows={3}
            placeholder={isInternal ? "Internal note (not visible to the patient)…" : "Reply to the patient…"}
            className="w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2.5 text-sm text-charcoal-ink"
          />
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-charcoal-ink/70">
              <input type="checkbox" checked={isInternal} onChange={(event) => setIsInternal(event.target.checked)} />
              Internal note only
            </label>
            <Button type="submit" size="sm" disabled={addComment.isPending || !reply.trim()}>
              {addComment.isPending ? "Sending…" : isInternal ? "Add note" : "Reply"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
