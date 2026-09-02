import { redirect } from "next/navigation";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
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

/**
 * subjectId, not profile.id: a caregiver who has opened the account of the
 * person they support (startActingFor) must book and see THEIR
 * appointments, not their own. Before this fix this page resolved only the
 * caller's own profile — every other patient/* route was moved onto
 * getPatientDashboardContext when acting-for was introduced (2026-08-01);
 * this one was missed, so "book_appointments" as a caregiver permission had
 * nothing real to gate: the only appointment a caregiver could ever reach
 * through this page was their own.
 */
export default async function PatientAppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { profile, subjectId } = await getPatientDashboardContext();
  if (!profile.organisation_id) {
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
      <MyAppointmentsList patientId={subjectId} />
      <BookAppointment
        organisationId={profile.organisation_id}
        patientId={subjectId}
        initialAppointmentType={initialAppointmentType}
      />
    </div>
  );
}
