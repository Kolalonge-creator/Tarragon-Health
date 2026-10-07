import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database, Enums, Tables } from "@tarragon/shared";
import { healthEducationCatalogueKey, type HealthEducationCategory } from "./health-education";

/**
 * S55 Learning Centre: search in everyday terms, this week's lesson, the alias list, the clinician creator programme.
 * Every call is an RLS-scoped table read or a SECURITY DEFINER function; the rules (Members lock, review expiry, who may
 * approve) live in the database, not here.
 */
export type HealthEducationSearchResult =
  Database["public"]["Functions"]["health_education_search"]["Returns"][number];
export type LearningThisWeek =
  Database["public"]["Functions"]["learning_this_week"]["Returns"][number];

/** One search across every category. A query under two characters is not sent. */
export function useHealthEducationSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ["health-education-search", q] as const,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("health_education_search", { p_query: q, p_limit: 20 });
      if (error) throw error;
      return (data ?? []) as HealthEducationSearchResult[];
    },
    enabled: q.length >= 2,
    staleTime: 30_000,
  });
}

/** "This week's lesson" for Today: one short lesson (5 minutes or less), or none. */
export function useLearningThisWeek(patientId: string) {
  return useQuery({
    queryKey: ["learning-this-week", patientId] as const,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("learning_this_week");
      if (error) throw error;
      return ((data ?? []) as LearningThisWeek[])[0] ?? null;
    },
    enabled: !!patientId,
  });
}

export type HealthEducationAlias = Tables<"health_education_search_aliases">;
export const healthEducationAliasesKey = ["health-education-aliases"] as const;

/** Admin and CMO: every alias. */
export function useHealthEducationAliases() {
  return useQuery({
    queryKey: healthEducationAliasesKey,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("health_education_search_aliases")
        .select("*")
        .order("review_state", { ascending: true })
        .order("alias", { ascending: true });
      if (error) throw error;
      return (data ?? []) as HealthEducationAlias[];
    },
  });
}

export function useSaveHealthEducationAlias() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: string; alias: string; expandsTo: string; note?: string | null }) => {
      const supabase = createClient();
      const row = { alias: input.alias.trim(), expands_to: input.expandsTo.trim(), note: input.note ?? null };
      const { error } = input.id
        ? await supabase.from("health_education_search_aliases").update(row).eq("id", input.id)
        : await supabase.from("health_education_search_aliases").insert(row);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: healthEducationAliasesKey }),
  });
}

/** Only the Chief Medical Officer can mark an alias reviewed (the database refuses anyone else). */
export function useSetAliasReviewState() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, state }: { id: string; state: "draft" | "clinician_reviewed" | "retired" }) => {
      const supabase = createClient();
      const { error } = await supabase.from("health_education_search_aliases").update({ review_state: state }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: healthEducationAliasesKey }),
  });
}

export type CreatorRow = Tables<"creators">;
export const creatorsKey = ["learning-creators"] as const;

export type CreatorWithStaff = CreatorRow & {
  staff: { full_name: string; doctor_tier: string | null; credential_verified_at: string | null; active: boolean } | null;
};

export function useCreators() {
  return useQuery({
    queryKey: creatorsKey,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("creators")
        .select("*, staff:clinical_staff(full_name, doctor_tier, credential_verified_at, active)")
        .order("requested_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as CreatorWithStaff[];
    },
  });
}

/** The signed-in clinician's own creator row (the CMO can read every row, so filter by their staff id). */
export function useMyCreator(staffId: string) {
  return useQuery({
    queryKey: [...creatorsKey, "mine", staffId] as const,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.from("creators").select("*").eq("clinical_staff_id", staffId).maybeSingle();
      if (error) throw error;
      return (data ?? null) as CreatorRow | null;
    },
    enabled: !!staffId,
  });
}

export function useSetCreatorStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, reason }: { id: string; status: "approved" | "suspended"; reason: string }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("set_creator_status", { p_creator: id, p_status: status, p_reason: reason });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: creatorsKey }),
  });
}

export function useApplyAsCreator() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (bio: string) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("apply_as_creator", { p_bio: bio });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: creatorsKey }),
  });
}

export type CreatorContentRow = Database["public"]["Functions"]["creator_my_content"]["Returns"][number];
export const creatorContentKey = ["creator-my-content"] as const;

export function useCreatorMyContent() {
  return useQuery({
    queryKey: creatorContentKey,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("creator_my_content");
      if (error) throw error;
      return (data ?? []) as CreatorContentRow[];
    },
  });
}

export type CreatorSubmission = {
  code: string;
  title: string;
  summary: string;
  body: string;
  category: HealthEducationCategory;
  contentType: Enums<"health_education_content_type">;
  estimatedMinutes: number;
  sourceReference: string;
  nextAction: string;
  nextStepKind: "care_plan_goal" | "booking" | "lesson";
  nextStepTargetCode: string | null;
};

export function useCreatorSubmitContent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatorSubmission) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("creator_submit_content", {
        p_code: input.code,
        p_title: input.title,
        p_summary: input.summary,
        p_body: input.body,
        p_category: input.category,
        p_content_type: input.contentType,
        p_estimated_minutes: input.estimatedMinutes,
        p_source_reference: input.sourceReference,
        p_next_action: input.nextAction,
        p_next_step_kind: input.nextStepKind,
        p_next_step_target_code: input.nextStepTargetCode as string,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: creatorContentKey }),
  });
}

/** Admin: copy a public marketing article into the in-app library as a DRAFT myth-busting item. */
export function useMirrorMarketingResource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (slug: string) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("mirror_marketing_resource_to_learning", { p_slug: slug, p_series_tag: "myth_busting" });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: healthEducationCatalogueKey }),
  });
}

/** Verified clinicians for the reviewer link in the admin editor. */
export function useVerifiedClinicians() {
  return useQuery({
    queryKey: ["learning-verified-clinicians"] as const,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("clinical_staff")
        .select("id, full_name, doctor_tier")
        .eq("active", true)
        .not("credential_verified_at", "is", null)
        .neq("doctor_tier", "care_coordinator")
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as { id: string; full_name: string; doctor_tier: string | null }[];
    },
  });
}

/** Content ids that are lessons in a programme: their length is limited (spec 9.2). Admin read. */
export function useProgrammeLessonIds() {
  return useQuery({
    queryKey: ["learning-programme-lesson-ids"] as const,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.from("health_education_programme_modules").select("content_id");
      if (error) throw error;
      return (data ?? []).map((r) => r.content_id as string);
    },
  });
}
