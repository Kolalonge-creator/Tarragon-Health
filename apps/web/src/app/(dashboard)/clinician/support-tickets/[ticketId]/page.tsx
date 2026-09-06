import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { getCurrentUser } from "@/lib/supabase/server";
import { isClinicalTier } from "@/lib/clinical/doctor-tier";
import { StaffTicketDetail } from "./staff-ticket-detail";

export default async function ClinicianTicketDetailPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params;
  const staff = await getCurrentClinicalStaff();
  const canEscalate = isClinicalTier(staff);
  const user = await getCurrentUser();

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Ticket</h1>
      <StaffTicketDetail ticketId={ticketId} canEscalate={canEscalate} currentProfileId={user?.id ?? null} />
    </div>
  );
}
