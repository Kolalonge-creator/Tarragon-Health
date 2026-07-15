import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { ReferralUrgency, Tables } from "@tarragon/shared";

export type SpecialistReferralWithDetails = Tables<"specialist_referrals"> & {
  patient: { full_name: string | null } | null;
  specialist_provider: { name: string; consultation_fee_kobo: number } | null;
};

const REFERRAL_SELECT =
  "*, patient:profiles!specialist_referrals_patient_id_fkey(full_name), specialist_provider:specialist_providers!specialist_referrals_specialist_provider_id_fkey(name, consultation_fee_kobo)";

/** All specialist referrals in the caller's org, newest first — clinician worklist. RLS (private.is_org_staff) does the org-scoping. */
export function useOrgSpecialistReferrals() {
  return useQuery({
    queryKey: ["specialist-referrals", "org"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("specialist_referrals")
        .select(REFERRAL_SELECT)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as SpecialistReferralWithDetails[];
    },
  });
}

/** A single referral by id — the doctor-side referral detail page (urgency + clinical summary). */
export function useSpecialistReferral(referralId: string) {
  return useQuery({
    queryKey: ["specialist-referrals", "detail", referralId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("specialist_referrals")
        .select(REFERRAL_SELECT)
        .eq("id", referralId)
        .maybeSingle();
      if (error) throw error;
      return data as SpecialistReferralWithDetails | null;
    },
    enabled: !!referralId,
  });
}

export type SpecialistProvider = Tables<"specialist_providers">;

/** Active specialist_providers matching a specialist_type — populates the worklist's assignment picker. */
export function useSpecialistProvidersByType(specialistType: Tables<"specialist_referrals">["specialist_type"] | null) {
  return useQuery({
    queryKey: ["specialist-providers", specialistType ?? "none"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("specialist_providers")
        .select("*")
        .eq("specialist_type", specialistType!)
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return data as SpecialistProvider[];
    },
    enabled: !!specialistType,
  });
}

/**
 * Assigns a specialist_providers row to a referral and locks in its fee at
 * assignment time (so a later catalogue price change never retroactively
 * changes what this patient owes). Checks the referral's org for an active
 * capitation contract right here: capitated orgs skip straight to
 * payment_confirmed (a small inline duplicate of Build 1's capitated
 * branch — initiateBookingCheckout's own capitated branch is meant for the
 * patient's own checkout call, not a clinician mutation with no browser to
 * redirect); non-capitated referrals just move to pending_payment and wait
 * for the patient's own payment action, the only place that runs
 * initiateBookingCheckout for this referral.
 */
export function useAssignSpecialistProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      referralId,
      organisationId,
      specialistProviderId,
      feeKobo,
    }: {
      referralId: string;
      organisationId: string;
      specialistProviderId: string;
      feeKobo: number;
    }) => {
      const supabase = createClient();

      const { data: capitationContract } = await supabase
        .from("outcomes_contracts")
        .select("id")
        .eq("organisation_id", organisationId)
        .eq("contract_type", "capitation")
        .lte("effective_from", new Date().toISOString().slice(0, 10))
        .order("effective_from", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { error } = await supabase
        .from("specialist_referrals")
        .update({
          specialist_provider_id: specialistProviderId,
          referral_fee_kobo: feeKobo,
          ...(capitationContract
            ? { status: "payment_confirmed" as const, origin: "capitated" as const }
            : { status: "pending_payment" as const }),
        })
        .eq("id", referralId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["specialist-referrals"] });
    },
  });
}

/** Org-staff sets the confirmed appointment slot once payment has cleared. */
export function useSetReferralAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ referralId, appointmentDate }: { referralId: string; appointmentDate: string }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("specialist_referrals")
        .update({
          appointment_date: appointmentDate,
          booking_confirmed_at: new Date().toISOString(),
          status: "booked",
        })
        .eq("id", referralId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["specialist-referrals"] });
    },
  });
}

/**
 * Sets a referral's urgency (routine/priority/urgent), recording who set it.
 * Per docs/Tarragon_Health_Master_Operating_Plan_v4.md §7 Level 4 this is a
 * Tier 4/Senior Registrar decision — enforced here only by UI placement
 * (this control lives on the /doctor referral detail page, not /clinician),
 * not yet a DB-level tier gate. A fast-follow
 * private.has_referral_urgency_authority(org) (mirroring
 * private.has_prescribing_authority) is the natural next step once that
 * needs to be a hard guarantee rather than a route-level convention.
 */
export function useSetReferralUrgency() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ referralId, urgency }: { referralId: string; urgency: ReferralUrgency }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { error } = await supabase
        .from("specialist_referrals")
        .update({ urgency, set_by: user.id })
        .eq("id", referralId);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["specialist-referrals"] });
      queryClient.invalidateQueries({ queryKey: ["specialist-referrals", "detail", variables.referralId] });
    },
  });
}

/** Marks a booked referral's visit as done or cancelled — closes the worklist loop. */
export function useCloseReferral() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ referralId, status }: { referralId: string; status: "completed" | "declined" }) => {
      const supabase = createClient();
      const { error } = await supabase.from("specialist_referrals").update({ status }).eq("id", referralId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["specialist-referrals"] });
    },
  });
}
