import { z } from "zod";
import { getProposedConfig } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";

/**
 * Diagnostic directory Phase 3: typed access to public.search_diagnostic_services for the doctor (Phase 5) and patient
 * (Phase 6) screens. Radius and page size come from proposed-config "directory.diagnostic_search"; the database decides
 * eligibility and who sees which columns. A failed read is reported as a failure, never as "no branches nearby".
 */

type SearchConfig = { radii_km: number[]; default_radius_km: number; page_size: number };
export const diagnosticSearchConfig = (): SearchConfig =>
  getProposedConfig<SearchConfig>("directory.diagnostic_search").value;

const uuid = z.string().uuid();
const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

export const searchInputSchema = z.object({
  conceptId: uuid,
  location: z.union([
    z.object({ lat: latitude, lng: longitude, radiusKm: z.number().positive().optional() }),
    z.object({ state: z.string().trim().min(2).max(60), lga: z.string().trim().min(2).max(80).optional() }),
  ]),
  // Off unless a screen asks for it and labels those rows: they are never normal recommendations (§10).
  includeUnconfirmed: z.boolean().default(false),
  page: z.number().int().min(0).max(1000).default(0),
});
export type SearchInput = z.input<typeof searchInputSchema>;

const nullableString = z.string().nullable();
export const searchRowSchema = z.object({
  service_id: uuid,
  branch_listing_id: uuid,
  kind: z.enum(["lab", "imaging"]),
  provider_name: z.string(),
  branch_name: z.string(),
  address: z.string(),
  neighbourhood: nullableString,
  town: nullableString,
  lga: nullableString,
  state: z.string(),
  phone: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  distance_km: z.number().nullable(),
  availability: z.enum(["available", "by_appointment", "awaiting_confirmation", "external_referral"]),
  appointment_required: z.boolean(),
  preparation_note: nullableString,
  performed_elsewhere: z.boolean(),
  result_group: z.enum(["eligible", "unconfirmed"]),
  last_confirmed_at: nullableString,
  credentials_on_file: z.array(z.string()).nullable(),
  total_count: z.number(),
});
export type SearchRow = z.infer<typeof searchRowSchema>;

export type SearchResult =
  // total is null when the page is past the end (no row carries the count); it is never reported as 0 then.
  | { ok: true; rows: SearchRow[]; total: number | null; radiusKm: number | null; pageSize: number }
  | { ok: false; reason: "invalid" | "denied" | "closed" | "failed" };

export async function searchDiagnosticServices(input: SearchInput): Promise<SearchResult> {
  const parsed = searchInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const { conceptId, location, includeUnconfirmed, page } = parsed.data;
  const config = diagnosticSearchConfig();
  const byPoint = "lat" in location;
  // Only the configured radii are offered; anything else falls back to the default rather than widening the search.
  const radiusKm = byPoint
    ? (location.radiusKm !== undefined && config.radii_km.includes(location.radiusKm) ? location.radiusKm : config.default_radius_km)
    : null;

  const { data, error } = await loose(await createClient()).rpc("search_diagnostic_services", {
    p_concept_id: conceptId,
    p_lat: byPoint ? location.lat : null,
    p_lng: byPoint ? location.lng : null,
    p_radius_km: radiusKm,
    p_state: byPoint ? null : location.state,
    p_lga: byPoint ? null : (location.lga ?? null),
    p_include_unconfirmed: includeUnconfirmed,
    p_limit: config.page_size,
    p_offset: page * config.page_size,
  });
  if (error) {
    const reason = error.code === "42501" ? "denied" : error.code === "55000" ? "closed" : error.code === "22023" ? "invalid" : "failed";
    return { ok: false, reason };
  }
  const rows = z.array(searchRowSchema).safeParse(data ?? []);
  if (!rows.success) return { ok: false, reason: "failed" };
  const total = rows.data[0]?.total_count ?? (page === 0 ? 0 : null);
  return { ok: true, rows: rows.data, total, radiusKm, pageSize: config.page_size };
}
