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
  city?: string;
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
  const { specialistType, state, city, requireTelemedicine, hmo } = filters;
  return useQuery({
    queryKey: [
      "specialist-providers",
      specialistType ?? "none",
      state ?? "",
      city ?? "",
      requireTelemedicine ?? false,
      hmo ?? "",
    ],
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
      // Locality score: same state+city best (0), same state only next (1),
      // elsewhere last (2) — city refines within a state, per the location model.
      const score = (p: SpecialistProvider) => {
        if (p.state !== state) return 2;
        return city && p.city === city ? 0 : 1;
      };
      return [...providers].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
    },
    enabled: !!specialistType,
  });
}

/**
 * Assigns a specialist_providers row to a referral and locks in its fee at
 * assignment time (so a later catalogue price change never retroactively
 * changes what this patient owes). The referral then waits at
 * pending_payment for the patient's own payment action, the only place that
 * runs initiateBookingCheckout for this referral.
 *
 * Until 2026-07-29 this also checked the org for an active capitation
 * contract and confirmed such referrals without payment. Capitation is gone
 * (I8), so there is one path.
 */
export function useAssignSpecialistProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      referralId,
      specialistProviderId,
      feeKobo,
    }: {
      referralId: string;
      specialistProviderId: string;
      feeKobo: number;
    }) => {
      const supabase = createClient();

      const { error } = await supabase
        .from("specialist_referrals")
        .update({
          specialist_provider_id: specialistProviderId,
          referral_fee_kobo: feeKobo,
          status: "pending_payment" as const,
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

/**
 * Closes a referral's episode once the specialist's outcome is on file
 * (transcribed treatment plan or an uploaded document) — task spec §11.15.
 * The DB does the real enforcement: private.
 * enforce_specialist_referral_outcome_and_closure requires an active
 * clinical-tier session and stamps closed_by/closed_at from it (never
 * client-supplied), and specialist_referrals_closed_requires_outcome
 * refuses the write outright without both an outcome and this note. A
 * non-clinical or out-of-tier caller gets that exception back as a plain
 * error message here.
 */
export function useCloseReferralWithCarePlanUpdate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ referralId, carePlanUpdateNote }: { referralId: string; carePlanUpdateNote: string }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("specialist_referrals")
        .update({ status: "closed", care_plan_update_note: carePlanUpdateNote })
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
 * Clinician-initiated referral creation (task spec §11.3/§11.4/§11.6) — the
 * gap confirmed before writing this: the ONLY existing insert path was the
 * abnormal-result-handler Edge Function. Mirrors useOrderLabTest's trust
 * model exactly: referred_by is resolved from the caller's OWN active
 * clinical_staff row, never trusted from a form field, and the insert only
 * succeeds if RLS (private.is_org_staff) admits the caller. Self-arranged:
 * this never assigns a specialist_provider or takes a fee — a letter is
 * generated and the patient takes it to whichever specialist they choose,
 * same as every other referral in this codebase since 2026-08-03.
 */
export function useCreateSpecialistReferral() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      organisationId,
      patientId,
      specialistType,
      clinicalQuestion,
      urgency,
      preferredConsultationType,
      preferredLocation,
      parentReferralId,
    }: {
      organisationId: string;
      patientId: string;
      specialistType: Tables<"specialist_referrals">["specialist_type"];
      clinicalQuestion: string;
      urgency?: ReferralUrgency;
      preferredConsultationType?: "telemedicine" | "in_person" | "either";
      preferredLocation?: string;
      parentReferralId?: string;
    }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { data: staff, error: staffError } = await supabase
        .from("clinical_staff")
        .select("id")
        .eq("profile_id", user.id)
        .eq("organisation_id", organisationId)
        .eq("active", true)
        .maybeSingle();
      if (staffError) throw staffError;
      if (!staff) {
        throw new Error("You must be an active clinical_staff member of this organisation to create a referral");
      }

      const { data, error } = await supabase
        .from("specialist_referrals")
        .insert({
          organisation_id: organisationId,
          patient_id: patientId,
          specialist_type: specialistType,
          referral_reason: clinicalQuestion,
          urgency: urgency ?? null,
          set_by: urgency ? user.id : null,
          referred_by: staff.id,
          preferred_consultation_type: preferredConsultationType ?? null,
          preferred_location: preferredLocation ?? null,
          parent_referral_id: parentReferralId ?? null,
          // No third booking_origin value exists yet for "a clinician decided
          // to refer" — clinically_triggered already covers "not the patient's
          // own request," which is accurate here too (the abnormal-result
          // pipeline is the automated case of the same origin).
          origin: "clinically_triggered",
        })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["specialist-referrals"] });
    },
  });
}
