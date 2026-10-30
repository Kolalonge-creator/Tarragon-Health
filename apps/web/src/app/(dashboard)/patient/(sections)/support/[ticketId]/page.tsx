import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
import { TicketDetail } from "./ticket-detail";

export default async function PatientTicketDetailPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params;

  return (
    <div className="space-y-6">
      <PageHeader title="Support ticket" icon={NAV_ICON.review} backTo={{ href: "/patient/support", label: "Support" }} />
      <TicketDetail ticketId={ticketId} />
    </div>
  );
}
