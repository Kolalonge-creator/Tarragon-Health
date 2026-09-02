import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Json, ReferralSource, ReferralUrgency, Tables } from "@tarragon/shared";
import type { AppropriatenessFlag } from "@/lib/referrals/appropriateness-check";

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

/**
 * A patient's own referrals, newest first, for the clinician-side patient
 * record's Referrals tab. Drafts are excluded — a draft is a clinician's
 * own in-progress work, not yet a live episode; useOrgSpecialistReferrals
 * (the worklist) surfaces drafts to staff instead.
 */
export function usePatientSpecialistReferrals(patientId: string) {
  return useQuery({
    queryKey: ["specialist-referrals", "patient", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("specialist_referrals")
        .select(REFERRAL_SELECT)
        .eq("patient_id", patientId)
        .neq("status", "draft")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as SpecialistReferralWithDetails[];
    },
    enabled: !!patientId,
  });
}

export interface SpecialistProviderMatchFilters {
  specialistType: Tables<"specialist_referrals">["specialist_type"] | null;
  state?: string;
  city?: string;
  requireTelemedicine?: boolean;
  hmo?: string;
  /** Filters out providers whose consultation_fee_kobo exceeds this — a real column, just never exposed as a filter until now (docs/CLINICAL_NETWORK_SPEC.md §4.6 Phase 1 item 4). */
  maxFeeKobo?: number;
  /** Filters to providers whose languages[] contains this language — same "already a column, not yet a filter" gap. */
  language?: string;
}

/**
 * Active specialist_providers matching a specialist_type plus optional
 * state/telemedicine/HMO/price/language filters. This is filtering an
 * existing catalogue, not ranking it — see docs/CLINICAL_NETWORK_SPEC.md §3:
 * adding a price/language predicate is explicitly listed as safe to build
 * without a new founder ask, scoring/weighting is not, and this function
 * still does neither. Ordered so a same-state match sorts first, then
 * alphabetically; done client-side rather than a Postgres CASE ORDER BY
 * since the provider list is small (9 placeholder rows today) and this
 * keeps the query itself simple.
 *
 * Powers the patient-initiated find-a-specialist entry point
 * (find-a-specialist.tsx), which is read-only/informational — assigning a
 * specialist_provider to a live referral is a clinician action via the
 * reactivated set_referral_specialist_provider() RPC
 * (20260828233653_activate_partner_specialist_booking.sql), not this hook.
 * The prior clinician-side picker (choose-referral-specialist.tsx) and its
 * useAssignSpecialistProvider mutation were removed as dead code by the
 * Referral Management Engine build (#338) — that mutation wrote
 * specialist_provider_id/referral_fee_kobo directly without ever setting
 * fulfilment='partner', so the self-arranged-fulfilment trigger rejected
 * every call. A future clinician-side assignment UI should call
 * set_referral_specialist_provider() (which sets fulfilment correctly)
 * rather than resurrecting that raw-update pattern.
 */
export function useMatchedSpecialistProviders(filters: SpecialistProviderMatchFilters) {
  const { specialistType, state, city, requireTelemedicine, hmo, maxFeeKobo, language } = filters;
  return useQuery({
    queryKey: [
      "specialist-providers",
      specialistType ?? "none",
      state ?? "",
      city ?? "",
      requireTelemedicine ?? false,
      hmo ?? "",
      maxFeeKobo ?? "",
      language ?? "",
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
      if (typeof maxFeeKobo === "number") {
        query = query.lte("consultation_fee_kobo", maxFeeKobo);
      }
      if (language) {
        query = query.contains("languages", [language]);
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

export type SpecialistProvider = Tables<"specialist_providers">;

/**
 * Creates a specialist referral (67.2/67.3/67.4). Self-arranged, like every
 * other referral on this platform since 2026-08-03: no specialist is named
 * and no fee is charged here — the DB defaults `fulfilment` to
 * 'self_arranged' and a trigger blocks either from being set. Who may call
 * this at all is enforced server-side by
 * private.enforce_specialist_referral_create (clinical tier only, Care
 * Coordinator excluded) — its raised message surfaces directly as
 * error.message on failure, so no separate client-side pre-check is done
 * here.
 *
 * asDraft leaves status='draft' (67.4 stage 1) — not yet a live episode, not
 * shown to the patient, not swept by the stall-escalation job. Submitting
 * later (useSubmitDraftReferral) is what actually starts the clock.
 */
export function useCreateReferral() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      patientId,
      organisationId,
      specialistType,
      referralSource,
      urgency,
      referralReason,
      requestedService,
      appropriatenessFlags,
      asDraft,
    }: {
      patientId: string;
      organisationId: string;
      specialistType: Tables<"specialist_referrals">["specialist_type"];
      referralSource: ReferralSource;
      urgency: ReferralUrgency | null;
      referralReason: string;
      requestedService: string;
      appropriatenessFlags: AppropriatenessFlag[];
      asDraft: boolean;
    }) => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("specialist_referrals")
        .insert({
          // Re-derived and overwritten server-side from the patient's own
          // profile by the create-gate trigger regardless of what's sent —
          // passed here for clarity, never trusted as the source of truth.
          organisation_id: organisationId,
          patient_id: patientId,
          specialist_type: specialistType,
          referral_source: referralSource,
          urgency,
          referral_reason: referralReason.trim() || null,
          requested_service: requestedService.trim() || null,
          appropriateness_flags: appropriatenessFlags as unknown as Json,
          status: asDraft ? "draft" : "pending",
        })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["specialist-referrals", "patient", variables.patientId] });
      queryClient.invalidateQueries({ queryKey: ["specialist-referrals", "org"] });
    },
  });
}

/** Submits a draft referral (67.4 Draft -> Submitted) — server-stamps submitted_at. */
export function useSubmitDraftReferral() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (referralId: string) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("specialist_referrals")
        .update({ status: "pending" })
        .eq("id", referralId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["specialist-referrals"] });
    },
  });
}

/**
 * Sets a referral's urgency (routine/priority/urgent/emergency), recording
 * who set it. Per docs/Tarragon_Health_Master_Operating_Plan_v4.md §7 Level
 * 4 this is a Tier 4/Senior Registrar decision — enforced here only by UI
 * placement (this control lives on the /doctor referral detail page, not
 * /clinician), not yet a DB-level tier gate. A fast-follow
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
 * "Treatment plan received" pipeline stage. Must happen before
 * useCompleteReferral: the specialist_referrals_completed_requires_report
 * CHECK constraint requires treatment_plan_received_at to already be set
 * before status can become 'completed'.
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
 * Waitlists a referral, recording the required interim management plan —
 * not gated on provider availability any more (every referral is
 * self-arranged, so there is never a Tarragon-side provider to be available
 * or not): this is now a clinician's own call that the patient needs active
 * interim safety-netting while they arrange their own specialist visit.
 * specialist_referrals_waitlist_requires_plan (DB CHECK) still requires a
 * non-empty plan.
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

/** Waitlisted referrals in the caller's org, oldest first, each with its documented interim plan. */
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
      return data as SpecialistReferralWithDetails[];
    },
  });
}

/**
 * Declines a referral — 67.12 requires a reason whenever a referral is
 * rejected. Enforced at the DB level by
 * specialist_referrals_declined_requires_reason.
 */
export function useDeclineReferral() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ referralId, declinedReason }: { referralId: string; declinedReason: string }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("specialist_referrals")
        .update({ status: "declined", declined_reason: declinedReason })
        .eq("id", referralId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["specialist-referrals"] });
    },
  });
}

/**
 * Closes a referral (67.15) — "a referral should not close simply because
 * an appointment was booked." Requires the specialist's report to already
 * be on file (useRecordTreatmentPlanReceived) and takes the care-plan
 * update note in the same call; specialist_referrals_closed_requires_outcome
 * (20260828231947) blocks status='closed' unless closed_at/closed_by (both
 * server-stamped by its own trigger), a non-empty care_plan_update_note,
 * and either treatment_plan_received_at or outcome_document_path are all
 * present. That same trigger also requires the caller be clinical tier.
 */
export function useCloseReferral() {
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["specialist-referrals"] });
    },
  });
}
