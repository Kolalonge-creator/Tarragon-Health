import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

/**
 * Wellness gamification (points, badges, challenges, classes). An engagement
 * layer, free to every patient regardless of plan — points reward logging
 * habits and never duplicate the real reward vouchers prevention_reward already
 * pays for screening/vaccination/health-check events (see
 * 20260730120000_wellness_points_and_badges.sql). Redemption converts points
 * into a real reward voucher via the redeem_wellness_points RPC.
 */

export type WellnessPointsBalance = Tables<"wellness_points_balances">;
export type WellnessPointsLedgerEntry = Tables<"wellness_points_ledger">;
export type WellnessBadge = Tables<"wellness_badges">;
export type PatientWellnessBadge = Tables<"patient_wellness_badges"> & {
  wellness_badges: WellnessBadge | null;
};
export type WellnessChallenge = Tables<"wellness_challenges">;
export type ChallengeEnrolment = Tables<"patient_challenge_enrolments"> & {
  wellness_challenges: WellnessChallenge | null;
};
export type WellnessClassProvider = Tables<"wellness_class_providers">;
export type WellnessClass = Tables<"wellness_classes"> & {
  wellness_class_providers: WellnessClassProvider | null;
};
export type WellnessClassRegistration = Tables<"wellness_class_registrations"> & {
  wellness_classes: WellnessClass | null;
};

const pointsBalanceKey = (patientId: string) => ["wellness-points-balance", patientId] as const;
const pointsLedgerKey = (patientId: string) => ["wellness-points-ledger", patientId] as const;
const myBadgesKey = (patientId: string) => ["wellness-my-badges", patientId] as const;
const badgesCatalogueKey = ["wellness-badges-catalogue"] as const;
const challengesCatalogueKey = ["wellness-challenges-catalogue"] as const;
const myEnrolmentsKey = (patientId: string) => ["wellness-my-challenge-enrolments", patientId] as const;
const upcomingClassesKey = ["wellness-upcoming-classes"] as const;
const myRegistrationsKey = (patientId: string) => ["wellness-my-class-registrations", patientId] as const;

// ---------------------------------------------------------------------------
// Points
// ---------------------------------------------------------------------------

/** Zero balance (not yet earned anything) shows as null — the row is only
 * created on the first award. Points are awarded by DB triggers on OTHER
 * mutations (a vitals log, a lesson completed, …) that this hook has no
 * direct relationship to invalidate against, so it polls — same pattern as
 * the notification bell. */
export function useWellnessPointsBalance(patientId: string) {
  return useQuery({
    queryKey: pointsBalanceKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("wellness_points_balances")
        .select("*")
        .eq("patient_id", patientId)
        .maybeSingle();
      if (error) throw error;
      return data as WellnessPointsBalance | null;
    },
    enabled: !!patientId,
    refetchInterval: 60_000,
  });
}

export function useWellnessPointsLedger(patientId: string, limit = 20) {
  return useQuery({
    queryKey: pointsLedgerKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("wellness_points_ledger")
        .select("*")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as WellnessPointsLedgerEntry[];
    },
    enabled: !!patientId,
    refetchInterval: 60_000,
  });
}

export function useRedeemWellnessPoints(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (points: number) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("redeem_wellness_points", { p_points: points });
      if (error) throw error;
      const result = data as { ok: boolean; error?: string; balance?: number; kobo_credited?: number };
      if (!result.ok) throw new Error(result.error ?? "Could not redeem points.");
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pointsBalanceKey(patientId) });
      queryClient.invalidateQueries({ queryKey: pointsLedgerKey(patientId) });
      queryClient.invalidateQueries({ queryKey: ["care-vouchers", patientId] });
    },
  });
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export function useWellnessBadgesCatalogue() {
  return useQuery({
    queryKey: badgesCatalogueKey,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("wellness_badges")
        .select("*")
        .eq("is_active", true)
        .order("criteria_threshold", { ascending: true });
      if (error) throw error;
      return (data ?? []) as WellnessBadge[];
    },
  });
}

export function useMyWellnessBadges(patientId: string) {
  return useQuery({
    queryKey: myBadgesKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_wellness_badges")
        .select("*, wellness_badges(*)")
        .eq("patient_id", patientId)
        .order("awarded_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PatientWellnessBadge[];
    },
    enabled: !!patientId,
    refetchInterval: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

export function useWellnessChallengesCatalogue() {
  return useQuery({
    queryKey: challengesCatalogueKey,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("wellness_challenges")
        .select("*")
        .eq("is_active", true)
        .order("duration_days", { ascending: true });
      if (error) throw error;
      return (data ?? []) as WellnessChallenge[];
    },
  });
}

export function useMyChallengeEnrolments(patientId: string) {
  return useQuery({
    queryKey: myEnrolmentsKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_challenge_enrolments")
        .select("*, wellness_challenges(*)")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ChallengeEnrolment[];
    },
    enabled: !!patientId,
  });
}

export function useEnrolInWellnessChallenge(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (challengeId: string) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("enrol_in_wellness_challenge", {
        p_challenge_id: challengeId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: myEnrolmentsKey(patientId) });
    },
  });
}

export function useWellnessChallengeProgress(enrolmentId: string | null) {
  return useQuery({
    queryKey: ["wellness-challenge-progress", enrolmentId] as const,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("wellness_challenge_progress", {
        p_enrolment_id: enrolmentId as string,
      });
      if (error) throw error;
      return data as { progress: number; target: number };
    },
    enabled: !!enrolmentId,
  });
}

// ---------------------------------------------------------------------------
// Workout classes & health workshops (dormant until a real partner is active)
// ---------------------------------------------------------------------------

export function useUpcomingWellnessClasses() {
  return useQuery({
    queryKey: upcomingClassesKey,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("wellness_classes")
        .select("*, wellness_class_providers!inner(*)")
        .eq("is_active", true)
        .eq("wellness_class_providers.is_active", true)
        .gt("starts_at", new Date().toISOString())
        .order("starts_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as WellnessClass[];
    },
  });
}

export function useMyClassRegistrations(patientId: string) {
  return useQuery({
    queryKey: myRegistrationsKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("wellness_class_registrations")
        .select("*, wellness_classes(*)")
        .eq("patient_id", patientId)
        .order("registered_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as WellnessClassRegistration[];
    },
    enabled: !!patientId,
  });
}

export function useRegisterForWellnessClass(patientId: string, organisationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (classId: string) => {
      const supabase = createClient();
      const { error } = await supabase.from("wellness_class_registrations").insert({
        patient_id: patientId,
        organisation_id: organisationId,
        class_id: classId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: myRegistrationsKey(patientId) });
    },
  });
}

/** Patient self-reports attendance after the fact — same trust level already
 * given to lifestyle telemetry; the points award is not a clinical claim. */
export function useMarkWellnessClassAttended(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (registrationId: string) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("wellness_class_registrations")
        .update({ status: "attended" })
        .eq("id", registrationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: myRegistrationsKey(patientId) });
      queryClient.invalidateQueries({ queryKey: pointsBalanceKey(patientId) });
      queryClient.invalidateQueries({ queryKey: pointsLedgerKey(patientId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Admin catalogue management
// ---------------------------------------------------------------------------

const adminBadgesKey = ["wellness-admin-badges"] as const;
const adminChallengesKey = ["wellness-admin-challenges"] as const;
const adminProvidersKey = ["wellness-admin-class-providers"] as const;
const adminClassesKey = ["wellness-admin-classes"] as const;
const pointsConfigKey = ["wellness-points-config"] as const;

export function useAdminWellnessBadges() {
  return useQuery({
    queryKey: adminBadgesKey,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("wellness_badges")
        .select("*")
        .order("criteria_threshold", { ascending: true });
      if (error) throw error;
      return (data ?? []) as WellnessBadge[];
    },
  });
}

export function useSetWellnessBadgeActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("wellness_badges")
        .update({ is_active: isActive })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminBadgesKey });
      queryClient.invalidateQueries({ queryKey: badgesCatalogueKey });
    },
  });
}

export function useAdminWellnessChallenges() {
  return useQuery({
    queryKey: adminChallengesKey,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("wellness_challenges")
        .select("*")
        .order("duration_days", { ascending: true });
      if (error) throw error;
      return (data ?? []) as WellnessChallenge[];
    },
  });
}

export function useSetWellnessChallengeActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("wellness_challenges")
        .update({ is_active: isActive })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminChallengesKey });
      queryClient.invalidateQueries({ queryKey: challengesCatalogueKey });
    },
  });
}

export function useAdminWellnessClassProviders() {
  return useQuery({
    queryKey: adminProvidersKey,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("wellness_class_providers")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as WellnessClassProvider[];
    },
  });
}

export function useSetWellnessClassProviderActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("wellness_class_providers")
        .update({ is_active: isActive })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminProvidersKey });
      queryClient.invalidateQueries({ queryKey: upcomingClassesKey });
    },
  });
}

export function useAdminWellnessClasses() {
  return useQuery({
    queryKey: adminClassesKey,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("wellness_classes")
        .select("*, wellness_class_providers(*)")
        .order("starts_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as WellnessClass[];
    },
  });
}

export function useSetWellnessClassActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("wellness_classes")
        .update({ is_active: isActive })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminClassesKey });
      queryClient.invalidateQueries({ queryKey: upcomingClassesKey });
    },
  });
}

export function useWellnessPointsConfig() {
  return useQuery({
    queryKey: pointsConfigKey,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("wellness_points_config")
        .select("*")
        .eq("id", true)
        .single();
      if (error) throw error;
      return data as Tables<"wellness_points_config">;
    },
  });
}

export function useSetWellnessPointsRate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (rate: number) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("wellness_points_config")
        .update({ points_to_kobo_rate: rate })
        .eq("id", true);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pointsConfigKey });
    },
  });
}
