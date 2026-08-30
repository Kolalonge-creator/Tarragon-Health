import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Enums, Tables } from "@tarragon/shared";

export type ProviderRestriction = Tables<"provider_restrictions"> & {
  clinical_staff: Pick<Tables<"clinical_staff">, "full_name" | "doctor_tier"> | null;
};
export type ProviderRestrictionStage = Enums<"provider_restriction_stage">;
export type ProviderRestrictionReason = Enums<"provider_restriction_reason">;

const RESTRICTIONS_KEY = ["provider-restrictions"];

/**
 * The staged suspension workflow (97.11) — warning -> grace_period ->
 * service_restriction -> suspension, reason-coded and time-stamped, replacing
 * the bare clinical_staff.active boolean the earlier gap analysis flagged.
 * clinical_staff.active is untouched by this — a restriction is a separate,
 * richer record layered on top, not a replacement for the account-level flag.
 */
export function useProviderRestrictions() {
  return useQuery({
    queryKey: RESTRICTIONS_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("provider_restrictions")
        .select("*, clinical_staff(full_name, doctor_tier)")
        .order("imposed_at", { ascending: false });
      if (error) throw error;
      return data as ProviderRestriction[];
    },
  });
}

/** Impose a new restriction. RLS requires private.is_complaints_handler()
 * (admin or an active Clinical Director) — never a plain admin-role UI gate
 * alone; that DB check is the real boundary. */
export function useImposeProviderRestriction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      clinical_staff_id: string;
      stage: ProviderRestrictionStage;
      reason: ProviderRestrictionReason;
      detail?: string;
      credential_expires_at?: string | null;
    }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { data: staff, error: staffError } = await supabase
        .from("clinical_staff")
        .select("organisation_id")
        .eq("id", input.clinical_staff_id)
        .single();
      if (staffError) throw staffError;

      const { error } = await supabase.from("provider_restrictions").insert({
        ...input,
        organisation_id: staff.organisation_id,
        imposed_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: RESTRICTIONS_KEY });
    },
  });
}

/** Lift a restriction — always through public.lift_provider_restriction(),
 * never a direct UPDATE (there is no UPDATE RLS policy on this table at
 * all; the RPC is the only legal path, requires a reason, and writes its
 * own audit_log entry). */
export function useLiftProviderRestriction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("lift_provider_restriction", {
        p_restriction_id: id,
        p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: RESTRICTIONS_KEY });
    },
  });
}
