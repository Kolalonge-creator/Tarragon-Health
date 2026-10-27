"use client";

import Link from "next/link";
import { getProposedConfig } from "@tarragon/shared";
import { useSupportTicketQueue } from "@/lib/queries/support-tickets";
import { useRedFlaggedTicketIds } from "@/lib/queries/support-red-flags";
import { describeClock, isBreached, sortByClock, ticketClock, type SlaPriority, type SlaTargets, type TicketClock } from "@/lib/support/sla";
import { TICKET_STATUS_BADGE, TICKET_PRIORITY_BADGE } from "@/lib/worklist/ticket-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const CHANNEL_LABEL: Record<string, string> = { in_app: "App", phone: "Phone", email: "Email", faq: "Help page", chatbot: "Chat" };

export function SupportTicketWorklist() {
  const { data: raw, isLoading, isError } = useSupportTicketQueue();
  const redFlags = useRedFlaggedTicketIds();
  const targets = getProposedConfig<SlaTargets>("support.sla_targets").value;
  const now = new Date();
  const clockOf = (t: NonNullable<typeof raw>[number]): TicketClock =>
    ticketClock(
      {
        created_at: t.created_at,
        first_response_at: t.first_response_at,
        resolved_at: t.resolved_at,
        status: t.status,
        priority: t.priority as SlaPriority,
        is_clinical: (t as { is_clinical?: boolean }).is_clinical === true,
      },
      now,
      targets,
    );
  const tickets = raw ? sortByClock(raw, clockOf) : raw;
  const pastTarget = tickets ? tickets.filter((t) => isBreached(clockOf(t))).length : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ticket queue</CardTitle>
        <CardDescription>Open technical-support tickets from the app, phone and email, past-target first.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load the queue.</p>}
        {redFlags.isError && (
          <p role="alert" className="text-sm text-red-600">
            Emergency marks could not be loaded. Read every ticket as if it might be urgent.
          </p>
        )}
        {tickets && pastTarget > 0 && (
          <p role="status" className="text-sm font-medium text-red-700">
            {pastTarget} ticket{pastTarget === 1 ? " is" : "s are"} past the support target (proposed targets, not yet confirmed).
          </p>
        )}
        {tickets && tickets.length === 0 && <p className="text-sm text-charcoal-ink/60">Nothing open right now.</p>}
        {(tickets ?? []).map((ticket) => {
          const statusBadge = TICKET_STATUS_BADGE[ticket.status];
          const priorityBadge = TICKET_PRIORITY_BADGE[ticket.priority];
          const clock = clockOf(ticket);
          const flagged = redFlags.data?.has(ticket.id) === true;
          return (
            <Link key={ticket.id} href={`/clinician/support-tickets/${ticket.id}`}>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-charcoal-ink/10 px-4 py-3 transition hover:border-brand-green/40">
                <div>
                  <p className="font-medium text-charcoal-ink">{ticket.subject}</p>
                  <p className="text-xs text-charcoal-ink/60">
                    {CHANNEL_LABEL[ticket.channel] ?? ticket.channel} · {ticket.patient?.full_name ?? "Patient"}
                    {ticket.assigned_staff?.full_name ? ` · assigned to ${ticket.assigned_staff.full_name}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  {flagged && <Badge variant="red">Possible emergency</Badge>}
                  <Badge variant={clock.worst === "breached" ? "red" : clock.worst === "due_soon" ? "amber" : "grey"}>{describeClock(clock)}</Badge>
                  <Badge variant={priorityBadge.variant}>{priorityBadge.label}</Badge>
                  <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                </div>
              </div>
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}
