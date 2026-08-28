import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@tarragon/shared";

type PatientDeviceType = Database["public"]["Enums"]["patient_device_type"];

/** A patient's own actively-paired devices of one type, for the manual
 * measurement-entry form's optional "which device did you use?" selector
 * (§6.5). Device-sourced (BLE sync) readings already carry device_id
 * automatically via /api/mobile/device-readings — this only covers a
 * patient typing in a reading they took using a device they own. */
export function usePatientDevices(patientId: string, deviceType: PatientDeviceType) {
  return useQuery({
    queryKey: ["patient-devices", patientId, deviceType],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_devices")
        .select("id, nickname, manufacturer, model")
        .eq("patient_id", patientId)
        .eq("device_type", deviceType)
        .eq("status", "active")
        .order("paired_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}
