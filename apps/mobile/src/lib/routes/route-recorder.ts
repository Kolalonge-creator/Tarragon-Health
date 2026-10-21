/**
 * Private route recording, the pure part (S48b, spec 5.7). No I/O, no clock, no network.
 *
 * A route is a private record for its owner. Nothing in this folder shares, exports, uploads to a third party, draws on a map or posts a route
 * anywhere: the only thing that ever leaves this module is a GeoJSON object handed to route-store.ts, which writes it to the owner's own row.
 * Decision S48-1: emergency location is a SEPARATE feature and is not built from this.
 */
export interface LocationFix {
  readonly latitude: number;
  readonly longitude: number;
  /** Metres, when the phone says. */
  readonly accuracyM?: number | null;
  readonly atMs: number;
}

/** What the phone must provide. The real source needs the `expo-location` native module (a new EAS build), so none is bundled yet. */
export interface LocationSource {
  start(onFix: (fix: LocationFix) => void): Promise<void>;
  stop(): Promise<void>;
}

/** Technical limits (not clinical values): drop a fix this vague, keep a point only after moving this far, never hold more than this many. */
export const ROUTE_MAX_ACCURACY_M = 50;
export const ROUTE_MIN_STEP_M = 8;
export const ROUTE_MAX_POINTS = 5000;

export interface RouteState {
  readonly points: readonly (readonly [number, number])[];
  readonly distanceM: number;
  readonly startedAtMs: number | null;
  readonly lastAtMs: number | null;
}

export const EMPTY_ROUTE: RouteState = { points: [], distanceM: 0, startedAtMs: null, lastAtMs: null };

const EARTH_RADIUS_M = 6_371_000;

export function haversineM(a: readonly [number, number], b: readonly [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function validFix(f: LocationFix): boolean {
  return (
    Number.isFinite(f.latitude) && Number.isFinite(f.longitude) && Math.abs(f.latitude) <= 90 && Math.abs(f.longitude) <= 180 &&
    Number.isFinite(f.atMs) && (f.accuracyM == null || (Number.isFinite(f.accuracyM) && f.accuracyM <= ROUTE_MAX_ACCURACY_M))
  );
}

/** Folds one fix into the route. A bad, vague or too-close fix is dropped; the route never grows past the cap. */
export function addFix(state: RouteState, fix: LocationFix): RouteState {
  if (!validFix(fix)) return state;
  const point: readonly [number, number] = [fix.longitude, fix.latitude];
  const last = state.points[state.points.length - 1];
  if (!last) return { points: [point], distanceM: 0, startedAtMs: fix.atMs, lastAtMs: fix.atMs };
  if (state.points.length >= ROUTE_MAX_POINTS) return state;
  const step = haversineM(last, point);
  if (step < ROUTE_MIN_STEP_M) return state;
  return { points: [...state.points, point], distanceM: state.distanceM + step, startedAtMs: state.startedAtMs, lastAtMs: fix.atMs };
}

export interface RouteSummary {
  readonly distanceM: number;
  readonly durationMinutes: number;
}

export function summarise(state: RouteState): RouteSummary {
  const ms = state.startedAtMs !== null && state.lastAtMs !== null ? state.lastAtMs - state.startedAtMs : 0;
  return { distanceM: Math.round(state.distanceM), durationMinutes: Math.max(0, Math.round(ms / 60_000)) };
}

/** The stored shape. A route needs at least two points to be worth keeping. */
export function toGeoJson(state: RouteState): { type: "LineString"; coordinates: [number, number][] } | null {
  if (state.points.length < 2) return null;
  return { type: "LineString", coordinates: state.points.map((p) => [p[0], p[1]] as [number, number]) };
}
