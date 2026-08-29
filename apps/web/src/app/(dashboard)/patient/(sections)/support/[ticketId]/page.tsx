import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { SEMANTIC_ICON } from "@/lib/icons";
import { TicketDetail } from "./ticket-detail";

export default async function PatientTicketDetailPage({ params }: { params: Promise<{ ticketId: string }> }) {
  // subjectId isn't otherwise used here — RLS scopes the ticket read to the
  // signed-in caller (or the account they're acting for) either way — but
  // resolving it re-confirms the same acting-for/onboarding gate every
  // /patient/* route runs, per this route group's own layout convention.
  await getPatientDashboardContext();
  const { ticketId } = await params;

  return (
    <DashboardSection id="support" title="Ticket" icon={SEMANTIC_ICON.clinicianFollowUp}>
      <TicketDetail ticketId={ticketId} />
    </DashboardSection>
  );
}
