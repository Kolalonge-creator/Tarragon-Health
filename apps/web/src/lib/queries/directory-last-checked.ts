import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { loose } from "@/lib/clinician/loose-client";
import { lastCheckedRowsSchema, type LastChecked } from "@/lib/directory-freshness/model";

export type PatientListingTable = "lab_providers" | "lab_provider_locations" | "pharmacy_partners" | "pharmacy_partner_locations";

/**
 * "Last checked" for one lab or pharmacy listing on a patient screen. Reads public.directory_last_checked, which returns only
 * a date and an overdue flag. A failed read or a listing that was never checked returns null: the screen then shows nothing,
 * never a made-up date.
 */
export function useDirectoryLastChecked(table: PatientListingTable, id: string | null | undefined) {
  return useQuery({
    queryKey: ["directory-last-checked", table, id ?? null],
    enabled: !!id,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<LastChecked | null> => {
      const { data, error } = await loose(createClient()).rpc("directory_last_checked", { p_listing_table: table, p_listing_ids: [id] });
      if (error) return null;
      const parsed = lastCheckedRowsSchema.safeParse(data);
      return parsed.success ? (parsed.data[0] ?? null) : null;
    },
  });
}
