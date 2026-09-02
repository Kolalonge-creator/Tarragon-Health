import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@tarragon/shared";

type ComplaintCategory = Database["public"]["Enums"]["provider_complaint_category"];
type ComplaintSeverity = Database["public"]["Enums"]["provider_complaint_severity"];
type ComplaintOutcome = Database["public"]["Enums"]["provider_complaint_outcome"];

/**
 * Provider Quality & Performance Management (module §29). Three RPCs, kept
 * deliberately separate from `provider-performance.ts`'s `my_provider_performance`
 * (an activity feed — counts of what a clinician did):
 *
 *  - `provider_scorecard` — §29.2, domain-separated metrics measured against a
 *    target, each carrying its own denominator. Self-scoped by default;
 *    passing a `clinical_staff_id` requires admin/Clinical Director on the
 *    server side (the RPC returns `{}` otherwise, never an error — a caller
 *    without permission simply sees nothing, the same posture as every other
 *    self-gating RPC on this platform).
 *  - `provider_credential_monitor` — §29.6, the roster-wide licence/indemnity/
 *    attestation/restriction view. Admin/Clinical Director only.
 *  - `provider_quality_network_summary` — §29.9/§29.11, the management view:
 *    per-metric distribution of providers across on_target/watch/below_target,
 *    plus open complaints/interventions/restrictions. Admin/Clinical Director
 *    only.
 *
 * None of these schemas has a `score`, `rank`, or `grade` key — see §29.10 in
 * the migrations for why that's a hard rule, not an oversight.
 */

const metricEntrySchema = z.object({
  metric: z.string(),
  domain: z.string(),
  unit: z.string().nullable(),
  direction: z.string().nullable(),
  target: z.number().nullable(),
  warning: z.number().nullable(),
  min_denominator: z.number(),
  denominator: z.number(),
  status: z.enum(["on_target", "watch", "below_target", "insufficient_volume", "no_data"]),
  value: z.number().optional(),
  note: z.string().nullable().optional(),
});
export type ProviderQualityMetricEntry = z.infer<typeof metricEntrySchema>;

const scorecardSchema = z.object({
  provider: z
    .object({
      clinical_staff_id: z.string(),
      full_name: z.string(),
      doctor_tier: z.string().nullable(),
      is_clinical_director: z.boolean(),
      specialty: z.string().nullable(),
      active: z.boolean(),
    })
    .optional(),
  period: z.object({ from: z.string(), to: z.string() }).optional(),
  policy: z.object({ version: z.number(), signed: z.boolean(), approved_at: z.string().nullable() }).nullable().optional(),
  domains: z
    .object({
      operational: z.array(metricEntrySchema),
      documentation: z.array(metricEntrySchema),
      patient_experience: z.array(metricEntrySchema),
      clinical_quality: z.array(metricEntrySchema),
    })
    .optional(),
  clinical_quality_reported: z.boolean().optional(),
  clinical_quality_note: z.string().optional(),
  attribution: z
    .object({
      feedback_total: z.number(),
      feedback_unattributed: z.number(),
      feedback_unattributed_pct: z.number().nullable(),
      referrals_partial_attribution: z.boolean(),
    })
    .optional(),
  credentials: z
    .object({
      license_expires_at: z.string().nullable(),
      indemnity_expires_at: z.string().nullable(),
      indemnity_exempt: z.boolean(),
      attestation_current: z.boolean(),
      work_restricted: z.boolean(),
      restriction_stage: z.string().nullable(),
    })
    .optional(),
  open_complaints: z.number().optional(),
  open_interventions: z.number().optional(),
  suggested_interventions: z.array(z.record(z.string(), z.unknown())).optional(),
});
export type ProviderScorecard = z.infer<typeof scorecardSchema>;

/** §29.2 — the caller's own scorecard, or (admin/Clinical Director only) a
 * named provider's. `{}` comes back for "no permission" / "no such active
 * clinical_staff record" alike — parsed the same empty-state shape either way. */
export function useProviderScorecard(opts?: {
  clinicalStaffId?: string;
  from?: string;
  to?: string;
}) {
  return useQuery({
    queryKey: ["provider-quality", "scorecard", opts?.clinicalStaffId ?? "mine", opts?.from, opts?.to],
    queryFn: async (): Promise<ProviderScorecard> => {
      const { data, error } = await createClient().rpc("provider_scorecard", {
        p_clinical_staff_id: opts?.clinicalStaffId,
        p_from: opts?.from,
        p_to: opts?.to,
      });
      if (error) throw error;
      return scorecardSchema.parse(data);
    },
  });
}

const credentialRowSchema = z.object({
  clinical_staff_id: z.string(),
  full_name: z.string(),
  doctor_tier: z.string().nullable(),
  is_clinical_director: z.boolean(),
  credential_type: z.string().nullable(),
  credential_number: z.string().nullable(),
  license_expires_at: z.string().nullable(),
  license_state: z.enum(["not_recorded", "expired", "expiring_soon", "current"]),
  license_days_remaining: z.number().nullable(),
  license_verified_at: z.string().nullable(),
  indemnity_expires_at: z.string().nullable(),
  indemnity_state: z.enum(["not_applicable", "not_recorded", "expired", "expiring_soon", "current"]),
  attestation_current: z.boolean(),
  attestation_expires_at: z.string().nullable(),
  restriction_id: z.string().nullable(),
  restriction_stage: z.string().nullable(),
  work_restricted: z.boolean(),
  open_complaints: z.number(),
});
export type ProviderCredentialRow = z.infer<typeof credentialRowSchema>;

const credentialMonitorSchema = z.object({
  ladder: z.record(z.string(), z.unknown()).optional(),
  generated_at: z.string().optional(),
  providers: z.array(credentialRowSchema).default([]),
});
export type ProviderCredentialMonitor = z.infer<typeof credentialMonitorSchema>;

/** §29.6 — roster-wide credential monitor. `{}` for a non-admin/Clinical
 * Director caller, parsed to an empty provider list. */
export function useProviderCredentialMonitor() {
  return useQuery({
    queryKey: ["provider-quality", "credential-monitor"],
    queryFn: async (): Promise<ProviderCredentialMonitor> => {
      const { data, error } = await createClient().rpc("provider_credential_monitor");
      if (error) throw error;
      return credentialMonitorSchema.parse(data);
    },
  });
}

const metricHealthSchema = z.object({
  metric: z.string(),
  domain: z.string(),
  unit: z.string().nullable(),
  target: z.number().nullable(),
  on_target: z.number(),
  watch: z.number(),
  below_target: z.number(),
  insufficient_volume: z.number(),
  no_data: z.number(),
  median_value: z.number().nullable(),
});

const networkSummarySchema = z.object({
  period: z.object({ from: z.string(), to: z.string() }).optional(),
  provider_count: z.number().optional(),
  metric_health: z.array(metricHealthSchema).default([]),
  corrective_action: z
    .object({
      complaints_by_stage: z.record(z.string(), z.number()),
      complaints_upheld_in_period: z.number(),
      interventions_by_status: z.record(z.string(), z.number()),
      interventions_overdue: z.number(),
      interventions_unacknowledged: z.number(),
      restrictions_live: z.record(z.string(), z.number()),
      credentials_not_recorded: z.number(),
    })
    .optional(),
  clinical_quality_reported: z.boolean().optional(),
  clinical_quality_note: z.string().optional(),
});
export type ProviderQualityNetworkSummary = z.infer<typeof networkSummarySchema>;

/** §29.9/§29.11 — management view of the whole network. Admin/Clinical
 * Director only; `{}` otherwise, parsed to empty arrays/objects. */
export function useProviderQualityNetworkSummary(opts?: { from?: string; to?: string }) {
  return useQuery({
    queryKey: ["provider-quality", "network-summary", opts?.from, opts?.to],
    queryFn: async (): Promise<ProviderQualityNetworkSummary> => {
      const { data, error } = await createClient().rpc("provider_quality_network_summary", {
        p_from: opts?.from,
        p_to: opts?.to,
      });
      if (error) throw error;
      return networkSummarySchema.parse(data);
    },
  });
}

/** §29.7 — lift a live service_restriction/suspension. Admin/Clinical
 * Director only (the RPC itself is the real gate); a reason is mandatory. */
export function useLiftProviderRestriction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ restrictionId, reason }: { restrictionId: string; reason: string }) => {
      const { data, error } = await createClient().rpc("lift_provider_restriction", {
        p_restriction_id: restrictionId,
        p_reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-quality"] });
    },
  });
}

const myInterventionSchema = z.object({
  id: z.string(),
  intervention_type: z.string(),
  status: z.string(),
  rationale: z.string(),
  agreed_actions: z.string().nullable(),
  opened_at: z.string(),
  due_at: z.string().nullable(),
  provider_acknowledged_at: z.string().nullable(),
});
export type MyProviderIntervention = z.infer<typeof myInterventionSchema>;

/** §29.8 — the caller's own open/in-progress interventions, direct table
 * read (RLS already scopes `provider_interventions` visibility to the
 * subject's own clinical_staff_id or an org handler — see
 * `provider_interventions_select`). Filtered here to `clinical_staff.profile_id
 * = auth.uid()` explicitly, not left to RLS alone: an admin/Clinical Director
 * viewing their OWN "my performance" page would otherwise see every open
 * intervention in the org (their handler access is broader than their own
 * file) mislabeled as theirs. */
export function useMyOpenProviderInterventions() {
  return useQuery({
    queryKey: ["provider-quality", "my-interventions"],
    queryFn: async (): Promise<MyProviderIntervention[]> => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from("provider_interventions")
        .select(
          "id, intervention_type, status, rationale, agreed_actions, opened_at, due_at, provider_acknowledged_at, clinical_staff!inner(profile_id)"
        )
        .eq("clinical_staff.profile_id", user.id)
        .in("status", ["open", "in_progress"])
        .order("opened_at", { ascending: false });
      if (error) throw error;
      return z.array(myInterventionSchema).parse(data ?? []);
    },
  });
}

/** The subject provider confirms they've seen an intervention on their own
 * file. Idempotent — the first acknowledgement stands. */
export function useAcknowledgeProviderIntervention() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (interventionId: string) => {
      const { data, error } = await createClient().rpc("acknowledge_provider_intervention", {
        p_intervention_id: interventionId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-quality"] });
    },
  });
}

// ---------------------------------------------------------------------------
// §29.5 Provider complaints
// ---------------------------------------------------------------------------

export const PROVIDER_COMPLAINT_STAGES = [
  "received",
  "triage",
  "investigation",
  "provider_response",
  "resolution",
  "governance_review",
  "closed",
  "withdrawn",
] as const;
export type ProviderComplaintStage = (typeof PROVIDER_COMPLAINT_STAGES)[number];

const complaintListRowSchema = z.object({
  id: z.string(),
  reference: z.string(),
  subject_staff_id: z.string(),
  category: z.string(),
  severity: z.string().nullable(),
  stage: z.string(),
  outcome: z.string().nullable(),
  created_at: z.string(),
  subject: z
    .object({ full_name: z.string() })
    .nullable()
    .optional(),
});
export type ProviderComplaintListRow = z.infer<typeof complaintListRowSchema>;

/** §29.5 — complaints this caller is entitled to see (RLS does the real
 * scoping: admin/Clinical Director sees everything, a complainant sees their
 * own, the subject provider sees theirs only from provider_response on). */
export function useProviderComplaints() {
  return useQuery({
    queryKey: ["provider-quality", "complaints"],
    queryFn: async (): Promise<ProviderComplaintListRow[]> => {
      const { data, error } = await createClient()
        .from("provider_complaints")
        .select(
          "id, reference, subject_staff_id, category, severity, stage, outcome, created_at, subject:clinical_staff!provider_complaints_subject_staff_id_fkey(full_name)"
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return z.array(complaintListRowSchema).parse(data ?? []);
    },
  });
}

const complaintDetailSchema = z.object({
  id: z.string(),
  reference: z.string(),
  organisation_id: z.string(),
  subject_staff_id: z.string(),
  raised_by: z.string().nullable(),
  patient_id: z.string().nullable(),
  category: z.string(),
  severity: z.string().nullable(),
  summary: z.string(),
  stage: z.string(),
  triaged_by: z.string().nullable(),
  triaged_at: z.string().nullable(),
  investigation_opened_at: z.string().nullable(),
  response_requested_at: z.string().nullable(),
  provider_response: z.string().nullable(),
  provider_responded_at: z.string().nullable(),
  outcome: z.string().nullable(),
  resolution_summary: z.string().nullable(),
  resolved_at: z.string().nullable(),
  governance_reviewed_by: z.string().nullable(),
  governance_reviewed_at: z.string().nullable(),
  governance_notes: z.string().nullable(),
  closed_at: z.string().nullable(),
  withdrawn_at: z.string().nullable(),
  withdrawn_reason: z.string().nullable(),
  created_at: z.string(),
});
export type ProviderComplaintDetail = z.infer<typeof complaintDetailSchema>;

export function useProviderComplaint(id: string) {
  return useQuery({
    queryKey: ["provider-quality", "complaints", id],
    enabled: !!id,
    queryFn: async (): Promise<ProviderComplaintDetail> => {
      const { data, error } = await createClient()
        .from("provider_complaints")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return complaintDetailSchema.parse(data);
    },
  });
}

const investigationNoteSchema = z.object({
  id: z.string(),
  note: z.string(),
  created_at: z.string(),
  author_id: z.string(),
});
export type ProviderComplaintInvestigationNote = z.infer<typeof investigationNoteSchema>;

/** The investigation file — visible to handlers only (RLS), never to the
 * subject provider even once they can see the complaint itself. */
export function useProviderComplaintInvestigationNotes(complaintId: string) {
  return useQuery({
    queryKey: ["provider-quality", "complaints", complaintId, "notes"],
    enabled: !!complaintId,
    queryFn: async (): Promise<ProviderComplaintInvestigationNote[]> => {
      const { data, error } = await createClient()
        .from("provider_complaint_investigation_notes")
        .select("id, note, created_at, author_id")
        .eq("complaint_id", complaintId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return z.array(investigationNoteSchema).parse(data ?? []);
    },
  });
}

function useInvalidateComplaint(complaintId: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["provider-quality", "complaints"] });
    queryClient.invalidateQueries({ queryKey: ["provider-quality", "complaints", complaintId] });
  };
}

/** Intake — raised by a patient about their own care, or by a handler on a
 * patient's behalf. organisation_id/stage/reference are all server-derived
 * or DB-defaulted; the caller only ever supplies the substance. */
export function useRaiseProviderComplaint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      subjectStaffId: string;
      category: string;
      summary: string;
      patientId?: string;
      organisationId: string;
    }) => {
      const { data, error } = await createClient()
        .from("provider_complaints")
        .insert({
          organisation_id: input.organisationId,
          subject_staff_id: input.subjectStaffId,
          category: input.category as ComplaintCategory,
          summary: input.summary,
          patient_id: input.patientId ?? null,
          // Not actually sent as empty — private.set_provider_complaint_reference
          // (a BEFORE INSERT trigger, not a column DEFAULT) overwrites any
          // null/blank value with the real TH-CMP-YYYY-NNNN reference. The
          // generated Insert type still marks the column required because it
          // has no DEFAULT clause for a trigger to satisfy statically.
          reference: "",
        })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-quality", "complaints"] });
    },
  });
}

/** Triage — records severity + the triager, advances received -> triage. */
export function useTriageProviderComplaint(complaintId: string) {
  const invalidate = useInvalidateComplaint(complaintId);
  return useMutation({
    mutationFn: async (severity: string) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase
        .from("provider_complaints")
        .update({ stage: "triage", triaged_by: user.id, severity: severity as ComplaintSeverity })
        .eq("id", complaintId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** Opens the investigation stage. A note must exist before it can advance
 * again — add one with useAddInvestigationNote first. */
export function useOpenInvestigation(complaintId: string) {
  const invalidate = useInvalidateComplaint(complaintId);
  return useMutation({
    mutationFn: async () => {
      const { error } = await createClient()
        .from("provider_complaints")
        .update({ stage: "investigation" })
        .eq("id", complaintId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useAddInvestigationNote(complaintId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (note: string) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase
        .from("provider_complaint_investigation_notes")
        .insert({ complaint_id: complaintId, author_id: user.id, note });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["provider-quality", "complaints", complaintId, "notes"],
      });
    },
  });
}

/** Moves to provider_response and records that the provider was asked. The
 * provider's own reply is a separate, RLS-narrowed write they make themselves
 * (not exposed here — see the subject-facing complaint view). */
export function useRequestProviderResponse(complaintId: string) {
  const invalidate = useInvalidateComplaint(complaintId);
  return useMutation({
    mutationFn: async () => {
      const { error } = await createClient()
        .from("provider_complaints")
        .update({ stage: "provider_response" })
        .eq("id", complaintId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** The subject provider's own reply. RLS admits this write only while the
 * complaint is at provider_response and the caller is its subject. */
export function useSubmitProviderComplaintResponse(complaintId: string) {
  const invalidate = useInvalidateComplaint(complaintId);
  return useMutation({
    mutationFn: async (response: string) => {
      const { error } = await createClient()
        .from("provider_complaints")
        .update({ provider_response: response })
        .eq("id", complaintId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useResolveProviderComplaint(complaintId: string) {
  const invalidate = useInvalidateComplaint(complaintId);
  return useMutation({
    mutationFn: async (input: { outcome: string; resolutionSummary: string }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase
        .from("provider_complaints")
        .update({
          stage: "resolution",
          outcome: input.outcome as ComplaintOutcome,
          resolution_summary: input.resolutionSummary,
          resolved_by: user.id,
        })
        .eq("id", complaintId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** Clinical-Director-only in practice — the stage trigger requires
 * governance_reviewed_by to reference an active Clinical Director's
 * clinical_staff row, so a non-director's write is rejected by the DB even
 * if this mutation is called. */
export function useGovernanceReviewProviderComplaint(complaintId: string) {
  const invalidate = useInvalidateComplaint(complaintId);
  return useMutation({
    mutationFn: async (input: { clinicalStaffId: string; notes: string }) => {
      const { error } = await createClient()
        .from("provider_complaints")
        .update({
          stage: "governance_review",
          governance_reviewed_by: input.clinicalStaffId,
          governance_notes: input.notes,
        })
        .eq("id", complaintId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useCloseProviderComplaint(complaintId: string) {
  const invalidate = useInvalidateComplaint(complaintId);
  return useMutation({
    mutationFn: async () => {
      const { error } = await createClient()
        .from("provider_complaints")
        .update({ stage: "closed" })
        .eq("id", complaintId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useWithdrawProviderComplaint(complaintId: string) {
  const invalidate = useInvalidateComplaint(complaintId);
  return useMutation({
    mutationFn: async (reason: string) => {
      const { error } = await createClient()
        .from("provider_complaints")
        .update({ stage: "withdrawn", withdrawn_reason: reason })
        .eq("id", complaintId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}
