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

/** A requested plan plus the (null-gated) patient identity — clinician
 * worklist row shape. */
export type ContraceptionPlanWithPatient = ContraceptionPlan & {
  patient: { full_name: string | null; patient_number: string | null } | null;
};

const PLAN_WITH_PATIENT_SELECT =
  "*, patient:profiles!contraception_plans_patient_id_fkey(full_name, patient_number)";

export const orgRequestedContraceptionPlansKey = ["contraception-plans", "org", "requested"];

/**
 * Every contraception plan still awaiting clinical review (status =
 * 'requested') across the caller's org — oldest first, so the
 * longest-waiting request surfaces first. RLS (is_org_staff) does the org
 * scoping.
 */
export function useOrgRequestedContraceptionPlans() {
  return useQuery({
    queryKey: orgRequestedContraceptionPlansKey,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("contraception_plans")
        .select(PLAN_WITH_PATIENT_SELECT)
        .eq("status", "requested")
        .order("requested_at", { ascending: true });
      if (error) throw error;
      return data as unknown as ContraceptionPlanWithPatient[];
    },
  });
}
