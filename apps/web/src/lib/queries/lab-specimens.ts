import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/**
 * §56.9-§56.13 sample tracking. lab_specimens/lab_turnaround_alerts are new
 * tables from the 2026-08-29 lab-network migration series, not yet in the
 * generated Database type (see the note in lib/queries/lab-orders.ts) —
 * these types are hand-defined to match the migration's column list and
 * should fold into Tables<"lab_specimens"> next codegen run.
 */
export type LabSpecimenStatus =
  | "pending_collection"
  | "collected"
  | "in_transit"
  | "received"
  | "processing"
  | "completed"
  | "rejected";

export type LabSpecimenRejectionReason =
  | "insufficient_sample"
  | "incorrect_container"
  | "wrong_labelling"
  | "delayed_transport"
  | "damaged_specimen";

export type LabSpecimen = {
  id: string;
  organisation_id: string;
  lab_order_id: string;
  patient_id: string;
  provider_id: string | null;
  specimen_number: string;
  status: LabSpecimenStatus;
  collection_method: "facility_visit" | "home_collection";
  collected_at: string | null;
  in_transit_at: string | null;
  received_at: string | null;
  processing_at: string | null;
  completed_at: string | null;
  rejected_at: string | null;
  rejection_reason: LabSpecimenRejectionReason | null;
  rejection_notes: string | null;
  recollection_of: string | null;
  courier_reference: string | null;
  created_at: string;
  updated_at: string;
};

/** A patient's own specimen(s) for one order, oldest first — a rejected
 * specimen followed by its recollection reads as a real chain of custody,
 * not a status flip. RLS (patient_id = auth.uid()) does the scoping. */
export function usePatientLabSpecimens(labOrderId: string | null | undefined) {
  return useQuery({
    queryKey: ["lab-specimens", "order", labOrderId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("lab_specimens")
        .select("*")
        .eq("lab_order_id", labOrderId as string)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as LabSpecimen[];
    },
    enabled: !!labOrderId,
  });
}

/** The lab partner's own worklist of specimens, newest first — RLS scopes
 * this to the caller's own provider_id via lab_specimens_select. */
export function useLabPartnerSpecimens() {
  return useQuery({
    queryKey: ["lab-specimens", "lab-partner"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("lab_specimens")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as LabSpecimen[];
    },
  });
}

export type LabPartnerDashboardStats = {
  orders_today: number;
  samples_received_today: number;
  samples_processing: number;
  samples_completed_today: number;
  samples_rejected_today: number;
  samples_delayed: number;
};

/** §56.13 — orders today / samples received / processing / completed /
 * rejected / delayed, scoped to the caller's own lab. */
export function useLabPartnerDashboardStats() {
  return useQuery({
    queryKey: ["lab-partner-dashboard-stats"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("lab_partner_dashboard_stats");
      if (error) throw error;
      const row = (data ?? [])[0] as LabPartnerDashboardStats | undefined;
      return (
        row ?? {
          orders_today: 0,
          samples_received_today: 0,
          samples_processing: 0,
          samples_completed_today: 0,
          samples_rejected_today: 0,
          samples_delayed: 0,
        }
      );
    },
  });
}

export function useAdvanceLabSpecimen() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      specimenId,
      status,
      courierReference,
    }: {
      specimenId: string;
      status: Exclude<LabSpecimenStatus, "rejected">;
      courierReference?: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("lab_partner_update_specimen_status", {
        p_specimen_id: specimenId,
        p_status: status,
        p_courier_reference: courierReference ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lab-specimens"] });
      queryClient.invalidateQueries({ queryKey: ["lab-partner-dashboard-stats"] });
    },
  });
}

/** §56.10 — rejects a specimen and, in the same call, opens the
 * recollection pathway (a fresh pending_collection specimen chained via
 * recollection_of). */
export function useRejectLabSpecimen() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      specimenId,
      reason,
      notes,
    }: {
      specimenId: string;
      reason: LabSpecimenRejectionReason;
      notes?: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("lab_partner_reject_specimen", {
        p_specimen_id: specimenId,
        p_reason: reason,
        p_notes: notes ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lab-specimens"] });
      queryClient.invalidateQueries({ queryKey: ["lab-partner-dashboard-stats"] });
    },
  });
}

export const LAB_SPECIMEN_STATUS_LABEL: Record<LabSpecimenStatus, string> = {
  pending_collection: "Waiting on sample collection",
  collected: "Sample collected",
  in_transit: "On its way to the lab",
  received: "Received at the lab",
  processing: "Being processed",
  completed: "Complete",
  rejected: "Rejected — a new sample is needed",
};

export const LAB_SPECIMEN_REJECTION_REASON_LABEL: Record<LabSpecimenRejectionReason, string> = {
  insufficient_sample: "Not enough sample was collected",
  incorrect_container: "Wrong container for this test",
  wrong_labelling: "Labelling didn't match the order",
  delayed_transport: "Took too long in transit",
  damaged_specimen: "Sample was damaged",
};
