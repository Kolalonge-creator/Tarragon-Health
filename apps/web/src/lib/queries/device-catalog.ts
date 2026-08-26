import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type DeviceCatalogEntry = Tables<"device_catalog">;

/**
 * Patient-facing device_catalog rows for the in-app Shop (Device Pairing &
 * Integration Spec v2 §9.2) — active AND clinically_reviewed only. A row can
 * exist in the table (an admin curated it, per §4.1) without being visible
 * here yet: both flags start false until a real end-to-end pairing test has
 * run and a clinician has signed off (see the device_catalog migration).
 *
 * No plan/tier filter — the spec's §9.2 "filtered to the patient's assigned
 * tier" assumes a device-allocation-by-tier table/policy that doesn't exist
 * anywhere in the codebase yet (checked at build time). Same precedent as
 * the wearable Connect card (CLAUDE.md, 2026-08-05 correction): shown to
 * every patient, un-gated, until a real allocation rule exists to gate by.
 */
export function useDeviceCatalog() {
  return useQuery({
    queryKey: ["device-catalog"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("device_catalog")
        .select("*")
        .eq("active", true)
        .eq("clinically_reviewed", true)
        .order("category", { ascending: true })
        .order("display_order", { ascending: true });
      if (error) throw error;
      return data as DeviceCatalogEntry[];
    },
  });
}

export const DEVICE_CATEGORY_LABEL: Record<DeviceCatalogEntry["category"], string> = {
  blood_pressure: "Blood pressure monitor",
  weight: "Weight scale",
  blood_glucose: "Glucometer",
  band: "Wearable band",
};
