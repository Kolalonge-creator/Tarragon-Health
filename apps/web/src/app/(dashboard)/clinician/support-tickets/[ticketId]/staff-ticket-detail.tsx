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
import { TICKET_STATUS_BADGE, TICKET_PRIORITY_BADGE } from "@/lib/worklist/ticket-badge";
import { StaffAttributionLine } from "@/components/staff-attribution-line";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RaiseHandoff } from "@/components/support-desk/raise-handoff";
import { TicketAttachments } from "@/components/support-desk/ticket-attachments";
import { useSupportTemplates } from "@/lib/queries/support-desk";

const TECHNICAL_TIER_LABEL: Record<number, string> = { 1: "Tier 1 support", 2: "Tier 2", 3: "Engineering" };

export function StaffTicketDetail({
  ticketId,
  canEscalate,
  currentProfileId,
  isSupportLead = false,
}: {
  ticketId: string;
  canEscalate: boolean;
  currentProfileId: string | null;
  isSupportLead?: boolean;
}) {
  const { data: ticket, isLoading } = useSupportTicket(ticketId);
  const { data: comments } = useSupportTicketComments(ticketId);
  const addComment = useAddTicketComment();
  const advanceStatus = useAdvanceTicketStatus();
  const assign = useAssignTicket();
  const bumpTier = useBumpTechnicalTier();
  const escalate = useEscalateTicketToClinical();
  const templates = useSupportTemplates();
  const [confirmReply, setConfirmReply] = useState(false);

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
                {ticket.patient?.full_name ?? "Patient"} ·{" "}
                <a href={`/clinician/support-tickets/thread/${ticket.patient_id}`} className="underline underline-offset-2">
                  Everything this patient sent (app, phone, email)
                </a>
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
        {ticket.technical_tier < 3 && (
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
            // A customer-visible reply is confirmed first, so an internal note is never sent by mistake.
            if (!isInternal) {
              setConfirmReply(true);
              return;
            }
            addComment.mutate({ ticketId, body: reply, isInternal }, { onSuccess: () => setReply("") });
          }}
          className={`space-y-2 rounded-lg p-3 ${isInternal ? "border border-dashed border-amber-400 bg-amber-50 dark:bg-amber-500/10" : "border border-charcoal-ink/10 dark:border-night-ink/15"}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div role="radiogroup" aria-label="Reply or note" className="flex gap-1">
              <button type="button" role="radio" aria-checked={!isInternal} onClick={() => setIsInternal(false)}
                className={`rounded-full px-3 py-1 text-sm ${!isInternal ? "bg-brand-green text-white" : "border border-charcoal-ink/15 text-charcoal-ink/70"}`}>
                Reply to customer
              </button>
              <button type="button" role="radio" aria-checked={isInternal} onClick={() => setIsInternal(true)}
                className={`rounded-full px-3 py-1 text-sm ${isInternal ? "bg-amber-500 text-white" : "border border-charcoal-ink/15 text-charcoal-ink/70"}`}>
                Internal note
              </button>
            </div>
            {!isInternal && (templates.data ?? []).some((t) => t.status === "approved") && (
              <select
                aria-label="Start from a template"
                className="rounded-md border border-charcoal-ink/15 bg-white px-2 py-1 text-sm dark:bg-transparent"
                value=""
                onChange={(e) => {
                  const t = (templates.data ?? []).find((x) => x.id === e.target.value);
                  if (t) setReply((r) => (r.trim() ? `${r}\n\n${t.body}` : t.body));
                }}
              >
                <option value="">Start from a template</option>
                {(templates.data ?? []).filter((t) => t.status === "approved").map((t) => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
            )}
          </div>
          <textarea
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            rows={4}
            placeholder={isInternal ? "Internal note, never shown to the customer" : "Reply to the customer. No clinical advice; a clinical concern goes to clinical review."}
            className="w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2.5 text-sm text-charcoal-ink"
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-charcoal-ink/60">
              {isInternal ? "Only staff will see this." : "The customer sees this in the app and gets a notice that you replied."}
            </p>
            <Button type="submit" size="sm" disabled={addComment.isPending || !reply.trim()}>
              {addComment.isPending ? "Sending…" : isInternal ? "Add internal note" : "Send reply"}
            </Button>
          </div>
        </form>
      )}

      <ConfirmDialog
        open={confirmReply}
        title="Send this reply to the customer?"
        description="The customer will see it in the app. Check it holds no internal detail and no clinical advice."
        confirmLabel="Send reply"
        onCancel={() => setConfirmReply(false)}
        onConfirm={() => {
          setConfirmReply(false);
          addComment.mutate({ ticketId, body: reply, isInternal: false }, { onSuccess: () => setReply("") });
        }}
      >
        <p className="whitespace-pre-line rounded-md bg-charcoal-ink/5 p-2 text-sm">{reply}</p>
      </ConfirmDialog>

      <Card>
        <CardContent className="space-y-2 pt-6">
          <p className="text-sm font-medium text-charcoal-ink">Files</p>
          <TicketAttachments ticketId={ticketId} mode="staff" isLead={isSupportLead} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-6">
          <p className="text-sm font-medium text-charcoal-ink">Hand to another team</p>
          <p className="text-xs text-charcoal-ink/60">
            For a refund, a payment problem, a platform fault, a provider listing or a Membership change. Support does not make those decisions. If the customer describes symptoms, do not advise: a doctor must see it. {canEscalate ? "Use Flag for clinical review above." : "Ask the doctor on duty to flag it for clinical review."} For an emergency, tell them to go to the nearest hospital emergency department now.
          </p>
          <RaiseHandoff source="support_ticket" sourceId={ticketId} />
        </CardContent>
      </Card>
    </div>
  );
}
