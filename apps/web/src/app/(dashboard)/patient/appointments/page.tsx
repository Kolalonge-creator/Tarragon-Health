import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { BookAppointment } from "./book-appointment";
import { MyAppointmentsList } from "./my-appointments-list";

export default async function PatientAppointmentsPage() {
  const profile = await getCurrentProfile();
  if (!profile?.organisation_id) {
    redirect("/login");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Appointments</h1>
        <p className="text-sm text-charcoal-ink/60">
          Book a GP, specialist, nurse, or other visit, and manage your upcoming appointments.
        </p>
      </div>
      <MyAppointmentsList patientId={profile.id} />
      <BookAppointment organisationId={profile.organisation_id} patientId={profile.id} />
    </div>
  );
}
