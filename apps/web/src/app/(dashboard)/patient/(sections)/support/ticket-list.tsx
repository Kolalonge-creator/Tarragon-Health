"use client";

import Link from "next/link";
import { useMySupportTickets } from "@/lib/queries/support-tickets";
import { SUPPORT_TICKET_CATEGORY_LABEL } from "@/lib/validation/support-tickets";
import { TICKET_STATUS_BADGE } from "@/lib/worklist/ticket-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export function TicketList({ patientId }: { patientId: string }) {
  const { data: tickets, isLoading } = useMySupportTickets(patientId);

  if (isLoading) {
    return <p className="text-sm text-charcoal-ink/60">Loading your tickets…</p>;
  }
  if (!tickets || tickets.length === 0) {
    return <p className="text-sm text-charcoal-ink/60">You haven&apos;t sent any support tickets yet.</p>;
  }

  return (
    <div className="space-y-3">
      {tickets.map((ticket) => {
        const statusBadge = TICKET_STATUS_BADGE[ticket.status];
        return (
          <Link key={ticket.id} href={`/patient/support/${ticket.id}`}>
            <Card className="transition hover:border-brand-green/40">
              <CardContent className="flex items-center justify-between gap-3 py-4">
                <div>
                  <p className="font-medium text-charcoal-ink">{ticket.subject}</p>
                  <p className="text-xs text-charcoal-ink/60">
                    {SUPPORT_TICKET_CATEGORY_LABEL[ticket.category]} · {new Date(ticket.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </p>
                </div>
                <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
