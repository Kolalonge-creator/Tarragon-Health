"use client";

import Link from "next/link";
import { useSupportTicketQueue } from "@/lib/queries/support-tickets";
import { TICKET_STATUS_BADGE, TICKET_PRIORITY_BADGE } from "@/lib/worklist/ticket-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function SupportTicketWorklist() {
  const { data: tickets, isLoading, isError } = useSupportTicketQueue();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ticket queue</CardTitle>
        <CardDescription>Open technical-support tickets, highest priority first.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load the queue.</p>}
        {tickets && tickets.length === 0 && <p className="text-sm text-charcoal-ink/60">Nothing open right now.</p>}
        {(tickets ?? []).map((ticket) => {
          const statusBadge = TICKET_STATUS_BADGE[ticket.status];
          const priorityBadge = TICKET_PRIORITY_BADGE[ticket.priority];
          return (
            <Link key={ticket.id} href={`/clinician/support-tickets/${ticket.id}`}>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-charcoal-ink/10 px-4 py-3 transition hover:border-brand-green/40">
                <div>
                  <p className="font-medium text-charcoal-ink">{ticket.subject}</p>
                  <p className="text-xs text-charcoal-ink/60">
                    {ticket.patient?.full_name ?? "Patient"}
                    {ticket.assigned_staff?.full_name ? ` · assigned to ${ticket.assigned_staff.full_name}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
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
