import { supabase } from "../supabase";
import type { RouteState } from "./route-recorder";
import { toGeoJson } from "./route-recorder";

/**
 * The ONLY place in the app that touches the private routes table (S48b, spec 5.7). Owner-only by the database: three policies (own select,
 * own insert, own delete), no staff or caregiver read, no update. This file deliberately has no share, export, send, map or upload function, and
 * a scan test (apps/web/src/lib/activity/routes-private.test.ts) fails if one appears here or anywhere else.
 *
 * Recording is open only when the go-live guard `private_route_recording` is on AND the person's own switch is on; the database enforces both
 * on insert, and `loadRouteRecordingStatus` only decides whether the card is shown at all.
 */
export async function loadRouteRecordingStatus(): Promise<boolean> {
  const { data, error } = await supabase.rpc("route_recording_status");
  return !error && data === true;
}

/** Saves a finished route for the signed-in owner. Returns a plain message on failure; nothing is kept elsewhere. */
export async function saveRoute(patientId: string, organisationId: string, state: RouteState, activityLogEntryId: string | null): Promise<{ error?: string }> {
  const geojson = toGeoJson(state);
  if (!geojson) return { error: "That route was too short to keep." };
  const { error } = await supabase.from("activity_routes").insert({
    organisation_id: organisationId,
    patient_id: patientId,
    activity_log_entry_id: activityLogEntryId,
    route_geojson: geojson,
  });
  return error ? { error: error.message } : {};
}

export interface MyRoute {
  readonly id: string;
  readonly createdAt: string;
  readonly points: number;
}

export async function listMyRoutes(): Promise<MyRoute[]> {
  const { data, error } = await supabase.from("activity_routes").select("id, created_at, route_geojson").order("created_at", { ascending: false }).limit(20);
  if (error || !data) return [];
  return data.map((r) => {
    const coords = (r.route_geojson as { coordinates?: unknown } | null)?.coordinates;
    return { id: r.id, createdAt: r.created_at, points: Array.isArray(coords) ? coords.length : 0 };
  });
}

export async function deleteMyRoute(id: string): Promise<{ error?: string }> {
  const { error } = await supabase.from("activity_routes").delete().eq("id", id);
  return error ? { error: error.message } : {};
}
