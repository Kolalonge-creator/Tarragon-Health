import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";
import type { VitalType } from "@/lib/devices/recommend-devices";

export type DeviceOffering = Tables<"device_offerings">;

const activeOfferingsKey = ["device-offerings", "active"] as const;
const adminOfferingsKey = ["device-offerings", "admin", "all"] as const;
const monitoredVitalsKey = (patientId: string) => ["device-offerings", "monitored-vitals", patientId] as const;

/** Patient-facing shop listing — active offerings only, RLS enforces the same. */
export function useActiveDeviceOfferings() {
  return useQuery({
    queryKey: activeOfferingsKey,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("device_offerings")
        .select("*")
        .eq("is_active", true)
        .order("device_type")
        .order("display_order");
      if (error) throw error;
      return data as DeviceOffering[];
    },
  });
}

/**
 * The vital_types the patient's active chronic-programme enrolments monitor —
 * the input to the advisory device recommendation, never a filter on what the
 * shop shows. An enrolment with no active enrolments (or an as-yet-unenrolled
 * patient) simply gets no "recommended for you" badges, not an empty shop.
 */
export function usePatientMonitoredVitalTypes(patientId: string) {
  return useQuery({
    queryKey: monitoredVitalsKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("chronic_programme_enrolments")
        .select("chronic_condition_programmes(monitoring_vitals)")
        .eq("patient_id", patientId)
        .eq("status", "enrolled");
      if (error) throw error;
      const vitalTypes = new Set<VitalType>();
      for (const row of data ?? []) {
        const programme = row.chronic_condition_programmes as { monitoring_vitals: VitalType[] } | null;
        programme?.monitoring_vitals.forEach((v) => vitalTypes.add(v));
      }
      return [...vitalTypes];
    },
    enabled: !!patientId,
  });
}

// ---------------------------------------------------------------------------
// Admin — device catalogue management
// ---------------------------------------------------------------------------

export function useAllDeviceOfferings() {
  return useQuery({
    queryKey: adminOfferingsKey,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("device_offerings")
        .select("*")
        .order("device_type")
        .order("display_order");
      if (error) throw error;
      return data as DeviceOffering[];
    },
  });
}

export type CreateDeviceOfferingInput = {
  deviceType: DeviceOffering["device_type"];
  make: string;
  model: string;
  retailerName: string | null;
  affiliateUrl: string;
  priceKobo: number | null;
  imageUrl: string | null;
  description: string | null;
  bleValidated: boolean;
  isActive: boolean;
};

export function useCreateDeviceOffering() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateDeviceOfferingInput) => {
      const supabase = createClient();
      const { error } = await supabase.from("device_offerings").insert({
        device_type: input.deviceType,
        make: input.make,
        model: input.model,
        retailer_name: input.retailerName,
        fulfilment_type: "affiliate_link",
        affiliate_url: input.affiliateUrl,
        price_kobo: input.priceKobo,
        image_url: input.imageUrl,
        description: input.description,
        ble_validated: input.bleValidated,
        is_active: input.isActive,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminOfferingsKey });
      qc.invalidateQueries({ queryKey: activeOfferingsKey });
    },
  });
}

export function useSetDeviceOfferingActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase.from("device_offerings").update({ is_active: isActive }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminOfferingsKey });
      qc.invalidateQueries({ queryKey: activeOfferingsKey });
    },
  });
}

export function useDeleteDeviceOffering() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = createClient();
      const { error } = await supabase.from("device_offerings").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminOfferingsKey });
      qc.invalidateQueries({ queryKey: activeOfferingsKey });
    },
  });
}
