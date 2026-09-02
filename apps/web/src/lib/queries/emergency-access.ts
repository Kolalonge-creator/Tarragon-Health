import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export interface EmergencyGrantIRequested {
  id: string;
  profileId: string;
  reason: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface EmergencyGrantOnMyRecord {
  id: string;
  granteeUserId: string;
  granteeName: string | null;
  reason: string;
  grantedAt: string;
  expiresAt: string;
}

function isActive(g: { expiresAt: string; revokedAt: string | null }): boolean {
  return g.revokedAt === null && new Date(g.expiresAt) > new Date();
}

/**
 * Emergency access grants the caller holds as a GRANTEE (someone they already have
 * profile_access to). Used to show "already requested, active until X" instead of a bare
 * request button, and to power the revoke-my-own-request control.
 */
export function useMyRequestedEmergencyGrants(profileId: string) {
  return useQuery({
    queryKey: ["emergency-grants-requested", profileId],
    queryFn: async (): Promise<EmergencyGrantIRequested[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("emergency_access_grants")
        .select("id, profile_id, reason, expires_at, revoked_at")
        .eq("profile_id", profileId)
        .order("granted_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id,
        profileId: row.profile_id,
        reason: row.reason,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
      }));
    },
  });
}

export function useRequestEmergencyAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { profileId: string; reason: string }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { error } = await supabase.from("emergency_access_grants").insert({
        profile_id: input.profileId,
        grantee_user_id: user.id,
        reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["emergency-grants-requested", variables.profileId] });
    },
  });
}

/**
 * Emergency access grants held against the caller's OWN record (the caller is the person whose
 * health information it is). Owner-side: shown as a banner with a revoke control, because being
 * told "someone just got emergency access to your record" the moment it happens, not only via
 * audit log, is the point of this feature.
 */
export function useEmergencyGrantsOnMyRecord() {
  return useQuery({
    queryKey: ["emergency-grants-on-my-record"],
    queryFn: async (): Promise<EmergencyGrantOnMyRecord[]> => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { data, error } = await supabase
        .from("emergency_access_grants")
        .select(
          "id, grantee_user_id, reason, granted_at, expires_at, revoked_at, grantee:profiles!emergency_access_grants_grantee_user_id_fkey(full_name)",
        )
        .eq("profile_id", user.id)
        .is("revoked_at", null)
        .order("granted_at", { ascending: false });
      if (error) throw error;

      return (data ?? [])
        .map((row) => ({
          id: row.id,
          granteeUserId: row.grantee_user_id,
          granteeName: row.grantee?.full_name ?? null,
          reason: row.reason,
          grantedAt: row.granted_at,
          expiresAt: row.expires_at,
          revokedAt: row.revoked_at,
        }))
        .filter(isActive);
    },
  });
}

export function useRevokeEmergencyAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (grantId: string) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { error } = await supabase
        .from("emergency_access_grants")
        .update({ revoked_at: new Date().toISOString(), revoked_by: user.id })
        .eq("id", grantId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["emergency-grants-on-my-record"] });
      queryClient.invalidateQueries({ queryKey: ["emergency-grants-requested"] });
    },
  });
}
