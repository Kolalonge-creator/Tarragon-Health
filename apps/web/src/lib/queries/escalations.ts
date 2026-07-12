import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { EscalationLevel, Tables } from "@tarragon/shared";

export type EscalationWithDetails = Tables<"escalations"> & {
  patient: { full_name: string | null } | null;
  clinician_alert: { title: string; level: EscalationLevel } | null;
  assigned_doctor: { full_name: string | null } | null;
};

const ESCALATION_SELECT =
  "*, patient:profiles!escalations_patient_id_fkey(full_name), clinician_alert:clinician_alerts!escalations_clinician_alert_id_fkey(title, level), assigned_doctor:profiles!escalations_assigned_doctor_id_fkey(full_name)";

/** All escalations in the caller's org, newest first — clinician tracking view. */
export function useOrgEscalations() {
  return useQuery({
    queryKey: ["escalations", "org"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("escalations")
        .select(ESCALATION_SELECT)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as EscalationWithDetails[];
    },
  });
}

/** Open/under-review escalations — doctor worklist (unclaimed or claimed by anyone). */
export function useDoctorEscalations() {
  return useQuery({
    queryKey: ["escalations", "doctor-worklist"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("escalations")
        .select(ESCALATION_SELECT)
        .in("status", ["open", "under_review"])
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as EscalationWithDetails[];
    },
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

      const { error } = await supabase
        .from("escalations")
        .update({ assigned_doctor_id: user.id, status: "under_review" })
        .eq("id", escalationId)
        .eq("status", "open");
      if (error) throw error;
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
