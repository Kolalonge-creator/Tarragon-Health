import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables, Enums } from "@tarragon/shared";

export type Appointment = Tables<"appointments">;
export type AppointmentWaitingListEntry = Tables<"appointment_waiting_list">;
export type ProviderAvailabilityRule = Tables<"provider_availability_rules">;
export type ProviderTimeOff = Tables<"provider_time_off">;
export type AppointmentType = Enums<"appointment_type">;
export type ConsultationMethod = Enums<"appointment_consultation_method">;
export type AppointmentStatus = Enums<"appointment_status">;

export type AvailableAppointmentSlot = {
  clinician_id: string;
  clinician_name: string;
  slot_start: string;
  slot_end: string;
  consultation_method: ConsultationMethod;
  location: string | null;
};

export const appointmentKeys = {
  availableSlots: (params: Record<string, unknown>) => ["appointments", "available-slots", params] as const,
  myUpcoming: (patientId: string) => ["appointments", "my-upcoming", patientId] as const,
  clinicianUpcoming: (clinicianId: string) => ["appointments", "clinician-upcoming", clinicianId] as const,
  myWaitingList: (patientId: string) => ["appointments", "waiting-list", "mine", patientId] as const,
  availabilityRules: (clinicianId: string) => ["appointments", "availability-rules", clinicianId] as const,
  timeOff: (clinicianId: string) => ["appointments", "time-off", clinicianId] as const,
};

const UPCOMING_STATUSES = ["held", "booked", "confirmed", "checked_in", "in_progress"] as const;

/** Open bookable slots for an appointment type — the patient-facing search
 * (10.11/10.4/10.5). Netting out leave/blocked time and existing bookings
 * happens inside get_available_appointment_slots itself. */
export function useAvailableAppointmentSlots(params: {
  organisationId: string;
  appointmentType: AppointmentType;
  consultationMethod?: ConsultationMethod;
  clinicianId?: string;
  from?: string;
  to?: string;
  enabled?: boolean;
}) {
  const { enabled = true, ...rest } = params;
  return useQuery({
    queryKey: appointmentKeys.availableSlots(rest),
    enabled,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_available_appointment_slots", {
        p_organisation_id: params.organisationId,
        p_appointment_type: params.appointmentType,
        p_consultation_method: params.consultationMethod,
        p_clinician_id: params.clinicianId,
        p_from: params.from,
        p_to: params.to,
      });
      if (error) throw error;
      return (data ?? []) as AvailableAppointmentSlot[];
    },
  });
}

/** The patient's own upcoming appointments across every appointment_type —
 * the generalised replacement view for a single-purpose "upcoming visits"
 * list. */
export function useMyUpcomingAppointments(patientId: string) {
  return useQuery({
    queryKey: appointmentKeys.myUpcoming(patientId),
    enabled: !!patientId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("appointments")
        .select("*, clinician:profiles!appointments_clinician_id_fkey(full_name)")
        .eq("patient_id", patientId)
        .in("status", UPCOMING_STATUSES)
        .order("scheduled_for", { ascending: true });
      if (error) throw error;
      return data as (Appointment & { clinician: { full_name: string | null } | null })[];
    },
  });
}

/** A clinician's own upcoming appointments — the calendar list. */
export function useClinicianUpcomingAppointments(clinicianId: string) {
  return useQuery({
    queryKey: appointmentKeys.clinicianUpcoming(clinicianId),
    enabled: !!clinicianId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("appointments")
        .select("*, patient:profiles!appointments_patient_id_fkey(full_name, patient_number)")
        .eq("clinician_id", clinicianId)
        .in("status", [...UPCOMING_STATUSES, "completed", "no_show"])
        .order("scheduled_for", { ascending: true })
        .limit(100);
      if (error) throw error;
      return data as (Appointment & { patient: { full_name: string | null; patient_number: string | null } | null })[];
    },
  });
}

function invalidateAppointmentQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["appointments"] });
}

/** 10.7 hold — the first step of booking. */
export function useHoldAppointmentSlot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      organisationId: string;
      clinicianId: string;
      appointmentType: AppointmentType;
      consultationMethod: ConsultationMethod;
      scheduledFor: string;
      endsAt: string;
      reason?: string;
      service?: string;
      location?: string;
      specialistReferralId?: string;
      carePlanId?: string;
      /**
       * Who this appointment is for, when that isn't the caller — a
       * caregiver booking for someone they support. Omit for a patient
       * booking their own appointment; hold_appointment_slot defaults
       * p_patient_id to the caller when this is left out.
       */
      patientId?: string;
    }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("hold_appointment_slot", {
        p_organisation_id: input.organisationId,
        p_clinician_id: input.clinicianId,
        p_appointment_type: input.appointmentType,
        p_consultation_method: input.consultationMethod,
        p_scheduled_for: input.scheduledFor,
        p_ends_at: input.endsAt,
        p_reason: input.reason,
        p_service: input.service,
        p_location: input.location,
        p_specialist_referral_id: input.specialistReferralId,
        p_care_plan_id: input.carePlanId,
        p_patient_id: input.patientId,
      });
      if (error) throw error;
      return data as Appointment;
    },
    onSuccess: () => invalidateAppointmentQueries(queryClient),
  });
}

/** 10.7 confirm — held -> booked/confirmed. */
export function useConfirmAppointmentBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (appointmentId: string) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("confirm_appointment_booking", { p_appointment_id: appointmentId });
      if (error) throw error;
      return data as Appointment;
    },
    onSuccess: () => invalidateAppointmentQueries(queryClient),
  });
}

/** 10.3 check-in / start / complete / no-show. */
export function useAdvanceAppointmentStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { appointmentId: string; to: "checked_in" | "in_progress" | "completed" | "no_show" }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("advance_appointment_status", {
        p_appointment_id: input.appointmentId,
        p_to: input.to,
      });
      if (error) throw error;
      return data as Appointment;
    },
    onSuccess: () => invalidateAppointmentQueries(queryClient),
  });
}

/** 10.18 cancellation. */
export function useCancelAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { appointmentId: string; reason?: string }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("cancel_appointment", {
        p_appointment_id: input.appointmentId,
        p_reason: input.reason,
      });
      if (error) throw error;
      return data as Appointment;
    },
    onSuccess: () => invalidateAppointmentQueries(queryClient),
  });
}

/** Reschedule — creates a new row, marks the old one 'rescheduled'. */
export function useRescheduleAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { appointmentId: string; newScheduledFor: string; newEndsAt: string }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("reschedule_appointment", {
        p_appointment_id: input.appointmentId,
        p_new_scheduled_for: input.newScheduledFor,
        p_new_ends_at: input.newEndsAt,
      });
      if (error) throw error;
      return data as Appointment;
    },
    onSuccess: () => invalidateAppointmentQueries(queryClient),
  });
}

/** 10.17 join the waiting list when no slot is available. */
export function useJoinWaitingList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      organisationId: string;
      patientId: string;
      appointmentType: AppointmentType;
      clinicianId?: string;
      consultationMethod?: ConsultationMethod;
      preferredFrom: string;
      preferredUntil: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("appointment_waiting_list").insert({
        organisation_id: input.organisationId,
        patient_id: input.patientId,
        appointment_type: input.appointmentType,
        clinician_id: input.clinicianId ?? null,
        consultation_method: input.consultationMethod ?? null,
        preferred_from: input.preferredFrom,
        preferred_until: input.preferredUntil,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateAppointmentQueries(queryClient),
  });
}

export function useMyWaitingListEntries(patientId: string) {
  return useQuery({
    queryKey: appointmentKeys.myWaitingList(patientId),
    enabled: !!patientId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("appointment_waiting_list")
        .select("*")
        .eq("patient_id", patientId)
        .in("status", ["waiting", "offered"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as AppointmentWaitingListEntry[];
    },
  });
}

export function useAcceptWaitingListOffer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (waitingListId: string) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("accept_waiting_list_offer", { p_waiting_list_id: waitingListId });
      if (error) throw error;
      return data as Appointment;
    },
    onSuccess: () => invalidateAppointmentQueries(queryClient),
  });
}

export function useCancelWaitingListEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (waitingListId: string) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("cancel_waiting_list_entry", { p_waiting_list_id: waitingListId });
      if (error) throw error;
    },
    onSuccess: () => invalidateAppointmentQueries(queryClient),
  });
}

/** Clinician's own recurring availability rules (10.4/10.9). */
export function useMyAvailabilityRules(clinicianId: string) {
  return useQuery({
    queryKey: appointmentKeys.availabilityRules(clinicianId),
    enabled: !!clinicianId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("provider_availability_rules")
        .select("*")
        .eq("clinician_id", clinicianId)
        .order("day_of_week", { ascending: true });
      if (error) throw error;
      return data as ProviderAvailabilityRule[];
    },
  });
}

export function useCreateAvailabilityRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      organisationId: string;
      clinicianId: string;
      dayOfWeek: number;
      startTime: string;
      endTime: string;
      consultationMethod: ConsultationMethod;
      appointmentTypes: AppointmentType[];
      slotDurationMinutes: number;
      bufferMinutes: number;
      location?: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("provider_availability_rules").insert({
        organisation_id: input.organisationId,
        clinician_id: input.clinicianId,
        day_of_week: input.dayOfWeek,
        start_time: input.startTime,
        end_time: input.endTime,
        consultation_method: input.consultationMethod,
        appointment_types: input.appointmentTypes,
        slot_duration_minutes: input.slotDurationMinutes,
        buffer_minutes: input.bufferMinutes,
        location: input.location ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateAppointmentQueries(queryClient),
  });
}

export function useDeleteAvailabilityRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ruleId: string) => {
      const supabase = createClient();
      const { error } = await supabase.from("provider_availability_rules").delete().eq("id", ruleId);
      if (error) throw error;
    },
    onSuccess: () => invalidateAppointmentQueries(queryClient),
  });
}

/** Clinician's leave/blocked time (10.5/10.10). */
export function useMyTimeOff(clinicianId: string) {
  return useQuery({
    queryKey: appointmentKeys.timeOff(clinicianId),
    enabled: !!clinicianId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("provider_time_off")
        .select("*")
        .eq("clinician_id", clinicianId)
        .gte("ends_at", new Date().toISOString())
        .order("starts_at", { ascending: true });
      if (error) throw error;
      return data as ProviderTimeOff[];
    },
  });
}

export function useCreateProviderTimeOff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      organisationId: string;
      clinicianId: string;
      kind: "leave" | "blocked";
      startsAt: string;
      endsAt: string;
      reason?: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("provider_time_off").insert({
        organisation_id: input.organisationId,
        clinician_id: input.clinicianId,
        kind: input.kind,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        reason: input.reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateAppointmentQueries(queryClient),
  });
}
