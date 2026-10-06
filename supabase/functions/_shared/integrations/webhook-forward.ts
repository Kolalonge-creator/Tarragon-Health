import type { FetchLike } from "./http.ts";

/**
 * One Zoom event subscription for everything (S21 follow-up, OQ-160). Zoom allows a single event-subscription URL per app. The older
 * `zoom-webhook` edge function already owns it (meeting started and ended for the older visit flow), and the consultation presence route
 * (`/api/zoom/webhook`) needs the participant events. So the function stays the one receiver and hands the participant events to the
 * route, byte for byte with Zoom's two signature headers, and the route verifies the signature itself with the same secret: the
 * function is trusted for nothing it forwards.
 */
const PRESENCE_EVENTS: ReadonlySet<string> = new Set(["meeting.participant_joined", "meeting.participant_joined_waiting_room", "meeting.participant_left"]);

export const isPresenceEvent = (name: unknown): boolean => typeof name === "string" && PRESENCE_EVENTS.has(name);

/**
 * forwarded: the route answered (2xx, or a 4xx it will always answer the same way: nothing to retry).
 * not_configured: no app address is set, so there is nowhere to send it (presence is simply off).
 * retry: the route could not be reached or failed (5xx): ask Zoom to send it again.
 */
export type ForwardOutcome = "forwarded" | "not_configured" | "retry";

export interface ZoomSignatureHeaders {
  readonly timestamp: string | null;
  readonly signature: string | null;
}

export async function forwardPresenceEvent(
  fetch: FetchLike,
  appBaseUrl: string | undefined,
  rawBody: string,
  headers: ZoomSignatureHeaders,
  timeoutMs = 8_000,
): Promise<ForwardOutcome> {
  if (!appBaseUrl || !/^https?:\/\/[^\s/]+/.test(appBaseUrl)) return "not_configured";
  // Trailing slashes are stripped with a loop, not a regular expression (a backtracking pattern on an address is what code scanning flags).
  let base = appBaseUrl;
  while (base.endsWith("/")) base = base.slice(0, -1);
  const url = `${base}/api/zoom/webhook`;
  const sent: Record<string, string> = { "content-type": "application/json" };
  if (headers.timestamp) sent["x-zm-request-timestamp"] = headers.timestamp;
  if (headers.signature) sent["x-zm-signature"] = headers.signature;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "POST", headers: sent, body: rawBody, signal: controller.signal });
    return res.status >= 500 ? "retry" : "forwarded";
  } catch {
    return "retry";
  } finally {
    clearTimeout(timer);
  }
}
