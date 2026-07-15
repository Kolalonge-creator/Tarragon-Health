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

export interface SpecialistProviderMatchFilters {
  specialistType: Tables<"specialist_referrals">["specialist_type"] | null;
  state?: string;
  requireTelemedicine?: boolean;
  hmo?: string;
}

/**
 * Active specialist_providers matching a specialist_type plus optional
 * state/telemedicine/HMO filters — populates the worklist's assignment
 * picker. Ordered so a same-state match sorts first, then alphabetically;
 * done client-side rather than a Postgres CASE ORDER BY since the provider
 * list is small (9 placeholder rows today) and this keeps the query itself
 * simple. Patients don't choose between matched options themselves in this
 * slice — the clinician still picks on their behalf, per
 * docs/Tarragon_Health_Master_Operating_Plan_v4.md §7 Level 5a's Phase 1
 * clinician-mediated model; patient choice is a flagged fast-follow.
 */
export function useMatchedSpecialistProviders(filters: SpecialistProviderMatchFilters) {
  const { specialistType, state, requireTelemedicine, hmo } = filters;
  return useQuery({
    queryKey: ["specialist-providers", specialistType ?? "none", state ?? "", requireTelemedicine ?? false, hmo ?? ""],
    queryFn: async () => {
      const supabase = createClient();
      let query = supabase
        .from("specialist_providers")
        .select("*")
        .eq("specialist_type", specialistType!)
        .eq("is_active", true);
      if (requireTelemedicine) {
        query = query.eq("supports_telemedicine", true);
      }
      if (hmo) {
        query = query.contains("accepted_hmos", [hmo]);
      }
      const { data, error } = await query.order("name", { ascending: true });
      if (error) throw error;
      const providers = data as SpecialistProvider[];
      if (!state) return providers;
      return [...providers].sort((a, b) => {
        const aMatch = a.state === state ? 0 : 1;
        const bMatch = b.state === state ? 0 : 1;
        return aMatch - bMatch || a.name.localeCompare(b.name);
      });
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

/**
 * Records that a specialist's treatment plan came back — manually
 * transcribed by org staff, since specialists have no platform login and
 * nothing they send arrives through the app directly. Powers the
 * "Treatment plan received" pipeline stage.
 */
export function useRecordTreatmentPlanReceived() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ referralId, note }: { referralId: string; note: string }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("specialist_referrals")
        .update({ treatment_plan_received_at: new Date().toISOString(), treatment_plan_note: note })
        .eq("id", referralId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["specialist-referrals"] });
    },
  });
}

/**
 * Marks shared-care handback: routine management responsibility has
 * returned to Tarragon's own care team (docs/Tarragon_Health_Master_Operating_Plan_v4.md
 * §7 Level 5c). Powers the final "Monitoring continues" pipeline stage.
 */
export function useRecordSharedCareHandback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (referralId: string) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("specialist_referrals")
        .update({ shared_care_handback_at: new Date().toISOString() })
        .eq("id", referralId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["specialist-referrals"] });
    },
  });
}

/**
 * Waitlists a referral when zero active providers match its filters,
 * recording the required interim management plan
 * (docs/Tarragon_Health_Master_Operating_Plan_v4.md §7: a doctor must
 * document an interim plan before waitlisting — enforced at the DB level
 * by the specialist_referrals_waitlist_requires_plan CHECK constraint,
 * this mutation would fail without a non-empty plan).
 */
export function useWaitlistReferral() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ referralId, interimManagementPlan }: { referralId: string; interimManagementPlan: string }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("specialist_referrals")
        .update({
          status: "waitlisted",
          interim_management_plan: interimManagementPlan,
          waitlisted_at: new Date().toISOString(),
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
 * Waitlisted referrals in the caller's org, each annotated with a live
 * count of currently-active matching providers — surfaced so staff can
 * manually re-trigger assignment once a provider becomes available.
 * Deliberately polling-based, not push-notified: no real-time
 * slot/cancellation system exists anywhere in this codebase (see the
 * migration comment on specialist_referrals_waitlist_columns), matching
 * the Weight Scale BLE gap's documented posture, not an oversight.
 */
export function useWaitlistedReferrals() {
  return useQuery({
    queryKey: ["specialist-referrals", "waitlisted"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("specialist_referrals")
        .select(REFERRAL_SELECT)
        .eq("status", "waitlisted")
        .order("waitlisted_at", { ascending: true });
      if (error) throw error;
      const referrals = data as SpecialistReferralWithDetails[];

      const results = await Promise.all(
        referrals.map(async (referral) => {
          const { count } = await supabase
            .from("specialist_providers")
            .select("id", { count: "exact", head: true })
            .eq("specialist_type", referral.specialist_type)
            .eq("is_active", true);
          return { referral, matchingProviderCount: count ?? 0 };
        })
      );
      return results;
    },
    refetchInterval: 60_000,
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
