import { unstable_isUnrecognizedActionError } from "next/navigation";

/**
 * Known browser/runtime fetch-failure message fragments. `fetch()` always
 * rejects with a plain `TypeError` on a network-level failure (no HTTP
 * response at all — DNS failure, connection refused, a dropped connection
 * mid-request), but the message text is not standardised across engines:
 * Chrome/Edge say "Failed to fetch", Firefox says "NetworkError when
 * attempting to fetch resource.", Safari says "Load failed" (or "The network
 * connection was lost." for a connection that drops mid-request rather than
 * never connecting, or "The Internet connection appears to be offline." in
 * airplane mode), and Node's undici (what a Next.js Server Action's own
 * server-to-Supabase call throws under the hood) says "fetch failed" — see
 * vitals-network-error.test.ts, which mocks exactly that message for the
 * server-side case this boundary's client-side counterpart mirrors.
 * Matched as case-insensitive substrings against `error.message`.
 *
 * A close relative of this list already exists in
 * ../auth/auth-error-message.ts (`/network|fetch failed|timeout|timed
 * out|econnrefused/`) for mapping a Supabase auth-provider error to patient
 * copy. Not merged into one shared list on purpose: that one matches
 * arbitrary provider error strings across every auth failure shape (not just
 * a `fetch()` `TypeError`) to pick a full sentence per auth context, which is
 * a different job than this boundary's narrower "is this exception shaped
 * like a dropped connection" check. If you add or change a fetch-failure
 * phrasing here, check whether ../auth/auth-error-message.ts's pattern
 * should learn it too (and vice versa) — the two lists cover overlapping
 * ground and can drift apart silently otherwise.
 */
const FETCH_FAILURE_MESSAGE_FRAGMENTS = [
  "failed to fetch",
  "fetch failed",
  "load failed",
  "networkerror when attempting to fetch",
  "network connection was lost",
  "internet connection appears to be offline",
] as const;

/**
 * Whether an error reaching a route's error.tsx boundary is shaped like a
 * connectivity failure rather than a genuine bug — either the browser never
 * reached the server at all (a `fetch()` rejection, always a `TypeError`),
 * or the client hit a server running a different deployment than its own JS
 * bundle, which Next reports as an `UnrecognizedActionError` for a Server
 * Action the server's current manifest no longer has an entry for (see
 * https://nextjs.org/docs/messages/failed-to-find-server-action).
 *
 * Deliberately does NOT also match Next's other "the server was reached but
 * gave a response I don't understand" case (`server-action-reducer.js`,
 * error code E394, literal message "An unexpected response was received
 * from the server.") even though that can genuinely mean an outage/bad
 * deploy: it fires for the same reason on a session-expired request too
 * (proxy.ts's matcher has no exclusion for a Server Action POST, so an
 * expired session mid-form redirects it to /login's HTML page — neither
 * valid RSC content nor an `x-action-redirect`, which Next reports with this
 * exact literal string). Session expiry is common, everyday behaviour, not
 * an outage, and there is no signal left in the thrown `Error` by the time
 * it reaches this boundary to tell the two apart — confidently saying
 * "connection lost, check your connection" for an expired session would be
 * actively wrong advice more often than it would be right. Falling through
 * to the generic fallback for this case is the safer failure mode.
 *
 * Deliberately narrow in general: a bare `TypeError` with no matching
 * message (e.g. "Cannot read properties of undefined (reading 'x')", a real
 * programming bug) is NOT treated as a connectivity error — only
 * `TypeError`s whose message matches a known fetch-failure phrasing do. This
 * boundary catches every error in the whole (dashboard) segment, not just
 * the narrow `fetchServerAction` catch block Next's own internal, more
 * permissive `checkOfflineError` runs inside of (see
 * node_modules/next/dist/client/components/offline.js), so it cannot afford
 * to be as broad.
 *
 * Known, accepted limitation: a browser exposes the *same* `TypeError`
 * wording for several causes a fetch-failure message can't be told apart
 * from — a CORS block, a CSP/mixed-content block, or a request an extension
 * (ad blocker, privacy tool) intercepted — none of which are a dropped
 * connection. There is no information in the Fetch API to disambiguate
 * these from message text alone. If reports of "connection lost" turn up
 * for users who weren't actually offline, a same-origin CORS/CSP
 * misconfiguration (this class of bug has happened before in this repo) is
 * the first thing to check, not this function's fragment list.
 */
export function isConnectivityError(error: unknown): boolean {
  if (unstable_isUnrecognizedActionError(error)) return true;

  if (!(error instanceof TypeError)) return false;

  const message = error.message.toLowerCase();
  return FETCH_FAILURE_MESSAGE_FRAGMENTS.some((fragment) => message.includes(fragment));
}
