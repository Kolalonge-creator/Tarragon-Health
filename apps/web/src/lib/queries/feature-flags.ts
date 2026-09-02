import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type FeatureFlag = Tables<"feature_flags">;
export type FeatureFlagRule = Tables<"feature_flag_rules">;
export type FeatureFlagRuleKind = FeatureFlagRule["kind"];

/**
 * Every flag. Admin/feature_flags.manage only (RLS) — evaluation for an ordinary
 * caller goes through private.is_feature_enabled()/public.my_feature_flags(), never
 * a direct table read, so this hook is for the admin screen only.
 */
export function useFeatureFlags() {
  return useQuery({
    queryKey: ["feature-flags"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("feature_flags")
        .select("*")
        .order("key", { ascending: true });
      if (error) throw error;
      return data as FeatureFlag[];
    },
  });
}

export function useFeatureFlagRules(flagKey: string | null) {
  return useQuery({
    queryKey: ["feature-flag-rules", flagKey ?? ""],
    enabled: Boolean(flagKey),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("feature_flag_rules")
        .select("*")
        .eq("flag_key", flagKey as string)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as FeatureFlagRule[];
    },
  });
}

/**
 * Create a flag. The DB itself rejects any key touching a clinical-safety path
 * (abnormal_result/screening_upgrade/emergency/red_flag/escalation_sla/
 * category_upgrade) via private.reject_clinical_safety_flag() — that error surfaces
 * here as a normal Postgres error, not a client-side check, so it can never be
 * bypassed by a UI bug.
 */
export function useCreateFeatureFlag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { key: string; label: string; description?: string | null; category?: string }) => {
      const supabase = createClient();
      const { error } = await supabase.from("feature_flags").insert({
        key: input.key,
        label: input.label,
        description: input.description ?? null,
        category: input.category ?? "general",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feature-flags"] });
    },
  });
}

export function useUpdateFeatureFlagStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, status }: { key: string; status: FeatureFlag["status"] }) => {
      const supabase = createClient();
      const { error } = await supabase.from("feature_flags").update({ status }).eq("key", key);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feature-flags"] });
    },
  });
}

export function useUpdateFeatureFlagRollout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, rolloutPercent }: { key: string; rolloutPercent: number }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("feature_flags")
        .update({ rollout_percent: rolloutPercent })
        .eq("key", key);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feature-flags"] });
    },
  });
}

export function useDeleteFeatureFlag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (key: string) => {
      const supabase = createClient();
      const { error } = await supabase.from("feature_flags").delete().eq("key", key);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feature-flags"] });
    },
  });
}

export function useAddFeatureFlagRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      flagKey: string;
      kind: FeatureFlagRuleKind;
      value: string;
      effect: "allow" | "deny";
      note?: string | null;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("feature_flag_rules").insert({
        flag_key: input.flagKey,
        kind: input.kind,
        value: input.value.trim(),
        effect: input.effect,
        note: input.note ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["feature-flag-rules", variables.flagKey] });
    },
  });
}

export function useRemoveFeatureFlagRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; flagKey: string }) => {
      const supabase = createClient();
      const { error } = await supabase.from("feature_flag_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["feature-flag-rules", variables.flagKey] });
    },
  });
}
