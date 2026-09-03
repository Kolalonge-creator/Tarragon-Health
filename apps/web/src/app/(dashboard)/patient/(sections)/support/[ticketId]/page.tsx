import { TicketDetail } from "./ticket-detail";

export default async function PatientTicketDetailPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params;

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Support ticket</h1>
      <TicketDetail ticketId={ticketId} />
    </div>
  );
}
