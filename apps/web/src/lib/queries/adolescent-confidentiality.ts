import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

const QUERY_KEY = ["adolescent-confidentiality-waivers", "sexual_reproductive_health"];

/**
 * Patient-controlled sharing of sexual & reproductive health information
 * with a specific parent/guardian (spec §49.4/§49.8, §49.13's "increasing
 * autonomy"). Only wired to the sexual_reproductive_health domain today —
 * see supabase/migrations/20260829133850_adolescent_confidentiality_
 * waivers.sql's header for why mental_health/substance_use exist in the
 * domain check but have no reading table yet.
 *
 * Deliberately separate from useMyCareFollowers/useSetClinicalAccess
 * (lib/queries/care-access.ts) — that toggle is a blanket "see six clinical
 * tables" switch; this is a narrow, single-domain choice the record owner
 * makes for themselves, never available while "acting for" someone else
 * (the RLS insert policy requires patient_id = auth.uid(), and acting-for
 * never changes auth.uid() — see lib/acting/acting-for.ts).
 */
export interface SexualHealthGrantee {
  profileId: string;
  fullName: string | null;
  /** Non-null when currently shared — pass to useRevokeSexualHealthSharing. */
  waiverId: string | null;
  grantedAt: string | null;
}

export function useSexualHealthSharing() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<SexualHealthGrantee[]> => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const [{ data: grantees, error: granteesError }, { data: waivers, error: waiversError }] =
        await Promise.all([
          supabase
            .from("profile_access")
            .select("grantee:profiles!profile_access_grantee_user_id_fkey(id, full_name)")
            .eq("profile_id", user.id),
          supabase
            .from("adolescent_confidentiality_waivers")
            .select("id, grantee_user_id, granted_at")
            .eq("patient_id", user.id)
            .eq("domain", "sexual_reproductive_health")
            .is("revoked_at", null),
        ]);
      if (granteesError) throw granteesError;
      if (waiversError) throw waiversError;

      const waiverByGrantee = new Map((waivers ?? []).map((w) => [w.grantee_user_id, w]));

      return (grantees ?? []).flatMap((row) => {
        if (!row.grantee) return [];
        const waiver = waiverByGrantee.get(row.grantee.id);
        return [
          {
            profileId: row.grantee.id,
            fullName: row.grantee.full_name,
            waiverId: waiver?.id ?? null,
            grantedAt: waiver?.granted_at ?? null,
          },
        ];
      });
    },
  });
}

export function useGrantSexualHealthSharing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (granteeUserId: string) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { data: profile } = await supabase
        .from("profiles")
        .select("organisation_id")
        .eq("id", user.id)
        .single();
      if (!profile?.organisation_id) throw new Error("No organisation on file");

      const { error } = await supabase.from("adolescent_confidentiality_waivers").insert({
        organisation_id: profile.organisation_id,
        patient_id: user.id,
        grantee_user_id: granteeUserId,
        domain: "sexual_reproductive_health",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

export function useRevokeSexualHealthSharing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (waiverId: string) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("adolescent_confidentiality_waivers")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", waiverId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}
