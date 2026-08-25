import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type RotaShift = Tables<"clinician_rota_shifts">;
export type RotaChannel = "video" | "voice" | "both";

export type RotaShiftWithClinician = RotaShift & {
  clinician: {
    full_name: string;
    doctor_tier: Tables<"clinical_staff">["doctor_tier"];
  } | null;
};

export type OnCallClinician = {
  clinical_staff_id: string;
  full_name: string;
  photo_url: string | null;
  doctor_tier: Tables<"clinical_staff">["doctor_tier"];
};

export type EligibleRotaClinician = {
  id: string;
  full_name: string;
  doctor_tier: Tables<"clinical_staff">["doctor_tier"];
  is_clinical_director: boolean;
};

export const rotaKeys = {
  org: ["clinician-rota", "org"] as const,
  onCall: (channel: RotaChannel) => ["clinician-rota", "on-call", channel] as const,
  eligible: ["clinician-rota", "eligible-clinicians"] as const,
};

/**
 * Scheduling the on-call rota is an ops/authority action, not a plain staff
 * read — gated to an org admin or the Clinical Director, same split
 * CLAUDE.md documents for other scheduling/governance actions (e.g. only the
 * Clinical Director signs protocols). The RLS policy on
 * clinician_rota_shifts is deliberately broader (any org staff) — this is
 * the app-layer narrowing CLAUDE.md prescribes for that kind of gate rather
 * than a bespoke RLS helper.
 */
async function assertRotaSchedulingAuthority(): Promise<{ organisationId: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id, role")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    throw new Error("This account has no organisation on file");
  }
  if (profile.role === "admin") {
    return { organisationId: profile.organisation_id };
  }

  const { data: director } = await supabase
    .from("clinical_staff")
    .select("id")
    .eq("organisation_id", profile.organisation_id)
    .eq("profile_id", user.id)
    .eq("is_clinical_director", true)
    .eq("active", true)
    .maybeSingle();
  if (!director) {
    throw new Error("Only an org admin or the Clinical Director can manage the on-call rota");
  }
  return { organisationId: profile.organisation_id };
}

/** Every rota shift in the caller's org, soonest first — admin/ops view. */
export function useOrgRotaShifts() {
  return useQuery({
    queryKey: rotaKeys.org,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("clinician_rota_shifts")
        .select(
          "*, clinician:clinical_staff!clinician_rota_shifts_clinical_staff_id_fkey(full_name, doctor_tier)"
        )
        .order("starts_at", { ascending: true });
      if (error) throw error;
      return data as RotaShiftWithClinician[];
    },
  });
}

/** Active clinicians (any tier, or the Clinical Director) eligible for the
 * rota — a Care Coordinator is deliberately excluded, mirroring the DB
 * trigger that would reject one anyway. */
export function useEligibleRotaClinicians() {
  return useQuery({
    queryKey: rotaKeys.eligible,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("clinical_staff")
        .select("id, full_name, doctor_tier, is_clinical_director")
        .eq("active", true)
        .order("full_name", { ascending: true });
      if (error) throw error;
      return (data ?? []).filter(
        (s) =>
          s.is_clinical_director ||
          (s.doctor_tier !== null && s.doctor_tier !== "care_coordinator")
      ) as EligibleRotaClinician[];
    },
  });
}

/** Who's on call right now for a channel, in the caller's org. Refetches
 * every 5 minutes so a queue banner doesn't go stale mid-shift-change. */
export function useCurrentOnCall(channel: RotaChannel = "video") {
  return useQuery({
    queryKey: rotaKeys.onCall(channel),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("current_on_call_clinicians", {
        p_channel: channel,
      });
      if (error) throw error;
      return (data ?? []) as unknown as OnCallClinician[];
    },
    refetchInterval: 5 * 60_000,
  });
}

export function useCreateRotaShift() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      clinicalStaffId: string;
      channel: RotaChannel;
      startsAt: string;
      endsAt: string;
      notes?: string;
    }) => {
      const supabase = createClient();
      const { organisationId } = await assertRotaSchedulingAuthority();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { error } = await supabase.from("clinician_rota_shifts").insert({
        organisation_id: organisationId,
        clinical_staff_id: input.clinicalStaffId,
        channel: input.channel,
        starts_at: new Date(input.startsAt).toISOString(),
        ends_at: new Date(input.endsAt).toISOString(),
        notes: input.notes?.trim() || null,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rotaKeys.org });
      queryClient.invalidateQueries({ queryKey: ["clinician-rota", "on-call"] });
    },
  });
}

export function useDeleteRotaShift() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (shiftId: string) => {
      const supabase = createClient();
      await assertRotaSchedulingAuthority();
      const { error } = await supabase.from("clinician_rota_shifts").delete().eq("id", shiftId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rotaKeys.org });
      queryClient.invalidateQueries({ queryKey: ["clinician-rota", "on-call"] });
    },
  });
}
