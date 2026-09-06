import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { AvailabilityRulesManager } from "./availability-rules-manager";
import { AppointmentsCalendarList } from "./appointments-calendar-list";

export default async function ClinicianAppointmentsPage() {
  const profile = await getCurrentProfile();
  if (!profile?.organisation_id) {
    redirect("/login");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Appointments</h1>
        <p className="text-sm text-charcoal-ink/60">
          Define recurring availability, manage leave, and work your appointment calendar across every
          appointment type, separate from the video-visit slots under Availability.
        </p>
      </div>
      <AppointmentsCalendarList clinicianId={profile.id} />
      <AvailabilityRulesManager organisationId={profile.organisation_id} clinicianId={profile.id} />
    </div>
  );
}
