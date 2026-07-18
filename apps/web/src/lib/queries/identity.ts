import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type IdentityVerification = Tables<"identity_verifications">;

/** The caller's latest identity-verification request, if any. */
export function useLatestIdentityVerification(patientId: string) {
  return useQuery({
    queryKey: ["identity-verification", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("identity_verifications")
        .select("*")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as IdentityVerification | null;
    },
    enabled: !!patientId,
  });
}
