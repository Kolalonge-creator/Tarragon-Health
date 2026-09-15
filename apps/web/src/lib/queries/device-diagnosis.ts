"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type WearableConnectionDiagnosis = Pick<
  Tables<"wearable_connections">,
  "id" | "provider" | "status" | "last_synced_at" | "last_sync_error" | "connected_at"
>;

export type PatientDeviceDiagnosis = Pick<
  Tables<"patient_devices">,
  "id" | "device_type" | "nickname" | "status" | "last_synced_at" | "last_sync_error" | "paired_at"
>;

export interface DeviceDiagnosisResult {
  connections: WearableConnectionDiagnosis[];
  devices: PatientDeviceDiagnosis[];
}

/**
 * 55.12 patient tech-support auto-diagnosis: "My device isn't syncing."
 *
 * Every column the diagnosis needs — which device/connection, is it working,
 * last successful transmission, error code — already lives on
 * wearable_connections/patient_devices (see 20260829021609's observability
 * columns and the pre-existing last_synced_at/status). This is a plain read
 * scoped by the existing `patient_id = auth.uid() OR is_org_staff` RLS on
 * both tables, not a guess or a support-side investigation.
 *
 * Deliberately unfiltered by status (unlike useWearableConnections, which
 * only shows active/error) — a disconnected connection or an unpaired device
 * is itself a diagnosis ("that's why it stopped syncing: you unpaired it").
 */
export function useDeviceDiagnosis(patientId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["device-diagnosis", patientId],
    queryFn: async (): Promise<DeviceDiagnosisResult> => {
      const supabase = createClient();
      const [connectionsRes, devicesRes] = await Promise.all([
        supabase
          .from("wearable_connections")
          .select("id, provider, status, last_synced_at, last_sync_error, connected_at")
          .eq("patient_id", patientId)
          .order("connected_at", { ascending: false }),
        supabase
          .from("patient_devices")
          .select("id, device_type, nickname, status, last_synced_at, last_sync_error, paired_at")
          .eq("patient_id", patientId)
          .order("paired_at", { ascending: false }),
      ]);
      if (connectionsRes.error) throw connectionsRes.error;
      if (devicesRes.error) throw devicesRes.error;
      return {
        connections: connectionsRes.data as WearableConnectionDiagnosis[],
        devices: devicesRes.data as PatientDeviceDiagnosis[],
      };
    },
    enabled: enabled && !!patientId,
  });
}
