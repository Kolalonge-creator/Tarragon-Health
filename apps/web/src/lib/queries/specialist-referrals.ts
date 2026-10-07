import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Json, ReferralSource, ReferralUrgency, Tables } from "@tarragon/shared";
import type { AppropriatenessFlag } from "@/lib/referrals/appropriateness-check";
import { ROUTINE_CHART_READ_REASON } from "@/lib/clinical/audited-chart";

export type SpecialistReferralWithDetails = Tables<"specialist_referrals"> & {
  patient: { full_name: string | null } | null;
  specialist_provider: { name: string; consultation_fee_kobo: number } | null;
};

/** A referral list or one referral from the audited functions. A refusal throws so it can never read as "no referrals". */
export function parseReferralList(data: unknown, key?: "referrals"): SpecialistReferralWithDetails[] {
  if (key) {
    const payload = data as { status?: string; referrals?: unknown } | null;
    if (!payload || payload.status !== "ok" || !Array.isArray(payload.referrals)) throw new Error("referrals denied");
    return payload.referrals as SpecialistReferralWithDetails[];
  }
  if (!Array.isArray(data)) throw new Error("unexpected referral list response");
  return data as SpecialistReferralWithDetails[];
}

export function parseReferral(data: unknown): SpecialistReferralWithDetails {
  const payload = data as { status?: string; referral?: unknown } | null;
  if (!payload || payload.status !== "ok" || !payload.referral) throw new Error("referral denied");
  return payload.referral as SpecialistReferralWithDetails;
}

/** The specialist referrals the caller may see (tied, creator, assigned, or the referral desk), newest first — clinician worklist. */
export function useOrgSpecialistReferrals() {
  return useQuery({
    queryKey: ["specialist-referrals", "org"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("list_referrals_audited");
      if (error) throw error;
      return parseReferralList(data);
    },
    // Every audited read writes an audit row: no refetch on focus.
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/** A single referral by id — the doctor-side referral detail page (urgency + clinical summary). */
export function useSpecialistReferral(referralId: string) {
  return useQuery({
    queryKey: ["specialist-referrals", "detail", referralId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_referral_audited", {
        p_referral: referralId,
        p_reason: ROUTINE_CHART_READ_REASON,
      });
      if (error) throw error;
      return parseReferral(data);
    },
    enabled: !!referralId,
    retry: false,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
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
      const { data, error } = await supabase.rpc("list_patient_referrals_audited", {
        p_patient: patientId,
        p_reason: ROUTINE_CHART_READ_REASON,
        p_include_drafts: false,
      });
      if (error) throw error;
      return parseReferralList(data, "referrals");
    },
    enabled: !!patientId,
    retry: false,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/**
 * A patient's referrals INCLUDING drafts, for the "Referral history" card on the clinician-side record (a draft is a clinician's own
 * in-progress work, so it belongs there). Through the audited read; a refusal throws.
 */
export function usePatientReferralsWithDrafts(patientId: string) {
  return useQuery({
    queryKey: ["specialist-referrals", "patient-with-drafts", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("list_patient_referrals_audited", {
        p_patient: patientId,
        p_reason: ROUTINE_CHART_READ_REASON,
        p_include_drafts: true,
      });
      if (error) throw error;
      return parseReferralList(data, "referrals");
    },
    enabled: !!patientId,
    retry: false,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
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
 * (find-a-specialist.tsx), which is read-only/informational, and the
 * clinician-side AssignSpecialistProviderForm on the referral detail page
 * (assigning a specialist_provider to a live referral is a clinician action
 * via the reactivated set_referral_specialist_provider() RPC — see
 * useAssignSpecialistProvider below).
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
      // public.specialist_directory, NOT specialist_providers. The table became
      // admin-and-partner-manager only on 2026-09-10 because its SELECT policy
      // was `using (true)`, handing every logged-in patient the commission
      // rates and the partner contact details. The view carries everything both
      // callers of this hook actually render, plus the licence fields, which
      // are deliberately patient-visible so a registration can be checked with
      // the regulator. Do not repoint this back at the table to fix an empty
      // list; add the column to the view instead.
      let query = supabase
        .from("specialist_directory")
        .select("*")
        // No .eq("is_active", true): the view already filters to active
        // providers and does not project the column.
        .eq("specialist_type", specialistType!);
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
      // Every column on a view is nullable to the generated types, so name is
      // coalesced rather than asserted.
      return [...providers].sort(
        (a, b) => score(a) - score(b) || (a.name ?? "").localeCompare(b.name ?? "")
      );
    },
    enabled: !!specialistType,
  });
}

/** The patient- and clinician-safe projection. Never the base table: see the
 * note in useMatchedSpecialistProviders. */
export type SpecialistProvider = Tables<"specialist_directory">;

/**
 * Assigns a real, active, speciality-matched specialist_providers row to a
 * pending/waitlisted referral — the partner-booking path (as opposed to the
 * self-arranged default every referral otherwise stays on). Routed through
 * public.set_referral_specialist_provider (RPC), not a raw `.update()` — a
 * plain update would violate specialist_referrals_enforce_fulfilment's
 * self_arranged guard, since every referral defaults to self_arranged and
 * only this RPC flips fulfilment to 'partner' as part of assigning. The RPC
 * re-validates the provider is genuinely active and speciality-matched
 * server-side and locks in the fee from the provider's own row — never a
 * client-supplied value. No scoring/ranking here or in the RPC — org staff
 * still pick manually from useMatchedSpecialistProviders' plain filtered
 * list, per the CLINICAL_NETWORK_SPEC.md §3 guardrail.
 */
export function useAssignSpecialistProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      referralId,
      specialistProviderId,
    }: {
      referralId: string;
      specialistProviderId: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("set_referral_specialist_provider", {
        p_referral_id: referralId,
        p_specialist_provider_id: specialistProviderId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["specialist-referrals"] });
    },
  });
}

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
      specialistType,
      referralSource,
      urgency,
      referralReason,
      requestedService,
      appropriatenessFlags,
      asDraft,
      patientConsentAt,
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
      /** S24: when the patient agreed to share their record. Required by the database for anything but a draft; null for a draft. */
      patientConsentAt: string | null;
    }) => {
      const supabase = createClient();
      // The organisation is derived from the patient on the server (input.organisationId is unused); the create-gate trigger still
      // requires a clinical-tier member, and the function requires the tie to the patient.
      const { data, error } = await supabase.rpc("create_specialist_referral", {
        p_patient: patientId,
        p_specialist_type: specialistType,
        p_referral_source: referralSource,
        p_urgency: urgency ?? undefined,
        p_reason: referralReason,
        p_requested_service: requestedService,
        p_flags: appropriatenessFlags as unknown as Json,
        p_as_draft: asDraft,
        p_patient_consent_at: asDraft ? undefined : (patientConsentAt ?? undefined),
      });
      if (error) throw error;
      return { id: data };
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
    mutationFn: async ({ referralId, patientConsentAt }: { referralId: string; patientConsentAt: string }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("submit_draft_referral", { p_referral: referralId, p_patient_consent_at: patientConsentAt });
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
      // set_by is stamped from the caller's own session inside the function.
      const { error } = await supabase.rpc("set_referral_urgency", { p_referral: referralId, p_urgency: urgency });
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
      const { error } = await supabase.rpc("record_referral_treatment_plan", { p_referral: referralId, p_note: note });
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
      const { error } = await supabase.rpc("record_referral_shared_care_handback", { p_referral: referralId });
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
      const { error } = await supabase.rpc("waitlist_referral", {
        p_referral: referralId,
        p_interim_management_plan: interimManagementPlan,
      });
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
      const { data, error } = await supabase.rpc("list_referrals_audited", { p_status: "waitlisted" });
      if (error) throw error;
      return parseReferralList(data);
    },
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
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
      const { error } = await supabase.rpc("decline_referral", { p_referral: referralId, p_declined_reason: declinedReason });
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
      const { error } = await supabase.rpc("close_referral", { p_referral: referralId, p_care_plan_update_note: carePlanUpdateNote });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["specialist-referrals"] });
    },
  });
}

