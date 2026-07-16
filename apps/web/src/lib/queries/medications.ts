import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";
import type { MedicationInput } from "@/lib/validation/medications";
import type { MedicationLogInput } from "@/lib/validation/medication-logs";

export type Medication = Tables<"medications">;
export type MedicationLog = Tables<"medication_logs">;

/** A medication row plus the condition of its linked care plan, if any —
 * lets the "digital medicines cabinet" show what each drug is treating. */
export type MedicationWithCarePlan = Medication & {
  care_plan: { condition: string; status: string } | null;
};

const MEDICATION_SELECT = "*, care_plan:care_plans(condition, status)";

function medicationsKey(patientId: string) {
  return ["medications", patientId];
}

function stoppedMedicationsKey(patientId: string) {
  return ["medications", "stopped", patientId];
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
        .select(MEDICATION_SELECT)
        .eq("patient_id", patientId)
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as MedicationWithCarePlan[];
    },
    enabled: !!patientId,
  });
}

/**
 * Past (stopped/switched) medications — the other half of the medication
 * timeline (pathway Scenario 2). Kept as a separate query from the active list
 * so the "medicines cabinet" stays focused on current drugs and history is
 * opt-in. Newest-stopped first, falling back to updated_at for legacy rows
 * deactivated before stopped_at existed.
 */
export function useStoppedMedications(patientId: string) {
  return useQuery({
    queryKey: stoppedMedicationsKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("medications")
        .select(MEDICATION_SELECT)
        .eq("patient_id", patientId)
        .eq("is_active", false)
        .order("stopped_at", { ascending: false, nullsFirst: false })
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as MedicationWithCarePlan[];
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
      input: MedicationInput & {
        patientId: string;
        source: "patient" | "clinician" | "specialist";
      }
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

      const {
        patientId,
        source,
        refill_date,
        care_plan_id,
        prescriber_name,
        prescriber_document_url,
        ...rest
      } = input;
      const { error } = await supabase.from("medications").insert({
        ...rest,
        patient_id: patientId,
        organisation_id: profile.organisation_id,
        source,
        refill_date: refill_date || null,
        care_plan_id: care_plan_id || null,
        // Only attach prescriber attribution for specialist-sourced records.
        prescriber_name: source === "specialist" ? prescriber_name || null : null,
        prescriber_document_url:
          source === "specialist" ? prescriber_document_url || null : null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: medicationsKey(variables.patientId) });
    },
  });
}

/**
 * Stop (discontinue/switch) a medication — flips is_active off and stamps
 * stopped_at + an optional reason, so the medication timeline stays complete
 * (pathway Scenario 2). RLS + enforce_medication_confirm_only decide who may:
 * the patient on their own self-/specialist-sourced rows, or a prescriber
 * (Tier 2+/Director) on a clinician row. Tier 1 cannot — an is_active change
 * is already outside its confirm-only grant.
 */
export function useStopMedication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      medicationId,
      stoppedReason,
    }: {
      medicationId: string;
      patientId: string;
      stoppedReason: string | null;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("medications")
        .update({
          is_active: false,
          stopped_at: new Date().toISOString(),
          stopped_reason: stoppedReason,
        })
        .eq("id", medicationId);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: medicationsKey(variables.patientId) });
      queryClient.invalidateQueries({ queryKey: stoppedMedicationsKey(variables.patientId) });
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
