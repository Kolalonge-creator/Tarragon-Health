import { getProposedConfig } from "@tarragon/shared";
import { supabase } from "./supabase";
import { API_BASE_URL } from "./api";

/**
 * Diagnostic directory Phases 5 and 6 on the phone. Same database functions as the web screens
 * (apps/web/src/lib/diagnostic-directory/{orders,patient-search,search}.ts): order_suggested_place, search_investigations,
 * search_diagnostic_services and diagnostic_branch_profile. Eligibility, the partner band, labelling and who may read what are
 * all decided in the database under the patient's own session; nothing here filters or ranks.
 *
 * A failed or malformed read is reported as a failure, never as "nothing found" (the same rule as web). The phone searches
 * by state and LGA only: it has no location library, and adding one is a native build, not an over-the-air update.
 */

export type DirectoryRead<T> = { ok: true; data: T } | { ok: false; reason: "closed" | "denied" | "invalid" | "failed" };

type RpcError = { code?: string } | null;
// order_suggested_place and diagnostic_branch_profile are not in the generated types yet (they return jsonb), so the call
// goes through one narrow, untyped seam. Everything that comes back is checked by the guards below before it is used.
const rpcUntyped = (fn: string, args: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: RpcError }>)(fn, args);

function failure(error: RpcError): DirectoryRead<never> {
  const code = error?.code;
  return { ok: false, reason: code === "55000" ? "closed" : code === "42501" ? "denied" : code === "22023" ? "invalid" : "failed" };
}

type Shape = Record<string, "string" | "string?" | "number" | "number?" | "boolean" | "boolean?">;
function matches(value: unknown, shape: Shape): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return Object.entries(shape).every(([key, kind]) => {
    const optional = kind.endsWith("?");
    const base = optional ? kind.slice(0, -1) : kind;
    return (optional && v[key] === null) || typeof v[key] === base;
  });
}

// ---- Phase 5: the place a doctor suggested for one order --------------------------------------------------------------

export interface SuggestedPlace {
  kind: "lab" | "imaging";
  test: string;
  providerName: string;
  branchName: string;
  address: string;
  town: string | null;
  lga: string | null;
  state: string;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  appointmentRequired: boolean;
  preparationNote: string | null;
  stillRecommendable: boolean;
  isPartner: boolean;
  suggestedAt: string;
  suggestedBy: string | null;
}

const PLACE_SHAPE: Shape = {
  kind: "string", test: "string", provider_name: "string", branch_name: "string", address: "string", town: "string?",
  lga: "string?", state: "string", phone: "string?", latitude: "number?", longitude: "number?", appointment_required: "boolean?",
  preparation_note: "string?", still_recommendable: "boolean", is_partner: "boolean", suggested_at: "string", suggested_by: "string?",
};

/** Opening it is what records that the patient has seen it (the database stamps the first view, as on web). */
export async function openSuggestedPlace(kind: "lab" | "imaging", orderId: string): Promise<DirectoryRead<SuggestedPlace | null>> {
  const { data, error } = await rpcUntyped("order_suggested_place", { p_kind: kind, p_order_id: orderId });
  if (error) return failure(error);
  if (data === null) return { ok: true, data: null };
  if (!matches(data, PLACE_SHAPE) || (data.kind !== "lab" && data.kind !== "imaging")) return { ok: false, reason: "failed" };
  const d = data as Record<string, never>;
  return {
    ok: true,
    data: {
      kind: d.kind, test: d.test, providerName: d.provider_name, branchName: d.branch_name, address: d.address, town: d.town,
      lga: d.lga, state: d.state, phone: d.phone, latitude: d.latitude, longitude: d.longitude,
      appointmentRequired: d.appointment_required === true, preparationNote: d.preparation_note,
      stillRecommendable: d.still_recommendable, isPartner: d.is_partner, suggestedAt: d.suggested_at, suggestedBy: d.suggested_by,
    },
  };
}

// ---- Imaging requests a doctor made and the patient has not had yet ----------------------------------------------------

export interface ImagingRequestItem {
  id: string;
  createdAt: string;
  urgency: string;
  studyName: string;
}

export async function getOpenImagingRequests(patientId: string): Promise<DirectoryRead<ImagingRequestItem[]>> {
  const { data, error } = await supabase
    .from("imaging_orders")
    .select("id, created_at, urgency, study:imaging_studies(name)")
    .eq("patient_id", patientId)
    .in("status", ["ordered", "booked"])
    .order("created_at", { ascending: false });
  if (error) return failure(error);
  const rows = (data ?? []) as unknown as { id: string; created_at: string; urgency: string; study: { name: string } | null }[];
  return {
    ok: true,
    data: rows.map((r) => ({ id: r.id, createdAt: r.created_at, urgency: r.urgency, studyName: r.study?.name ?? "Imaging study" })),
  };
}

/** The take-anywhere imaging request, opened in the in-app browser (same token-in-URL pattern as getLabRequestPrintUrl). */
export async function getImagingRequestPrintUrl(orderId: string): Promise<DirectoryRead<string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return { ok: false, reason: "denied" };
  return { ok: true, data: `${API_BASE_URL}/api/mobile/imaging-order/${orderId}/request?token=${encodeURIComponent(session.access_token)}` };
}

// ---- Phase 6: find a test, then a branch that does it ------------------------------------------------------------------

export interface TestMatch {
  conceptId: string;
  display: string;
  description: string | null;
  matchedOn: string;
  clarifiesDisplay: string | null;
}

export async function findTests(text: string): Promise<DirectoryRead<{ matches: TestMatch[]; clarifying: string | null }>> {
  const q = text.trim();
  if (q.length < 2 || q.length > 80) return { ok: false, reason: "invalid" };
  const minScore = getProposedConfig<{ min_score: number }>("directory.investigation_search").value.min_score;
  const { data, error } = await supabase.rpc("search_investigations", { p_text: q, p_min_score: minScore, p_limit: 8 });
  if (error) return failure(error);
  const rows = (data ?? []) as unknown[];
  if (!rows.every((r) => matches(r, { concept_id: "string", display: "string", matched_on: "string" }))) return { ok: false, reason: "failed" };
  const typed = rows as { concept_id: string; display: string; patient_description: string | null; matched_on: string; clarifies_display: string | null }[];
  const matchesOut = typed.map((r) => ({
    conceptId: r.concept_id, display: r.display, description: r.patient_description ?? null, matchedOn: r.matched_on,
    clarifiesDisplay: r.clarifies_display ?? null,
  }));
  return { ok: true, data: { matches: matchesOut, clarifying: matchesOut.find((m) => m.matchedOn === "clarify")?.clarifiesDisplay ?? null } };
}

export interface PlaceRow {
  serviceId: string;
  branchListingId: string;
  providerName: string;
  branchName: string;
  address: string;
  neighbourhood: string | null;
  town: string | null;
  lga: string | null;
  state: string;
  phone: string;
  latitude: number;
  longitude: number;
  resultGroup: "partner" | "eligible" | "unconfirmed";
  isPartner: boolean;
  byAppointment: boolean;
  performedElsewhere: boolean;
  preparationNote: string | null;
}

type SearchConfig = { page_size: number; partner_band_km: number };

/** total is null when the page is past the end (no row carries the count); it is never reported as 0 then. */
export async function findPlaces(input: { conceptId: string; state: string; lga?: string; page?: number }): Promise<
  DirectoryRead<{ rows: PlaceRow[]; total: number | null }>
> {
  const state = input.state.trim();
  const lga = input.lga?.trim() ?? "";
  const page = input.page ?? 0;
  if (state.length < 2 || state.length > 60 || lga.length > 80) return { ok: false, reason: "invalid" };
  const cfg = getProposedConfig<SearchConfig>("directory.diagnostic_search").value;
  const { data, error } = await supabase.rpc("search_diagnostic_services", {
    p_concept_id: input.conceptId,
    p_lat: null as unknown as number,
    p_lng: null as unknown as number,
    p_radius_km: null as unknown as number,
    p_state: state,
    p_lga: (lga.length >= 2 ? lga : null) as unknown as string,
    // Otherwise-verified branches still awaiting confirmation are shown, labelled, below every eligible one (design §10, as web).
    p_include_unconfirmed: true,
    p_partner_band_km: cfg.partner_band_km,
    p_limit: cfg.page_size,
    p_offset: page * cfg.page_size,
  });
  if (error) return failure(error);
  const rows = (data ?? []) as unknown[];
  const shape: Shape = {
    service_id: "string", branch_listing_id: "string", provider_name: "string", branch_name: "string", address: "string",
    state: "string", phone: "string", latitude: "number", longitude: "number", result_group: "string", is_partner: "boolean",
    availability: "string", appointment_required: "boolean", performed_elsewhere: "boolean", total_count: "number",
    neighbourhood: "string?", town: "string?", lga: "string?", preparation_note: "string?",
  };
  if (!rows.every((r) => matches(r, shape))) return { ok: false, reason: "failed" };
  const typed = rows as Record<string, never>[];
  if (!typed.every((r) => ["partner", "eligible", "unconfirmed"].includes(r.result_group))) return { ok: false, reason: "failed" };
  return {
    ok: true,
    data: {
      total: typed[0]?.total_count ?? (page === 0 ? 0 : null),
      rows: typed.map((r) => ({
        serviceId: r.service_id, branchListingId: r.branch_listing_id, providerName: r.provider_name, branchName: r.branch_name,
        address: r.address, neighbourhood: r.neighbourhood ?? null, town: r.town ?? null, lga: r.lga ?? null, state: r.state,
        phone: r.phone, latitude: r.latitude, longitude: r.longitude, resultGroup: r.result_group, isPartner: r.is_partner,
        byAppointment: r.appointment_required || r.availability === "by_appointment", performedElsewhere: r.performed_elsewhere,
        preparationNote: r.preparation_note ?? null,
      })),
    },
  };
}

export interface BranchProfile {
  providerName: string;
  branchName: string;
  address: string;
  neighbourhood: string | null;
  town: string | null;
  lga: string | null;
  state: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  latitude: number | null;
  longitude: number | null;
  locationCheckedOn: string | null;
  isPartner: boolean;
  services: { conceptId: string; test: string; byAppointment: boolean; performedElsewhere: boolean; preparationNote: string | null }[];
}

export async function loadBranchProfile(branchListingId: string): Promise<DirectoryRead<BranchProfile | null>> {
  const { data, error } = await rpcUntyped("diagnostic_branch_profile", { p_branch_listing_id: branchListingId });
  if (error) return failure(error);
  if (data === null) return { ok: true, data: null };
  const shape: Shape = {
    provider_name: "string", branch_name: "string", address: "string", neighbourhood: "string?", town: "string?", lga: "string?",
    state: "string", phone: "string?", email: "string?", website: "string?", latitude: "number?", longitude: "number?",
    location_checked_on: "string?", is_partner: "boolean",
  };
  const d = data as Record<string, never>;
  if (!matches(data, shape) || !Array.isArray(d.services)) return { ok: false, reason: "failed" };
  const services = d.services as unknown[];
  const serviceShape: Shape = {
    concept_id: "string", test: "string", availability: "string", appointment_required: "boolean", performed_elsewhere: "boolean",
    preparation_note: "string?",
  };
  if (!services.every((s) => matches(s, serviceShape))) return { ok: false, reason: "failed" };
  return {
    ok: true,
    data: {
      providerName: d.provider_name, branchName: d.branch_name, address: d.address, neighbourhood: d.neighbourhood, town: d.town,
      lga: d.lga, state: d.state, phone: d.phone, email: d.email, website: d.website, latitude: d.latitude, longitude: d.longitude,
      locationCheckedOn: d.location_checked_on, isPartner: d.is_partner,
      services: (services as Record<string, never>[]).map((s) => ({
        conceptId: s.concept_id, test: s.test, byAppointment: s.appointment_required || s.availability === "by_appointment",
        performedElsewhere: s.performed_elsewhere, preparationNote: s.preparation_note,
      })),
    },
  };
}

/** Directions link, only when the branch has a checked location. */
export function directionsUrl(lat: number | null, lng: number | null): string | null {
  return lat !== null && lng !== null ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : null;
}
