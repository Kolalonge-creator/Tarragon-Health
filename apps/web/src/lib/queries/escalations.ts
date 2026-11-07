import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { compareByAlert } from "@/lib/worklist/priority";
import { generateCaseBriefAction } from "@/lib/case-briefs/actions";
import { handleIfPermissionDenied } from "@/lib/audit/log-denied-action";
import type { Database, EscalationLevel, ScreeningResultStatus, Tables } from "@tarragon/shared";
import { ACTIVE_ESCALATION_STATUSES, type WorkingEscalationStatus } from "@tarragon/shared";

export type EscalationWithDetails = Tables<"escalations"> & {
  patient: { full_name: string | null; is_test: boolean } | null;
  clinician_alert:
    | {
        id: string;
        title: string;
        level: EscalationLevel;
        override_level: EscalationLevel | null;
        override_reason: string | null;
        overridden_at: string | null;
        overridden_by_staff: { full_name: string } | null;
        sla_due_at: string | null;
        screening_result: { result_status: ScreeningResultStatus } | null;
        responsible_clinician: { full_name: string } | null;
        backup_clinician: { full_name: string } | null;
      }
    | null;
  assigned_doctor: { full_name: string | null } | null;
};

const ESCALATION_SELECT =
  "*, patient:profiles!escalations_patient_id_fkey(full_name, is_test), clinician_alert:clinician_alerts!escalations_clinician_alert_id_fkey(id, title, level, override_level, override_reason, overridden_at, overridden_by_staff:clinical_staff!clinician_alerts_overridden_by_fkey(full_name), sla_due_at, screening_result:screening_results!clinician_alerts_screening_result_id_fkey(result_status), responsible_clinician:clinical_staff!clinician_alerts_responsible_clinician_id_fkey(full_name), backup_clinician:clinical_staff!clinician_alerts_backup_clinician_id_fkey(full_name)), assigned_doctor:profiles!escalations_assigned_doctor_id_fkey(full_name)";

/**
 * Open/under-review escalations — doctor worklist (unclaimed or claimed by
 * anyone). Fetched oldest-first, then re-ranked by effective severity
 * (clinician_alert.override_level ?? level) and SLA breach so a doctor's
 * limited minutes hit the highest-value case first — same
 * compareAlerts/effectiveAlertLevel discipline as the clinician worklist
 * (lib/worklist/priority.ts). Array.sort is stable, so escalations tied on
 * severity+SLA keep the oldest-first order they were fetched in.
 *
 * Extracted from the hook body so a one-off caller (the resolve flow's
 * "next case" redirect) can fetch the same ranked list without subscribing
 * to it as a live query.
 */
export async function fetchDoctorEscalations(): Promise<EscalationWithDetails[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("escalations")
    .select(ESCALATION_SELECT)
    .in("status", [...ACTIVE_ESCALATION_STATUSES])
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as EscalationWithDetails[]).slice().sort(compareByAlert);
}

export function useDoctorEscalations() {
  return useQuery({
    queryKey: ["escalations", "doctor-worklist"],
    queryFn: fetchDoctorEscalations,
    refetchInterval: 60_000,
  });
}

/** Promotes a urgent/emergency clinician_alert into an unclaimed escalation. */
export function useEscalateAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      clinicianAlertId,
      patientId,
      organisationId,
      reason,
    }: {
      clinicianAlertId: string;
      patientId: string;
      organisationId: string;
      reason: string;
    }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { error } = await supabase.from("escalations").insert({
        organisation_id: organisationId,
        patient_id: patientId,
        clinician_alert_id: clinicianAlertId,
        status: "open",
        raised_by: user.id,
        assigned_doctor_id: null,
        reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["escalations"] });
    },
  });
}

/**
 * Raises a new escalation with no pre-existing clinician_alert — the path a
 * Care Coordinator (or any org staff) uses to hand a case to a doctor from
 * outside the automated alert pipeline, e.g. an outreach task that turns out
 * to need clinical judgment rather than logistics. clinician_alert_id stays
 * null, so the doctor worklist ranks it as routine severity with no SLA (see
 * rankOf in lib/worklist/priority.ts) — anything time-critical enough to be a
 * red flag already reaches doctors through the automated escalation
 * pipeline, not this manual path.
 */
export function useRaiseEscalation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      patientId,
      organisationId,
      reason,
    }: {
      patientId: string;
      organisationId: string;
      reason: string;
    }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { error } = await supabase.from("escalations").insert({
        organisation_id: organisationId,
        patient_id: patientId,
        clinician_alert_id: null,
        status: "open",
        raised_by: user.id,
        assigned_doctor_id: null,
        reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["escalations"] });
    },
  });
}

/**
 * Fallback path for the rare case private.auto_assign_escalation()
 * (20260831001458) couldn't route to anyone (e.g. a brand-new org with no
 * staff yet, or everyone inactive) — any qualifying-tier doctor may claim an
 * unassigned case for themselves. Every escalation raised through the normal
 * app paths (useEscalateAlert/useRaiseEscalation) is auto-assigned to a
 * specific doctor's queue at creation, so this mutation is deliberately
 * scoped to `assigned_doctor_id is null` only — it is not the everyday way
 * work gets picked up any more, see useStartEscalationReview for that.
 *
 * Gated by the same private.enforce_emergency_escalation_tier trigger as
 * useStartEscalationReview (a stale worklist showing an unassigned case that
 * someone else just claimed, or a tier that can't clear the emergency bar,
 * both surface here as 42501) -- durably logged via handleIfPermissionDenied
 * for the same reason its sibling is.
 */
export function useClaimEscalation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      escalationId,
      organisationId,
    }: {
      escalationId: string;
      organisationId: string;
    }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { data, error } = await supabase
        .from("escalations")
        .update({ assigned_doctor_id: user.id, status: "under_review" })
        .eq("id", escalationId)
        .eq("status", "open")
        .is("assigned_doctor_id", null)
        .select("clinician_alert_id")
        .maybeSingle();
      if (error) {
        handleIfPermissionDenied(error, {
          action: "escalations.claim_denied",
          entityType: "escalations",
          entityId: escalationId,
          organisationId,
          fallbackReason: "Escalation status-transition attempt rejected by the authority gate",
        });
        throw error;
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["escalations"] });
      // Fire-and-forget: the case brief is a nice-to-have read the doctor
      // will see once they open the case, not something the claim itself
      // should wait on or fail over. generateCaseBriefAction never throws
      // (fail-open, see lib/case-briefs/generate.ts) but this is claimed
      // from a client mutation, so guard here too rather than trust that.
      // Same brief the clinician worklist writes on acknowledge -- keyed to
      // the alert, not the escalation, so escalating an already-summarized
      // alert doesn't burn a second Claude call for nothing.
      if (data?.clinician_alert_id) {
        void generateCaseBriefAction(data.clinician_alert_id).catch(() => {});
      }
    },
  });
}

/**
 * The everyday way a doctor starts working the case already routed to them
 * by private.auto_assign_escalation() — sets status open -> under_review
 * only, leaves assigned_doctor_id untouched. Gated by the DB
 * (private.enforce_emergency_escalation_tier, 20260831001458) to the
 * assigned doctor or the Chief Medical Officer; this mutation only decides
 * whether to render the "Start review" control.
 *
 * A bystander (not the assigned doctor, not the CMO) who still attempts this
 * — e.g. a stale worklist that hasn't refreshed since the case was
 * reassigned — gets a 42501 from the trigger, which is durably logged via
 * logDeniedAction (see
 * supabase/migrations/20260918085308_wire_audit_reason_and_denied_action_logging.sql
 * for why that has to be a separate call, not something the trigger itself
 * can log). private.enforce_emergency_escalation_tier raises 42501 for more
 * than one reason (the bystander check here, but also re-resolving an
 * already-terminal case) — denialReasonFromError logs the trigger's own
 * message rather than a single hardcoded guess, so the audit trail names
 * whichever branch actually fired.
 */
export function useStartEscalationReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      escalationId,
      organisationId,
    }: {
      escalationId: string;
      organisationId: string;
    }) => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("escalations")
        .update({ status: "under_review" })
        .eq("id", escalationId)
        .eq("status", "open")
        .select("clinician_alert_id")
        .maybeSingle();
      if (error) {
        handleIfPermissionDenied(error, {
          action: "escalations.claim_denied",
          entityType: "escalations",
          entityId: escalationId,
          organisationId,
          fallbackReason: "Escalation status-transition attempt rejected by the authority gate",
        });
        throw error;
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["escalations"] });
      if (data?.clinician_alert_id) {
        void generateCaseBriefAction(data.clinician_alert_id).catch(() => {});
      }
    },
  });
}

/**
 * Reassigns an escalation to a chosen doctor — the Chief Medical Officer's
 * case-assignment authority (docs/CLAUDE.md's Clinical Tier Ladder), an
 * override on top of automatic routing rather than the everyday way work
 * gets assigned (see private.auto_assign_escalation, 20260831001458).
 * Resets status back to "open": the newly-assigned doctor starts their own
 * review explicitly (useStartEscalationReview) rather than being marked as
 * already reviewing something they haven't opened yet.
 *
 * Goes through the public.reassign_escalation() RPC rather than a bare
 * `.update()` (see 20260918085308_wire_audit_reason_and_denied_action_logging.sql)
 * so an optional caller-supplied `reason` ("rebalancing", "routing to a
 * specialist's expertise") lands on the resulting audit_log row — never
 * patient-identifying or clinical detail, see audit_log.reason's own column
 * comment. The RPC is SECURITY INVOKER and performs the exact same update;
 * setting assigned_doctor_id to someone OTHER than the caller is still gated
 * by the DB trigger to doctor_tier = 'chief_medical_officer', unchanged —
 * this mutation only decides whether to render the "Assign to…" control (see
 * canAssignCases in lib/clinical/doctor-tier.ts) and, on a 42501 from that
 * gate, durably logs the denial via logDeniedAction.
 */
export function useAssignEscalation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      escalationId,
      doctorProfileId,
      organisationId,
      reason,
    }: {
      escalationId: string;
      doctorProfileId: string;
      organisationId: string;
      reason?: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("reassign_escalation", {
        p_escalation_id: escalationId,
        p_doctor_profile_id: doctorProfileId,
        p_reason: reason || undefined,
      });
      if (error) {
        handleIfPermissionDenied(error, {
          action: "escalations.reassignment_denied",
          entityType: "escalations",
          entityId: escalationId,
          organisationId,
          fallbackReason: "Reassignment attempted without Chief Medical Officer authority",
        });
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["escalations"] });
    },
  });
}

export function useEscalationNotes(escalationId: string) {
  return useQuery({
    queryKey: ["escalation-notes", escalationId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("escalation_notes")
        .select("*, author:profiles!escalation_notes_author_id_fkey(full_name)")
        .eq("escalation_id", escalationId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as (Tables<"escalation_notes"> & {
        author: { full_name: string | null } | null;
      })[];
    },
    enabled: !!escalationId,
  });
}

/** Logs a call-note (with an optional next follow-up date) against an escalation. */
export function useAddEscalationNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      escalationId,
      organisationId,
      note,
      nextFollowUpAt,
    }: {
      escalationId: string;
      organisationId: string;
      note: string;
      nextFollowUpAt?: string;
    }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { error } = await supabase.from("escalation_notes").insert({
        organisation_id: organisationId,
        escalation_id: escalationId,
        author_id: user.id,
        note,
        next_follow_up_at: nextFollowUpAt ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["escalation-notes", variables.escalationId] });
    },
  });
}

/**
 * Resolves or refers an escalation, closing out the doctor's review.
 * Sets reviewed_by/reviewed_at here, once, to the reviewing doctor and now
 * — the only place these fields are ever written (CLINICAL_TRUST_MODEL_SPEC
 * §5: no retroactive attribution) — which is what lets ReviewedByDoctor
 * null-gate on them safely.
 */
export function useResolveEscalation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      escalationId,
      status,
      resolutionNote,
      identityConfirmed,
    }: {
      escalationId: string;
      status: "resolved" | "referred";
      resolutionNote: string;
      /** Wrong-patient prevention (§89.4) — the DB rejects a RESOLVE
       * transition without this (private.enforce_escalation_identity_confirm);
       * referring a case is unaffected. Server derives
       * identity_confirmed_by/at from auth.uid(), never client-supplied. */
      identityConfirmed: boolean;
    }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { error } = await supabase
        .from("escalations")
        .update({
          status,
          resolution_note: resolutionNote,
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
          identity_confirmed: identityConfirmed,
        })
        .eq("id", escalationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["escalations"] });
    },
  });
}

/**
 * DW-03: moves a case the doctor has started into a working state (awaiting information, patient contact required, monitoring),
 * or back to under review. private.enforce_escalation_state_rules is the real gate: only the assigned doctor or the CMO, a new
 * 10+ character note on every move into a working state, and a review-by date within 14 days for monitoring. The form checks the
 * same rules first (workingStateProblem) so the doctor sees the problem before saving.
 */
export function useMoveEscalationState() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      escalationId,
      organisationId,
      status,
      note,
      monitorUntil,
    }: {
      escalationId: string;
      organisationId: string;
      status: WorkingEscalationStatus | "under_review";
      note: string | null;
      monitorUntil: string | null;
    }) => {
      const supabase = createClient();
      const update =
        status === "under_review"
          ? { status }
          : { status, status_note: note, monitor_until: status === "monitoring" ? monitorUntil : null };
      const { data, error } = await supabase
        .from("escalations")
        .update(update)
        .eq("id", escalationId)
        .select("id")
        .maybeSingle();
      if (error) {
        handleIfPermissionDenied(error, {
          action: "escalations.state_move_denied",
          entityType: "escalations",
          entityId: escalationId,
          organisationId,
          fallbackReason: "Escalation working-state move rejected by the state rules",
        });
        throw error;
      }
      if (!data) throw new Error("This case could not be updated. It may have been closed or reassigned; refresh the page.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["escalations"] });
    },
  });
}

/**
 * DW-11: changes the review-by date of a case that is already monitoring. Same rules as entering monitoring, including a new note.
 */
export function useChangeMonitoringDate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ escalationId, note, monitorUntil }: { escalationId: string; note: string; monitorUntil: string }) => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("escalations")
        .update({ status_note: note, monitor_until: monitorUntil })
        .eq("id", escalationId)
        .eq("status", "monitoring")
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("This case is no longer monitoring; refresh the page.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["escalations"] });
    },
  });
}

export type EscalationContactAttempt = {
  id: string;
  outcome: string;
  note: string | null;
  attempted_at: string;
  attempted_by: string;
  attempted_by_name: string | null;
};

/** DW-13: attempts to reach the patient on this case, newest first. Read through the gated RPC; the table has no direct access. */
export function useEscalationContactAttempts(escalationId: string) {
  return useQuery({
    queryKey: ["escalation-contact-attempts", escalationId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("escalation_contact_attempts_for", { p_escalation_id: escalationId });
      if (error) throw error;
      return (data ?? []) as EscalationContactAttempt[];
    },
    enabled: !!escalationId,
  });
}

/** DW-13: the assigned doctor, the CMO or a care coordinator logs an attempt to reach the patient. Never changes the case. */
export function useLogContactAttempt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ escalationId, outcome, note }: { escalationId: string; outcome: string; note: string }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("log_escalation_contact_attempt", {
        p_escalation_id: escalationId,
        p_outcome: outcome,
        p_note: note.trim() || undefined,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["escalation-contact-attempts", variables.escalationId] });
    },
  });
}

/** G10: every handover on one case, newest first (who, why, what is outstanding, and the answer). */
export type EscalationHandover = Database["public"]["Functions"]["escalation_handovers_for"]["Returns"][number];

export function useEscalationHandovers(escalationId: string) {
  return useQuery({
    queryKey: ["escalation-handovers", escalationId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("escalation_handovers_for", { p_escalation_id: escalationId });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!escalationId,
  });
}

/** G10 (DW-16, DW-19): the assigned doctor or the CMO asks another doctor to take the case. Nothing moves until they accept. */
export function useRequestHandover() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { escalationId: string; toProfileId: string; reason: string; outstandingAction: string }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("request_escalation_handover", {
        p_escalation_id: input.escalationId,
        p_to_profile_id: input.toProfileId,
        p_reason: input.reason.trim(),
        p_outstanding_action: input.outstandingAction.trim(),
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["escalation-handovers", variables.escalationId] });
    },
  });
}

/**
 * G10 (DW-17, DW-18): the new doctor accepts (the case becomes theirs) or declines with a reason. Resolves to the handover's
 * status afterwards; "superseded" means the case closed or changed hands while it waited, and nothing moved.
 */
export function useRespondHandover() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { escalationId: string; handoverId: string; accept: boolean; declineReason?: string }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("respond_escalation_handover", {
        p_handover_id: input.handoverId,
        p_accept: input.accept,
        p_decline_reason: input.accept ? undefined : input.declineReason?.trim(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["escalation-handovers", variables.escalationId] });
      queryClient.invalidateQueries({ queryKey: ["escalations"] });
    },
  });
}

/** G10: whoever asked, the doctor handing over, or the CMO withdraws a waiting handover. */
export function useCancelHandover() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { escalationId: string; handoverId: string }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("cancel_escalation_handover", { p_handover_id: input.handoverId });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["escalation-handovers", variables.escalationId] });
    },
  });
}
