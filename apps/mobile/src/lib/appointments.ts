import { supabase } from "./supabase";
import { postAppointmentVideoSetup } from "./api";
import type { QueryResult } from "./medications";
import type { Tables, Enums } from "@tarragon/shared";

export type Appointment = Tables<"appointments">;
export type AppointmentType = Enums<"appointment_type">;
export type ConsultationMethod = Enums<"appointment_consultation_method">;

export type AvailableSlot = {
  clinician_id: string;
  clinician_name: string;
  slot_start: string;
  slot_end: string;
  consultation_method: ConsultationMethod;
  location: string | null;
};

/** The two appointment types a patient can book for themselves — mirrors
 * apps/web/src/app/(dashboard)/patient/appointments/appointment-labels.ts's
 * PATIENT_BOOKABLE_APPOINTMENT_TYPES. Tarragon has no owned clinics and
 * offers no in-person appointment right now; every bookable type here is
 * telemedicine with a Tarragon-employed doctor. */
export const PATIENT_BOOKABLE_APPOINTMENT_TYPES: { type: AppointmentType; label: string }[] = [
  { type: "telemedicine", label: "Video or audio visit" },
  { type: "result_interpretation", label: "Result Consultation" },
];

/** Which service_products code pays for a given appointment type — mirrors
 * the web PAID_APPOINTMENT_PRODUCT_CODE map. Both current types are paid;
 * kept as a lookup (not a constant) so a future free type doesn't need this
 * call site to change. */
export function paidProductCodeFor(type: AppointmentType): string | null {
  if (type === "telemedicine") return "video_visit_credit";
  if (type === "result_interpretation") return "result_interpretation_credit";
  return null;
}

const UPCOMING_STATUSES = ["held", "booked", "confirmed", "checked_in", "in_progress"] as const;

export type AppointmentWithClinician = Appointment & { clinician: { full_name: string | null } | null };

/** The patient's own upcoming appointments, same UPCOMING_STATUSES filter as
 * the web MyAppointmentsList. */
export async function loadUpcomingAppointments(
  patientId: string
): Promise<QueryResult<AppointmentWithClinician[]>> {
  const { data, error } = await supabase
    .from("appointments")
    .select("*, clinician:profiles!appointments_clinician_id_fkey(full_name)")
    .eq("patient_id", patientId)
    .in("status", UPCOMING_STATUSES)
    .order("scheduled_for", { ascending: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as AppointmentWithClinician[] };
}

/** Open slots for a bookable type, telemedicine-only (the "How" choice web
 * removed for the same reason — no in-person option exists). */
export async function loadAvailableSlots(
  organisationId: string,
  appointmentType: AppointmentType
): Promise<QueryResult<AvailableSlot[]>> {
  const { data, error } = await supabase.rpc("get_available_appointment_slots", {
    p_organisation_id: organisationId,
    p_appointment_type: appointmentType,
    p_consultation_method: "telemedicine",
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as AvailableSlot[] };
}

/**
 * Hold then confirm a slot — the same two-step RPC sequence as
 * book-appointment.tsx's bookSlot(), plus a best-effort call to
 * /api/mobile/appointments/setup-video (postAppointmentVideoSetup) so a
 * telemedicine/result-interpretation booking gets its Zoom join link right
 * away rather than waiting for the first "Join call" tap. Can't call
 * confirm_appointment_booking a second time to get web's
 * confirmAppointmentAndSetupVideo behaviour for free — that RPC refuses
 * anything already confirmed — so this hits the narrower setup-only route
 * instead. Errors from that call are swallowed on purpose: the booking
 * itself already succeeded, and a missing join link self-heals the next
 * time either platform's setup path runs for this appointment.
 */
export async function bookAppointment(input: {
  organisationId: string;
  patientId: string;
  clinicianId: string;
  appointmentType: AppointmentType;
  scheduledFor: string;
  endsAt: string;
}): Promise<QueryResult<Appointment>> {
  const { data: held, error: holdError } = await supabase.rpc("hold_appointment_slot", {
    p_organisation_id: input.organisationId,
    p_patient_id: input.patientId,
    p_clinician_id: input.clinicianId,
    p_appointment_type: input.appointmentType,
    p_consultation_method: "telemedicine",
    p_scheduled_for: input.scheduledFor,
    p_ends_at: input.endsAt,
  });
  if (holdError || !held) {
    return { ok: false, error: holdError?.message ?? "Could not hold that slot" };
  }
  const { data: confirmed, error: confirmError } = await supabase.rpc("confirm_appointment_booking", {
    p_appointment_id: (held as Appointment).id,
  });
  if (confirmError || !confirmed) {
    return { ok: false, error: confirmError?.message ?? "Could not confirm this booking" };
  }
  void postAppointmentVideoSetup((confirmed as Appointment).id);
  return { ok: true, data: confirmed as Appointment };
}

export async function cancelAppointment(appointmentId: string): Promise<QueryResult<null>> {
  const { error } = await supabase.rpc("cancel_appointment", { p_appointment_id: appointmentId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}
