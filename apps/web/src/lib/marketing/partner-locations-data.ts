import { marketingAnonClient as anonClient } from "./anon-client";

/**
 * The public partner-location map for the marketing site.
 *
 * Reads public.public_partner_locations() through a BARE anon supabase-js
 * client, deliberately not @/lib/supabase/server, so the marketing tree stays
 * free of auth and platform modules per the marketing-boundary rule (same
 * pattern as coverage-data.ts's getServiceCoverage()).
 *
 * Unlike getServiceCoverage()'s RPC, this one deliberately returns
 * partner-identifying rows (name, address, exact coordinates) — a founder-
 * approved, scoped exception to the coverage page's usual "no partner
 * identities exposed" principle, limited to Tarragon's own contracted
 * partner catalogues: home_visit_providers, logistics_partners, and
 * lab_providers (e.g. Synlab Nigeria — a real, billed, contracted partner,
 * not a self-arranged listing). It never touches public.facilities, the
 * separate self-arranged lab/pharmacy directory that stays suspended.
 *
 * Fails soft, same as getServiceCoverage(), but reports HOW it failed. It used
 * to collapse "the RPC said there are none" and "we could not reach the RPC"
 * into the same empty array, and /coverage rendered that as a definitive
 * negative claim on a public page ("We haven't activated a contracted lab,
 * home visit or delivery partner yet"). The RPC returns 39 rows live, so a
 * transient read failure would have published a statement that contradicts
 * both the truth and this site's own "our partner laboratory" pricing copy.
 * Callers must distinguish `status: "unavailable"` from an empty `locations`.
 */

export type PartnerLocation = {
  id: string;
  name: string;
  type: "home_visit" | "delivery" | "lab";
  address: string;
  latitude: number;
  longitude: number;
  regions: string[];
};

function toPartnerLocation(raw: unknown): PartnerLocation | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "string") return null;
  if (typeof row.name !== "string") return null;
  if (row.type !== "home_visit" && row.type !== "delivery" && row.type !== "lab") return null;
  if (typeof row.address !== "string") return null;
  if (typeof row.latitude !== "number") return null;
  if (typeof row.longitude !== "number") return null;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    regions: Array.isArray(row.regions) ? row.regions.filter((r): r is string => typeof r === "string") : [],
  };
}

/**
 * `"ok"` means the list below is the real, current answer, empty or not.
 * `"unavailable"` means we never got an answer, so the caller must not claim
 * anything about how many partners exist.
 */
export type PartnerLocationsResult = {
  status: "ok" | "unavailable";
  locations: PartnerLocation[];
};

export async function getPartnerLocations(): Promise<PartnerLocationsResult> {
  const supabase = anonClient();
  if (!supabase) return { status: "unavailable", locations: [] };

  const { data, error } = await supabase.rpc("public_partner_locations");
  if (error || !Array.isArray(data)) return { status: "unavailable", locations: [] };

  return {
    status: "ok",
    locations: data
      .map(toPartnerLocation)
      .filter((row): row is PartnerLocation => row !== null),
  };
}
