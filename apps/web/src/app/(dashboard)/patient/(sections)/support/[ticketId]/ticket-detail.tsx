"use client";

import { useState } from "react";
import { useSupportTicket, useSupportTicketComments, useAddTicketComment, useRateTicketSatisfaction } from "@/lib/queries/support-tickets";
import { SUPPORT_TICKET_CATEGORY_LABEL } from "@/lib/validation/support-tickets";
import { TICKET_STATUS_BADGE } from "@/lib/worklist/ticket-badge";
import { StaffAttributionLine } from "@/components/staff-attribution-line";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function TicketDetail({ ticketId }: { ticketId: string }) {
  const { data: ticket, isLoading } = useSupportTicket(ticketId);
  const { data: comments } = useSupportTicketComments(ticketId);
  const addComment = useAddTicketComment();
  const rate = useRateTicketSatisfaction();
  const [reply, setReply] = useState("");
  const [score, setScore] = useState<number | null>(null);

  if (isLoading || !ticket) {
    return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  }

  const statusBadge = TICKET_STATUS_BADGE[ticket.status];
  const canReply = ticket.status !== "closed";
  const canRate = (ticket.status === "resolved" || ticket.status === "closed") && ticket.satisfaction_score === null;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-2 pt-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-heading text-lg font-semibold text-charcoal-ink">{ticket.subject}</h2>
            <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
          </div>
          <p className="text-xs text-charcoal-ink/60">{SUPPORT_TICKET_CATEGORY_LABEL[ticket.category]}</p>
          <p className="text-sm text-charcoal-ink">{ticket.description}</p>
          <StaffAttributionLine
            label="Assigned to"
            staffId={ticket.assigned_to}
            staffName={ticket.assigned_staff?.full_name}
            at={ticket.assigned_at}
          />
          {ticket.resolution_note && (
            <p className="rounded-lg bg-brand-green/5 p-3 text-sm text-charcoal-ink">
              <span className="font-medium">Resolution:</span> {ticket.resolution_note}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="space-y-3">
        {(comments ?? []).map((comment) => (
          <div
            key={comment.id}
            className={`rounded-lg px-4 py-3 text-sm ${
              comment.author_role === "patient" ? "ml-8 bg-brand-green/10" : "mr-8 bg-charcoal-ink/5"
            }`}
          >
            <p className="mb-1 text-xs font-medium text-charcoal-ink/60">
              {comment.author_role === "patient" ? "You" : comment.author?.full_name ?? "Your care team"} ·{" "}
              {new Date(comment.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            </p>
            <p className="text-charcoal-ink">{comment.body}</p>
          </div>
        ))}
      </div>

      {canReply && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!reply.trim()) return;
            addComment.mutate(
              { ticketId, body: reply },
              { onSuccess: () => setReply("") }
            );
          }}
          className="space-y-2"
        >
          <textarea
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            rows={3}
            placeholder="Write a reply…"
            className="w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2.5 text-sm text-charcoal-ink"
          />
          <Button type="submit" disabled={addComment.isPending || !reply.trim()}>
            {addComment.isPending ? "Sending…" : "Reply"}
          </Button>
        </form>
      )}

      {canRate && (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <p className="text-sm font-medium text-charcoal-ink">How did we do?</p>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setScore(value)}
                  aria-pressed={score === value}
                  className={`h-9 w-9 rounded-full border text-sm ${
                    score !== null && value <= score
                      ? "border-brand-green bg-brand-green text-white"
                      : "border-charcoal-ink/20 text-charcoal-ink"
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
            <Button
              type="button"
              disabled={!score || rate.isPending}
              onClick={() => score && rate.mutate({ ticketId, score })}
            >
              {rate.isPending ? "Sending…" : "Send rating"}
            </Button>
          </CardContent>
        </Card>
      )}
      {ticket.satisfaction_score !== null && (
        <p className="text-sm text-charcoal-ink/60">You rated this {ticket.satisfaction_score}/5. Thank you.</p>
      )}
    </div>
  );
}
