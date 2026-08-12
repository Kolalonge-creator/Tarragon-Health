import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { compareByAlert } from "@/lib/worklist/priority";
import { generateCaseBriefAction } from "@/lib/case-briefs/actions";
import type { EscalationLevel, ScreeningResultStatus, Tables } from "@tarragon/shared";

export type EscalationWithDetails = Tables<"escalations"> & {
  patient: { full_name: string | null } | null;
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
      }
    | null;
  assigned_doctor: { full_name: string | null } | null;
};

const ESCALATION_SELECT =
  "*, patient:profiles!escalations_patient_id_fkey(full_name), clinician_alert:clinician_alerts!escalations_clinician_alert_id_fkey(id, title, level, override_level, override_reason, overridden_at, overridden_by_staff:clinical_staff!clinician_alerts_overridden_by_fkey(full_name), sla_due_at, screening_result:screening_results!clinician_alerts_screening_result_id_fkey(result_status)), assigned_doctor:profiles!escalations_assigned_doctor_id_fkey(full_name)";

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
    .in("status", ["open", "under_review"])
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

/** Claims an unclaimed escalation for the current doctor; no-ops if already claimed. */
export function useClaimEscalation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (escalationId: string) => {
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
        .select("clinician_alert_id")
        .maybeSingle();
      if (error) throw error;
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
    }: {
      escalationId: string;
      status: "resolved" | "referred";
      resolutionNote: string;
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
        })
        .eq("id", escalationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["escalations"] });
    },
  });
}
