import { addFix, EMPTY_ROUTE, type LocationSource, type RouteState } from "./route-recorder";

/**
 * One recording session. The route lives only in memory until the person chooses to save it; stopping or discarding drops it. If the source is
 * missing (no native module yet) or refuses to start, nothing is recorded and the caller is told why.
 */
export interface RouteSession {
  state(): RouteState;
  /** Stops listening and returns what was recorded. */
  stop(): Promise<RouteState>;
  /** Stops listening and forgets everything. */
  discard(): Promise<void>;
}

export type StartResult = { ok: true; session: RouteSession } | { ok: false; reason: "unavailable" | "refused" };

export async function startRouteSession(source: LocationSource | null): Promise<StartResult> {
  if (!source) return { ok: false, reason: "unavailable" };
  let current: RouteState = EMPTY_ROUTE;
  let running = true;
  try {
    await source.start((fix) => {
      if (running) current = addFix(current, fix);
    });
  } catch {
    running = false;
    return { ok: false, reason: "refused" };
  }
  return {
    ok: true,
    session: {
      state: () => current,
      stop: async () => {
        running = false;
        await source.stop().catch(() => undefined);
        return current;
      },
      discard: async () => {
        running = false;
        await source.stop().catch(() => undefined);
        current = EMPTY_ROUTE;
      },
    },
  };
}
