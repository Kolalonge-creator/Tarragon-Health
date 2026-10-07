import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";
import type { LogScreeningCompletionInput } from "@/lib/validation/screening-completion";
import type { DeclineScreeningInput } from "@/lib/validation/screening-decline";
import {
  acceptOptionalScreeningSchema,
  type AcceptOptionalScreeningInput,
} from "@/lib/validation/optional-screening-accept";
import {
  computeScreeningRecommendations,
  buildLastCompletedByScreenTypeId,
  type ScreeningProfile,
  type ScreeningRecommendation,
} from "@/lib/rules/screening-recommendations";
import { todayIsoDate } from "@/lib/queries/medications";

export type ScreeningSchedule = Tables<"screening_schedules"> & {
  screen_type: { name: string; code: string } | null;
};

export function screeningSchedulesKey(patientId: string) {
  return ["screening-schedules", patientId];
}

export function useScreeningSchedules(patientId: string) {
  return useQuery({
    queryKey: screeningSchedulesKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("screening_schedules")
        .select("*, screen_type:screen_types(name, code)")
        .eq("patient_id", patientId)
        .neq("status", "cancelled")
        .order("due_date", { ascending: true });
      if (error) throw error;
      return data as ScreeningSchedule[];
    },
    enabled: !!patientId,
  });
}

/**
 * Patient self-reports a due screening as done, with the date it was
 * actually performed. Writes through the patient's own RLS-scoped session
 * (screening_completions is patient-insert-own, same trust level as
 * vaccination_records); the private.refresh_screening_schedule_on_completion
 * trigger closes the matching schedule row and schedules the next cycle from
 * performed_date — not from today, and not a fixed cadence — mirroring
 * generateVaccinationScheduleBestEffort's "next dose off the logged date"
 * contract. Returns the new completion id so the caller can immediately link
 * an uploaded result document to it (see PatientResultUpload's
 * screeningCompletionId prop).
 */
export function useLogScreeningCompletion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: LogScreeningCompletionInput & { patientId: string }
    ): Promise<string> => {
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

      const { patientId, schedule_id, note, ...rest } = input;
      const { data, error } = await supabase
        .from("screening_completions")
        .insert({
          ...rest,
          patient_id: patientId,
          organisation_id: profile.organisation_id,
          schedule_id: schedule_id ?? null,
          note: note?.trim() || null,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: screeningSchedulesKey(variables.patientId) });
    },
  });
}

/**
 * Patient declines a recommended screening, with a reason. Writes through
 * the patient's own RLS-scoped session (screening_schedules_update already
 * permits the owning patient to update their own row); the DB CHECK
 * constraint screening_schedules_declined_requires_reason keeps status and
 * declined_at/declined_reason consistent, and
 * private.block_screening_schedule_after_decline stops the recommendation
 * engine or any refresh trigger from silently reopening this screen type
 * afterwards.
 */
export function useDeclineScreeningSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: DeclineScreeningInput & { patientId: string }): Promise<void> => {
      const supabase = createClient();
      const { error } = await supabase
        .from("screening_schedules")
        .update({
          status: "declined",
          declined_at: new Date().toISOString(),
          declined_reason: input.reason,
        })
        .eq("id", input.schedule_id)
        .eq("patient_id", input.patientId);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: screeningSchedulesKey(variables.patientId) });
    },
  });
}

export interface OptionalScreeningOffer extends ScreeningRecommendation {
  screenTypeName: string;
}

export function optionalScreeningOffersKey(patientId: string) {
  return ["optional-screening-offers", patientId];
}

/**
 * screen_types.is_optional rows ("Offered when due, never assumed. The
 * patient opts in rather than finding it already inside their review.") the
 * patient is currently eligible for and hasn't already actioned. Reuses
 * computeScreeningRecommendations — the same pure eligibility/cadence engine
 * actions.ts uses for the auto-scheduled calendar — rather than a second,
 * hand-rolled sex/age/cadence check; an empty risk-tier map is correct here
 * since none of TIER_ESCALATIONS' codes are ever is_optional.
 *
 * "Already actioned" means any screening_schedules row that isn't itself
 * 'cancelled' — pending/booked/overdue/completed/declined all mean the
 * patient has already engaged with this screen type, so it drops out of the
 * offer list. A 'cancelled' row (e.g. one of the force-scheduled rows this
 * fix retroactively cancelled) is deliberately NOT treated as actioned — the
 * whole point is that those patients get a fresh, real opt-in instead.
 */
export function useOptionalScreeningOffers(patientId: string, profile: ScreeningProfile) {
  return useQuery({
    queryKey: optionalScreeningOffersKey(patientId),
    queryFn: async (): Promise<OptionalScreeningOffer[]> => {
      const supabase = createClient();
      const [{ data: screenTypes, error: screenTypesError }, { data: schedules, error: schedulesError }] =
        await Promise.all([
          supabase
            .from("screen_types")
            .select("id, code, name, sex_applicability, age_from, age_to, frequency_months, is_optional")
            .eq("is_active", true)
            .eq("is_optional", true),
          supabase
            .from("screening_schedules")
            .select("screen_type_id, status, due_date")
            .eq("patient_id", patientId),
        ]);
      if (screenTypesError) throw screenTypesError;
      if (schedulesError) throw schedulesError;

      const lastCompletedByScreenTypeId = buildLastCompletedByScreenTypeId(schedules ?? []);
      // 'cancelled' is deliberately excluded from "actioned" — e.g. one of
      // the force-scheduled rows the 2026-09-22 migration retroactively
      // cancelled — the whole point is that patient gets a fresh, real
      // opt-in instead. Every other status means they've already engaged.
      const actionedScreenTypeIds = new Set(
        (schedules ?? []).filter((row) => row.status !== "cancelled").map((row) => row.screen_type_id)
      );

      const recommendations = computeScreeningRecommendations(
        screenTypes ?? [],
        new Map(),
        profile,
        lastCompletedByScreenTypeId
      );

      const today = todayIsoDate();
      const nameByScreenTypeId = new Map((screenTypes ?? []).map((st) => [st.id, st.name]));
      return recommendations
        // "Offered WHEN DUE" (screen_types.is_optional's own column comment)
        // — computeScreeningRecommendations still returns a future-dated
        // recommendation for a screen type completed within its cadence
        // (e.g. ferritin done 2 months ago, 24-month cycle → due in 22
        // months); this is correct for the auto-scheduler's calendar
        // display but wrong for an "add to my calendar now" offer, so this
        // surface additionally requires the due date to have arrived.
        .filter((rec) => !actionedScreenTypeIds.has(rec.screenTypeId) && rec.dueDate <= today)
        .map((rec) => ({ ...rec, screenTypeName: nameByScreenTypeId.get(rec.screenTypeId) ?? "Screening" }));
    },
    enabled: !!patientId && profile.ageYears !== null,
  });
}

/**
 * Patient opts in to an offered screening — the identical insert shape
 * actions.ts's own auto-scheduler uses for every mandatory screen type, just
 * gated on the patient's own action instead of running automatically.
 * Written through the patient's own RLS-scoped session: screening_
 * schedules_insert already permits `patient_id = auth.uid()` (the same
 * trust level as screening_completions/vaccination_records self-logging),
 * so no service-role client is needed here the way actions.ts needs one for
 * its own tighten-only, engine-computed writes.
 *
 * organisation_id is re-derived server-side from the patient's own profile,
 * never trusted from the caller — matching useLogScreeningCompletion above,
 * not the shape this hook originally shipped with. screening_schedules_
 * insert's RLS only checks patient_id = auth.uid(), never that
 * organisation_id actually belongs to that patient, so accepting a
 * caller-supplied org id would let a compromised/modified client write a
 * row visible to a different organisation's staff (screening_schedules_
 * select's is_org_staff(organisation_id) branch) — a cross-tenant PHI leak.
 */
export function useAcceptOptionalScreening() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      rawInput: { patientId: string } & AcceptOptionalScreeningInput
    ): Promise<void> => {
      const input = acceptOptionalScreeningSchema.parse(rawInput);
      const supabase = createClient();
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("organisation_id")
        .eq("id", rawInput.patientId)
        .single();
      if (profileError) throw profileError;
      if (!profile?.organisation_id) {
        throw new Error("This patient has no organisation on file");
      }

      const { error } = await supabase.from("screening_schedules").insert({
        organisation_id: profile.organisation_id,
        patient_id: rawInput.patientId,
        screen_type_id: input.screenTypeId,
        due_date: input.dueDate,
        status: "pending",
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: screeningSchedulesKey(variables.patientId) });
      queryClient.invalidateQueries({ queryKey: optionalScreeningOffersKey(variables.patientId) });
    },
  });
}
