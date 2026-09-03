import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type {
  ConsultationDurationType,
  Enums,
  SpecialistProviderTier,
  SpecialistVerificationStage,
  Tables,
} from "@tarragon/shared";

// ---------------------------------------------------------------------------
// Specialist Network & Provider Platform — profile enrichment, verification
// pipeline, multi-location, admin-mediated availability/calendar, and
// workload/performance reporting for specialist_providers (the referral-
// network catalogue). See docs/CLINICAL_NETWORK_SPEC.md for how this
// relates to the employed clinical_staff Tier 1-5 ladder (a different table,
// untouched here) and the standing matching/ranking guardrail (untouched —
// nothing in this file scores or ranks providers, only filters/reports).
// ---------------------------------------------------------------------------

// -- Profile enrichment -------------------------------------------------

export function useUpdateSpecialistProviderProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      subspecialty,
      qualifications,
      yearsOfExperience,
      clinicalInterests,
      providerTier,
    }: {
      id: string;
      subspecialty: string | null;
      qualifications: string[];
      yearsOfExperience: number | null;
      clinicalInterests: string[];
      providerTier: SpecialistProviderTier | null;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("specialist_providers")
        .update({
          subspecialty,
          qualifications,
          years_of_experience: yearsOfExperience,
          clinical_interests: clinicalInterests,
          provider_tier: providerTier,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["specialist-providers"] }),
  });
}

// -- Locations ------------------------------------------------------------

export type SpecialistProviderLocation = Tables<"specialist_provider_locations">;

export function useSpecialistProviderLocations(specialistProviderId: string) {
  return useQuery({
    queryKey: ["specialist-provider-locations", specialistProviderId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("specialist_provider_locations")
        .select("*")
        .eq("specialist_provider_id", specialistProviderId)
        .order("state", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return data as SpecialistProviderLocation[];
    },
    enabled: !!specialistProviderId,
  });
}

export function useCreateSpecialistProviderLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      specialistProviderId: string;
      name: string;
      state: string;
      city: string | null;
      address: string;
      contactPhone: string | null;
      supportsTelemedicine: boolean;
      supportsInPerson: boolean;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("specialist_provider_locations").insert({
        specialist_provider_id: input.specialistProviderId,
        name: input.name,
        state: input.state,
        city: input.city,
        address: input.address,
        contact_phone: input.contactPhone,
        supports_telemedicine: input.supportsTelemedicine,
        supports_in_person: input.supportsInPerson,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) =>
      qc.invalidateQueries({
        queryKey: ["specialist-provider-locations", variables.specialistProviderId],
      }),
  });
}

export function useSetSpecialistProviderLocationActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      isActive,
    }: {
      id: string;
      specialistProviderId: string;
      isActive: boolean;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("specialist_provider_locations")
        .update({ is_active: isActive })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) =>
      qc.invalidateQueries({
        queryKey: ["specialist-provider-locations", variables.specialistProviderId],
      }),
  });
}

// -- Verification pipeline (66.3) -----------------------------------------

export type SpecialistProviderVerificationEvent = Tables<"specialist_provider_verification_events">;

export const SPECIALIST_VERIFICATION_STAGES: SpecialistVerificationStage[] = [
  "application",
  "identity_verification",
  "registration_verification",
  "qualification_verification",
  "specialty_verification",
  "contract",
  "onboarding",
  "clinical_approval",
  "active",
];

export function useSpecialistProviderVerificationEvents(specialistProviderId: string) {
  return useQuery({
    queryKey: ["specialist-provider-verification-events", specialistProviderId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("specialist_provider_verification_events")
        .select("*")
        .eq("specialist_provider_id", specialistProviderId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as SpecialistProviderVerificationEvent[];
    },
    enabled: !!specialistProviderId,
  });
}

/** Advances (or sends back) a specialist_providers row's verification_stage via the DB-enforced advance_specialist_verification_stage() RPC — never a bare column update, so the transition is always attributed and audited. */
export function useAdvanceSpecialistVerificationStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      toStage,
      note,
    }: {
      id: string;
      toStage: SpecialistVerificationStage;
      note?: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("advance_specialist_verification_stage", {
        p_specialist_provider_id: id,
        p_to_stage: toStage,
        p_note: note,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["specialist-providers"] });
      qc.invalidateQueries({ queryKey: ["specialist-provider-verification-events", variables.id] });
    },
  });
}

// -- Standardised consultation durations (66.7) ---------------------------

export type ConsultationDurationDefault = Tables<"platform_consultation_duration_defaults">;

export function useConsultationDurationDefaults() {
  return useQuery({
    queryKey: ["consultation-duration-defaults"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("platform_consultation_duration_defaults")
        .select("*")
        .order("consultation_method", { ascending: true });
      if (error) throw error;
      return data as ConsultationDurationDefault[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

// -- Availability rules & time off (66.5/66.6) ----------------------------

export type SpecialistProviderAvailabilityRule = Tables<"specialist_provider_availability_rules">;
export type SpecialistProviderTimeOff = Tables<"specialist_provider_time_off">;
export type ConsultationMethod = Enums<"appointment_consultation_method">;

export function useSpecialistProviderAvailabilityRules(specialistProviderId: string) {
  return useQuery({
    queryKey: ["specialist-provider-availability-rules", specialistProviderId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("specialist_provider_availability_rules")
        .select("*")
        .eq("specialist_provider_id", specialistProviderId)
        .order("day_of_week", { ascending: true })
        .order("start_time", { ascending: true });
      if (error) throw error;
      return data as SpecialistProviderAvailabilityRule[];
    },
    enabled: !!specialistProviderId,
  });
}

export function useCreateSpecialistProviderAvailabilityRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      specialistProviderId: string;
      specialistProviderLocationId: string | null;
      dayOfWeek: number;
      startTime: string;
      endTime: string;
      consultationMethod: ConsultationMethod;
      durationType: ConsultationDurationType;
      slotDurationMinutes: number;
      bufferMinutes: number;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("specialist_provider_availability_rules").insert({
        specialist_provider_id: input.specialistProviderId,
        specialist_provider_location_id: input.specialistProviderLocationId,
        day_of_week: input.dayOfWeek,
        start_time: input.startTime,
        end_time: input.endTime,
        consultation_method: input.consultationMethod,
        duration_type: input.durationType,
        slot_duration_minutes: input.slotDurationMinutes,
        buffer_minutes: input.bufferMinutes,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({
        queryKey: ["specialist-provider-availability-rules", variables.specialistProviderId],
      });
      qc.invalidateQueries({ queryKey: ["available-specialist-slots", variables.specialistProviderId] });
    },
  });
}

export function useSetSpecialistProviderAvailabilityRuleActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      isActive,
    }: {
      id: string;
      specialistProviderId: string;
      isActive: boolean;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("specialist_provider_availability_rules")
        .update({ is_active: isActive })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({
        queryKey: ["specialist-provider-availability-rules", variables.specialistProviderId],
      });
      qc.invalidateQueries({ queryKey: ["available-specialist-slots", variables.specialistProviderId] });
    },
  });
}

export function useDeleteSpecialistProviderAvailabilityRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; specialistProviderId: string }) => {
      const supabase = createClient();
      const { error } = await supabase.from("specialist_provider_availability_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({
        queryKey: ["specialist-provider-availability-rules", variables.specialistProviderId],
      });
      qc.invalidateQueries({ queryKey: ["available-specialist-slots", variables.specialistProviderId] });
    },
  });
}

export function useSpecialistProviderTimeOff(specialistProviderId: string) {
  return useQuery({
    queryKey: ["specialist-provider-time-off", specialistProviderId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("specialist_provider_time_off")
        .select("*")
        .eq("specialist_provider_id", specialistProviderId)
        .order("starts_at", { ascending: false });
      if (error) throw error;
      return data as SpecialistProviderTimeOff[];
    },
    enabled: !!specialistProviderId,
  });
}

export function useCreateSpecialistProviderTimeOff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      specialistProviderId: string;
      kind: "leave" | "blocked" | "emergency_unavailable";
      startsAt: string;
      endsAt: string;
      reason: string | null;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("specialist_provider_time_off").insert({
        specialist_provider_id: input.specialistProviderId,
        kind: input.kind,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["specialist-provider-time-off", variables.specialistProviderId] });
      qc.invalidateQueries({ queryKey: ["available-specialist-slots", variables.specialistProviderId] });
    },
  });
}

export function useDeleteSpecialistProviderTimeOff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; specialistProviderId: string }) => {
      const supabase = createClient();
      const { error } = await supabase.from("specialist_provider_time_off").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["specialist-provider-time-off", variables.specialistProviderId] });
      qc.invalidateQueries({ queryKey: ["available-specialist-slots", variables.specialistProviderId] });
    },
  });
}

export interface AvailableSpecialistSlot {
  slot_start: string;
  slot_end: string;
  consultation_method: ConsultationMethod;
  duration_type: ConsultationDurationType;
  location_id: string | null;
}

/** Computed slots for the specialist calendar view (66.6) — a read model over the availability rules + time off, not a booking mechanism (specialists are still coordinated through specialist_referrals). */
export function useAvailableSpecialistSlots(specialistProviderId: string, from?: string, to?: string) {
  return useQuery({
    queryKey: ["available-specialist-slots", specialistProviderId, from ?? "", to ?? ""],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_available_specialist_slots", {
        p_specialist_provider_id: specialistProviderId,
        ...(from ? { p_from: from } : {}),
        ...(to ? { p_to: to } : {}),
      });
      if (error) throw error;
      return data as AvailableSpecialistSlot[];
    },
    enabled: !!specialistProviderId,
  });
}

// -- Workload & performance (66.8/66.9) ------------------------------------

export interface SpecialistProviderWorkload {
  consultations_today: number;
  consultations_telemedicine_today: number;
  consultations_physical_today: number;
  avg_waiting_days_90d: number | null;
  cancellation_rate_90d: number | null;
  referrals_90d: number;
}

export function useSpecialistProviderWorkload(specialistProviderId: string) {
  return useQuery({
    queryKey: ["specialist-provider-workload", specialistProviderId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("analytics_specialist_provider_workload", {
        p_specialist_provider_id: specialistProviderId,
      });
      if (error) throw error;
      return data as unknown as SpecialistProviderWorkload;
    },
    enabled: !!specialistProviderId,
  });
}

export interface SpecialistProviderPerformance {
  referrals_total: number;
  referrals_completed: number;
  referrals_declined: number;
  referral_completion_rate: number | null;
  avg_report_turnaround_days: number | null;
  patient_feedback_available: false;
  punctuality_tracked: false;
}

export function useSpecialistProviderPerformance(specialistProviderId: string) {
  return useQuery({
    queryKey: ["specialist-provider-performance", specialistProviderId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("analytics_specialist_provider_performance", {
        p_specialist_provider_id: specialistProviderId,
      });
      if (error) throw error;
      return data as unknown as SpecialistProviderPerformance;
    },
    enabled: !!specialistProviderId,
  });
}
