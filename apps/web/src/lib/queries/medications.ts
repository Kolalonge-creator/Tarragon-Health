import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";
import type { MedicationInput } from "@/lib/validation/medications";
import type { MedicationLogInput } from "@/lib/validation/medication-logs";

export type Medication = Tables<"medications">;
export type MedicationLog = Tables<"medication_logs">;

function medicationsKey(patientId: string) {
  return ["medications", patientId];
}

function todaysDoseLogsKey(patientId: string, date: string) {
  return ["medication-logs", "today", patientId, date];
}

/** Patient-local (Africa/Lagos) calendar date, per CLAUDE.md's fixed timezone rule. */
export function todayIsoDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}

export function useMedications(patientId: string) {
  return useQuery({
    queryKey: medicationsKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("medications")
        .select("*")
        .eq("patient_id", patientId)
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Medication[];
    },
    enabled: !!patientId,
  });
}

export function useTodaysDoseLogs(patientId: string) {
  const today = todayIsoDate();
  return useQuery({
    queryKey: todaysDoseLogsKey(patientId, today),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("medication_logs")
        .select("*")
        .eq("patient_id", patientId)
        .eq("scheduled_for_date", today);
      if (error) throw error;
      return data as MedicationLog[];
    },
    enabled: !!patientId,
  });
}

/**
 * Shared by both the patient self-add and clinician-prescribe flows — RLS
 * enforces who may write what, so the two call sites just pass a different
 * `patientId`/`source`, not different query logic.
 */
export function useAddMedication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: MedicationInput & { patientId: string; source: "patient" | "clinician" }
    ) => {
      const supabase = createClient();
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("organisation_id")
        .eq("id", input.patientId)
        .single();
      if (profileError) throw profileError;
      if (!profile?.organisation_id) {
        throw new Error("This patient has no organisation on file");
      }

      const { patientId, source, refill_date, care_plan_id, ...rest } = input;
      const { error } = await supabase.from("medications").insert({
        ...rest,
        patient_id: patientId,
        organisation_id: profile.organisation_id,
        source,
        refill_date: refill_date || null,
        care_plan_id: care_plan_id || null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: medicationsKey(variables.patientId) });
    },
  });
}

/**
 * Tier 1 "confirm and continue" a stable, clinician-prescribed medication —
 * the other half of Tier 1's job alongside useAddMedication, which they
 * cannot call (20260715181500_pharmacy_authority_by_tier.sql blocks org
 * staff without prescribing authority from inserting/updating medications
 * at all). This path is narrower: only medications_update's
 * can_confirm_medication_refill branch admits Tier 1, and
 * private.enforce_medication_confirm_only (BEFORE UPDATE trigger) then
 * restricts the write to refill_date only — drug/dose/frequency/active
 * status are untouched no matter what the client sends. last_confirmed_by
 * is never sent from here; the trigger derives it server-side from the
 * caller's own active clinical_staff row, so it can't be spoofed.
 */
export function useConfirmMedicationRefill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      medicationId,
      refillDate,
    }: {
      medicationId: string;
      patientId: string;
      refillDate: string | null;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("medications")
        .update({ refill_date: refillDate })
        .eq("id", medicationId);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: medicationsKey(variables.patientId) });
    },
  });
}

/**
 * Select-then-branch upsert against the (medication_id, scheduled_for_date,
 * scheduled_time) partial unique index — supabase-js's `onConflict` can't
 * target a partial index, same rationale as the reminder-rules mutations.
 */
export function useLogDose() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: MedicationLogInput & { patientId: string; organisationId: string }
    ) => {
      const supabase = createClient();
      const { patientId, organisationId, ...rest } = input;

      if (rest.scheduled_time && rest.scheduled_for_date) {
        const { data: existing } = await supabase
          .from("medication_logs")
          .select("id")
          .eq("medication_id", rest.medication_id)
          .eq("scheduled_for_date", rest.scheduled_for_date)
          .eq("scheduled_time", rest.scheduled_time)
          .maybeSingle();

        const { error } = existing
          ? await supabase
              .from("medication_logs")
              .update({
                status: rest.status,
                reason: rest.reason ?? null,
                logged_at: new Date().toISOString(),
              })
              .eq("id", existing.id)
          : await supabase.from("medication_logs").insert({
              ...rest,
              patient_id: patientId,
              organisation_id: organisationId,
            });
        if (error) throw error;
      } else {
        const { error } = await supabase.from("medication_logs").insert({
          ...rest,
          patient_id: patientId,
          organisation_id: organisationId,
        });
        if (error) throw error;
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: todaysDoseLogsKey(variables.patientId, todayIsoDate()),
      });
    },
  });
}
