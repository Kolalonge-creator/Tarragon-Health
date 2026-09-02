import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { BookAppointment } from "./book-appointment";
import { MyAppointmentsList } from "./my-appointments-list";
import type { AppointmentType } from "@/lib/queries/appointments";

const VALID_APPOINTMENT_TYPES: AppointmentType[] = [
  "gp",
  "specialist",
  "nurse",
  "dietitian",
  "physiotherapist",
  "laboratory",
  "imaging",
  "vaccination",
  "physical_clinic",
  "telemedicine",
  "follow_up",
  "procedure",
  "therapy",
];

export default async function PatientAppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile?.organisation_id) {
    redirect("/login");
  }

  const { type } = await searchParams;
  const initialAppointmentType = VALID_APPOINTMENT_TYPES.includes(type as AppointmentType)
    ? (type as AppointmentType)
    : undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Appointments</h1>
        <p className="text-sm text-charcoal-ink/60">
          Book a GP, specialist, nurse, or other visit, and manage your upcoming appointments.
        </p>
      </div>
      <MyAppointmentsList patientId={profile.id} />
      <BookAppointment
        organisationId={profile.organisation_id}
        patientId={profile.id}
        initialAppointmentType={initialAppointmentType}
      />
    </div>
  );
}
