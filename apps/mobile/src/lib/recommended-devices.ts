import { supabase } from "./supabase";

/**
 * Recommended devices (S70a, 18.2): only devices the Chief Medical Officer has reviewed, each with its accuracy evidence and a NAFDAC number
 * or an authorised local distributor. Tarragon sells none of them, earns nothing if one is bought, and seeds nothing: the list is whatever the
 * CMO has published, and it is empty (with "type it in") until then. The database returns nothing while the switch is off.
 */
export interface RecommendedDevice {
  id: string;
  name: string;
  category: string;
  vendor: string | null;
  description: string | null;
  validatedSourceUrl: string | null;
  validationBasis: "validatebp" | "published_validation_study" | null;
  nafdacNumber: string | null;
  authorisedDistributor: string | null;
}

export type RecommendedLoad = { ok: true; items: RecommendedDevice[] } | { ok: false };

export async function loadRecommendedDevices(): Promise<RecommendedLoad> {
  try {
    const { data, error } = await supabase.rpc("recommended_devices");
    if (error) return { ok: false };
    return {
      ok: true,
      items: (data ?? []).map((row) => ({
        id: row.id,
        name: row.device_name,
        category: row.category,
        vendor: row.vendor_name ?? null,
        description: row.description ?? null,
        validatedSourceUrl: row.validated_source_url ?? null,
        validationBasis: (row.validation_basis as RecommendedDevice["validationBasis"]) ?? null,
        nafdacNumber: row.nafdac_number ?? null,
        authorisedDistributor: row.authorised_distributor ?? null,
      })),
    };
  } catch {
    return { ok: false };
  }
}
