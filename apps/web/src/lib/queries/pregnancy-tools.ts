import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AntenatalVisitRow, PregnancyContentRow } from "@tarragon/clinical";
import { createClient } from "@/lib/supabase/client";

/**
 * S67 follow-up (OQ-346): plain RLS-scoped reads and writes for the pregnancy screens. No service-role client, no new access shape: every
 * policy (patient or staff only, reproductive_health category for a caregiver) lives in the database. The S67 tables are not in the
 * generated client types yet (the types are spliced from the live project, which holds other branches' schema, see CLAUDE.md), so the
 * calls go through this narrow shape instead of `any`.
 */
interface QueryError { code?: string; message?: string }
interface Filterable<T> extends PromiseLike<{ data: T | null; error: QueryError | null }> {
  eq(column: string, value: string | number | boolean): Filterable<T>;
  order(column: string, opts?: { ascending?: boolean }): Filterable<T>;
  limit(n: number): Filterable<T>;
  maybeSingle(): PromiseLike<{ data: T extends (infer U)[] ? U | null : T | null; error: QueryError | null }>;
}
interface UntypedClient {
  from(table: string): {
    select(columns: string): Filterable<unknown[]>;
    insert(row: Record<string, unknown>): PromiseLike<{ error: QueryError | null }>;
    upsert(row: Record<string, unknown>, opts: { onConflict: string }): PromiseLike<{ error: QueryError | null }>;
  };
}
const untyped = (): UntypedClient => createClient() as unknown as UntypedClient;

export interface KickHistoryRow {
  started_at: string;
  result: "target_reached" | "contact_today" | "stopped";
  minutes_to_target: number | null;
}

export const kickHistoryKey = (patientId: string) => ["kick-history", patientId] as const;

export function useKickHistory(patientId: string) {
  return useQuery({
    queryKey: kickHistoryKey(patientId),
    queryFn: async (): Promise<KickHistoryRow[]> => {
      const { data, error } = await untyped().from("kick_counts").select("started_at, result, minutes_to_target").eq("patient_id", patientId).order("started_at", { ascending: false }).limit(12);
      if (error) throw new Error(error.message ?? "kick history");
      return (data ?? []) as KickHistoryRow[];
    },
  });
}

export interface KickSessionRow {
  organisation_id: string;
  patient_id: string;
  client_id: string;
  started_at: string;
  ended_at: string;
  movement_offsets_s: number[];
  reported_less: boolean;
  result: "target_reached" | "contact_today" | "stopped";
  result_reason: "window_elapsed_without_target" | "clear_drop" | "reported_less_movement" | null;
  minutes_to_target: number | null;
  week_at_start: number | null;
  config_version: number;
  source: "patient";
}

export function useSaveKickSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: KickSessionRow) => {
      const { error } = await untyped().from("kick_counts").insert(row as unknown as Record<string, unknown>);
      // 23505 is the unique (patient, client id): the same session sent twice is a duplicate, not a failure.
      if (error && error.code !== "23505") throw new Error(error.message ?? "kick save");
    },
    onSuccess: (_d, row) => qc.invalidateQueries({ queryKey: kickHistoryKey(row.patient_id) }),
  });
}

export interface ContractionSessionRow {
  organisation_id: string;
  patient_id: string;
  client_id: string;
  started_at: string;
  timings: { s: number; d: number }[];
  instant_signs: string[];
  pattern: "standard" | "earlier";
  result: "keep_timing" | "go_now";
  result_reason: "instant_sign" | "before_term" | "pattern" | null;
  week_at_start: number | null;
  config_version: number;
  source: "patient";
}

export function useSaveContractionSession() {
  return useMutation({
    mutationFn: async (row: ContractionSessionRow) => {
      const { error } = await untyped().from("contractions").insert(row as unknown as Record<string, unknown>);
      if (error && error.code !== "23505") throw new Error(error.message ?? "contraction save");
    },
  });
}

export interface ActivePregnancy {
  id: string;
}
export const activePregnancyKey = (patientId: string) => ["active-pregnancy", patientId] as const;

export function useActivePregnancy(patientId: string) {
  return useQuery({
    queryKey: activePregnancyKey(patientId),
    queryFn: async (): Promise<ActivePregnancy | null> => {
      const { data, error } = await untyped().from("pregnancies").select("id").eq("patient_id", patientId).eq("state", "active").maybeSingle();
      if (error) throw new Error(error.message ?? "pregnancy");
      return (data ?? null) as ActivePregnancy | null;
    },
  });
}

export interface BirthPlanRow {
  place_of_birth: string | null;
  transport_plan: string | null;
  money_plan_kobo: number | null;
  money_plan_note: string | null;
  blood_donor_name: string | null;
  blood_donor_phone: string | null;
  escort_name: string | null;
  escort_phone: string | null;
  long_journey: boolean;
  previous_fast_labour: boolean;
  previous_births: number;
}
export const birthPlanKey = (pregnancyId: string | null) => ["birth-plan", pregnancyId] as const;

export function useBirthPlan(pregnancyId: string | null) {
  return useQuery({
    queryKey: birthPlanKey(pregnancyId),
    enabled: pregnancyId !== null,
    queryFn: async (): Promise<BirthPlanRow | null> => {
      const { data, error } = await untyped()
        .from("birth_plans")
        .select("place_of_birth, transport_plan, money_plan_kobo, money_plan_note, blood_donor_name, blood_donor_phone, escort_name, escort_phone, long_journey, previous_fast_labour, previous_births")
        .eq("pregnancy_id", pregnancyId as string)
        .maybeSingle();
      if (error) throw new Error(error.message ?? "birth plan");
      return (data ?? null) as BirthPlanRow | null;
    },
  });
}

export function useSaveBirthPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { patientId: string; organisationId: string; pregnancyId: string; plan: BirthPlanRow }) => {
      const { error } = await untyped()
        .from("birth_plans")
        .upsert(
          { ...input.plan, patient_id: input.patientId, organisation_id: input.organisationId, pregnancy_id: input.pregnancyId, source: "patient" },
          { onConflict: "pregnancy_id" },
        );
      if (error) throw new Error(error.message ?? "birth plan save");
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: birthPlanKey(v.pregnancyId) }),
  });
}

/** Reviewed week content only. The database returns nothing else to a patient; the screen checks again (weekCardState). */
export function usePregnancyWeekContent(week: number | null) {
  return useQuery({
    queryKey: ["pregnancy-content", "week", week] as const,
    enabled: week !== null,
    queryFn: async (): Promise<PregnancyContentRow[]> => {
      const { data, error } = await untyped().from("pregnancy_content").select("kind, week, title, body_text, review_state, version").eq("kind", "week").eq("week", week as number);
      if (error) throw new Error(error.message ?? "pregnancy content");
      return (data ?? []) as PregnancyContentRow[];
    },
  });
}

export function useAntenatalVisits(patientId: string) {
  return useQuery({
    queryKey: ["antenatal-visits", patientId] as const,
    queryFn: async (): Promise<AntenatalVisitRow[]> => {
      const { data, error } = await untyped()
        .from("antenatal_visits")
        .select("id, visit_number, target_week, gestational_week_at_visit, status")
        .eq("patient_id", patientId)
        .order("visit_number", { ascending: true });
      if (error) throw new Error(error.message ?? "antenatal visits");
      return (data ?? []) as AntenatalVisitRow[];
    },
  });
}
