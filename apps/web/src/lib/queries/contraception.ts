"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type ContraceptionMethod = Tables<"contraception_methods">;
export type ContraceptionPlan = Tables<"contraception_plans">;

export const contraceptionMethodsKey = () => ["contraception-methods"];
export const contraceptionPlansKey = (patientId: string) => ["contraception-plans", patientId];

/**
 * The active contraception method catalogue (spec §47.7) — a global,
 * admin-editable reference table, readable by any authenticated user (see
 * contraception_methods_select), ordered for display.
 */
export function useContraceptionMethods() {
  return useQuery({
    queryKey: contraceptionMethodsKey(),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("contraception_methods")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data as ContraceptionMethod[];
    },
  });
}

/**
 * A patient's own contraception plans (requested/active/discontinued/
 * completed/declined), newest first. RLS limits this to the caller's own
 * rows or org staff — no profile_access/supporter reads (spec §47.7).
 */
export function useContraceptionPlans(patientId: string) {
  return useQuery({
    queryKey: contraceptionPlansKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("contraception_plans")
        .select("*")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ContraceptionPlan[];
    },
    enabled: !!patientId,
  });
}
