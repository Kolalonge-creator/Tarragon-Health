import { constantTimeEqual, hmacHex, signJwtHs256 } from "./crypto.ts";
import { isUuid } from "./ids.ts";
import { asObject, httpJson, type FetchLike } from "./http.ts";
import { fail, ok, type ProviderResult } from "./result.ts";
import { asVideoRole, MAX_TOKEN_TTL_SECONDS, type DialInNumber, type VideoEvent, type VideoProvider } from "./video.ts";

/**
 * Zoom adapter for `VideoProvider` (skeleton, S14; OQ-22 decided: a Zoom adapter and a mock, a second vendor later).
 * Endpoints follow Zoom's published REST and Meeting SDK documentation; none of it has run against a live Zoom account
 * from this code, so S21 re-checks each call. The live visit path in `apps/web/src/lib/zoom` is untouched.
 *
 * Zoom specifics worth knowing:
 * - Rooms are scheduled meetings with the waiting room on and join-before-host off. The topic is a fixed neutral string.
 * - A join token is a Meeting SDK signature (HS256 JWT): role 1 (host) for a clinician, 0 for everyone else.
 * - Zoom takes a participant's display label from the client SDK, not from the token. The app joins with the role word
 *   ("patient", "clinician") as the label so no name reaches Zoom, but a label is chosen by the client and proves nothing: who
 *   actually entered is proved by the `customerKey` the server issues (see consultation-call.ts).
 * - Zoom's webhooks carry presence and meeting end, but not connection quality. Quality samples come from the client
 *   SDK on the device and are handed to `subscribe` handlers by the app.
 */
export interface ZoomConfig {
  readonly accountId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /** Meeting SDK keys. Only `joinToken` needs them; the link-based flow (S21) does not, so they are optional. */
  readonly sdkKey?: string;
  readonly sdkSecret?: string;
  /** The "Secret Token" from the Zoom app's Feature page, used to verify webhooks. */
  readonly webhookSecretToken?: string;
  readonly fetch: FetchLike;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly apiBase?: string;
  readonly oauthUrl?: string;
}

const TOPIC = "Tarragon consultation";
/** A signed webhook older (or newer) than this is refused, so a captured one cannot be replayed later. Zoom advises about five minutes. */
const WEBHOOK_TOLERANCE_MS = 5 * 60_000;

export function createZoomVideo(config: ZoomConfig): VideoProvider {
  const now = config.now ?? (() => Date.now());
  const deps = { fetch: config.fetch, timeoutMs: config.timeoutMs ?? 10_000 };
  const api = config.apiBase ?? "https://api.zoom.us/v2";
  const oauthUrl = config.oauthUrl ?? "https://zoom.us/oauth/token";
  const handlers = new Map<string, Set<(e: VideoEvent) => void>>();
  let cached: { token: string; expiresAtMs: number } | null = null;

  async function accessToken(): Promise<ProviderResult<string>> {
    if (cached && cached.expiresAtMs > now()) return ok(cached.token);
    const res = await httpJson(deps, {
      url: `${oauthUrl}?grant_type=account_credentials&account_id=${encodeURIComponent(config.accountId)}`,
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}` },
    });
    if (!res.ok) return res;
    const d = asObject(res.data);
    const token = d?.["access_token"];
    if (typeof token !== "string" || token.length === 0) return fail("bad_response", "Zoom sent an unexpected token reply");
    const expiresIn = typeof d?.["expires_in"] === "number" ? d["expires_in"] : 3600;
    // Refresh a little early rather than racing the real expiry.
    cached = { token, expiresAtMs: now() + Math.max(expiresIn - 60, 0) * 1000 };
    return ok(token);
  }

  async function call(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<ProviderResult<unknown>> {
    const token = await accessToken();
    if (!token.ok) return token;
    return httpJson(deps, { url: `${api}${path}`, method, headers: { Authorization: `Bearer ${token.data}` }, body });
  }

  const meetingEnd = (d: Record<string, unknown> | null): number | null => {
    const start = typeof d?.["start_time"] === "string" ? Date.parse(d["start_time"]) : Number.NaN;
    const minutes = typeof d?.["duration"] === "number" ? d["duration"] : Number.NaN;
    return Number.isFinite(start) && Number.isFinite(minutes) ? start + minutes * 60_000 : null;
  };

  return {
    name: "zoom",
    isMock: false,

    async createRoom(input) {
      if (!isUuid(input.encounterRef)) return fail("invalid_input", "Encounter reference must be an opaque uuid");
      const startMs = now();
      if (!Number.isFinite(input.expiresAtMs) || input.expiresAtMs <= startMs) return fail("invalid_input", "Room expiry must be in the future");
      const duration = Math.max(1, Math.ceil((input.expiresAtMs - startMs) / 60_000));
      const res = await call("POST", "/users/me/meetings", {
        topic: TOPIC,
        type: 2,
        start_time: new Date(startMs).toISOString(),
        duration,
        timezone: "Africa/Lagos",
        settings: { join_before_host: false, waiting_room: true, host_video: true, participant_video: true, mute_upon_entry: false, auto_recording: "none", audio: "both", global_dial_in_countries: ["NG"] },
      });
      if (!res.ok) return res;
      const id = asObject(res.data)?.["id"];
      if (typeof id !== "number" && typeof id !== "string") return fail("bad_response", "Zoom sent an unexpected meeting reply");
      return ok({ roomId: String(id), expiresAtMs: startMs + duration * 60_000, recording: "off" });
    },

    async joinToken(input) {
      if (!config.sdkKey || !config.sdkSecret) return fail("not_configured", "Meeting SDK keys are not set", false);
      if (!isUuid(input.identity)) return fail("invalid_input", "Identity must be an opaque uuid");
      if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds <= 0 || input.ttlSeconds > MAX_TOKEN_TTL_SECONDS) {
        return fail("invalid_input", "Token lifetime is out of range");
      }
      if (!/^\d{9,12}$/.test(input.roomId)) return fail("not_found", "No such room", false);
      const meeting = await call("GET", `/meetings/${input.roomId}`);
      if (!meeting.ok) return meeting;
      const d = asObject(meeting.data);
      const endsAtMs = meetingEnd(d);
      if (endsAtMs === null) return fail("bad_response", "Zoom sent an unexpected meeting reply");
      if (endsAtMs <= now()) return fail("conflict", "Room is closed", false);
      // Zoom asks for an issue time a little in the past so a device clock that runs slow is still accepted.
      const iat = Math.floor(now() / 1000) - 30;
      const expiresAtMs = Math.min(now() + input.ttlSeconds * 1000, endsAtMs);
      const exp = Math.floor(expiresAtMs / 1000);
      const sdkKey = config.sdkKey;
      const token = await signJwtHs256(config.sdkSecret, {
        appKey: sdkKey,
        sdkKey,
        mn: input.roomId,
        role: input.role === "clinician" ? 1 : 0,
        iat,
        exp,
        tokenExp: exp,
      });
      // The web SDK asks for the room's passcode on join. It is in the meeting we just read, never stored.
      const pass = d?.["password"];
      const password = typeof pass === "string" && pass.length > 0 ? pass : undefined;
      if (input.role !== "clinician") return ok({ token, expiresAtMs, ...(password ? { password } : {}) });
      // The clinician hosts the room (the meeting is owned by the service account), and an SDK host needs the owner's start key.
      // It lasts as long as the token and no longer, and is only ever returned for the clinician role.
      const zak = await call("GET", `/users/me/token?type=zak&ttl=${Math.max(1, Math.ceil((expiresAtMs - now()) / 1000))}`);
      if (!zak.ok) return zak;
      const zakToken = asObject(zak.data)?.["token"];
      if (typeof zakToken !== "string" || zakToken.length === 0) return fail("bad_response", "Zoom sent an unexpected host key reply");
      return ok({ token, expiresAtMs, zak: zakToken, ...(password ? { password } : {}) });
    },

    async joinLink(input) {
      if (!/^\d{9,12}$/.test(input.roomId)) return fail("not_found", "No such room", false);
      const meeting = await call("GET", `/meetings/${input.roomId}`);
      if (!meeting.ok) return meeting;
      const d = asObject(meeting.data);
      const endsAtMs = meetingEnd(d);
      if (endsAtMs === null) return fail("bad_response", "Zoom sent an unexpected meeting reply");
      if (endsAtMs <= now()) return fail("conflict", "Room is closed", false);
      // The host link carries a start key, so only a clinician is ever given it.
      const url = d?.[input.role === "clinician" ? "start_url" : "join_url"];
      if (typeof url !== "string" || !url.startsWith("https://")) return fail("bad_response", "Zoom sent an unexpected meeting reply");
      // A plain Zoom link cannot keep a camera off, so audio-only is guidance the app gives, not something Zoom enforces.
      return ok({ url, expiresAtMs: endsAtMs, mediaMode: input.mediaMode, audioOnlyEnforced: false });
    },

    async dialIn(input) {
      if (!/^\d{9,12}$/.test(input.roomId)) return fail("not_found", "No such room", false);
      if (!/^[A-Z]{2}$/.test(input.country)) return fail("invalid_input", "Country must be a two-letter code");
      const meeting = await call("GET", `/meetings/${input.roomId}`);
      if (!meeting.ok) return meeting;
      const d = asObject(meeting.data);
      const endsAtMs = meetingEnd(d);
      if (endsAtMs === null) return fail("bad_response", "Zoom sent an unexpected meeting reply");
      if (endsAtMs <= now()) return fail("conflict", "Room is closed", false);
      const listed = asObject(d?.["settings"])?.["global_dial_in_numbers"];
      const numbers: DialInNumber[] = [];
      for (const raw of Array.isArray(listed) ? listed : []) {
        const n = asObject(raw);
        const number = n?.["number"];
        const type = n?.["type"];
        if (n?.["country"] !== input.country || typeof number !== "string" || number.trim().length === 0) continue;
        if (type !== "toll" && type !== "tollfree") continue;
        numbers.push({ country: input.country, number: number.trim(), city: typeof n["city"] === "string" && n["city"].length > 0 ? n["city"] : null, kind: type === "toll" ? "toll" : "toll_free" });
      }
      // Nothing for this country is a real answer, not an error: the account may not carry Nigerian numbers.
      if (numbers.length === 0) return fail("not_found", "No dial-in number for this country", false);
      // A phone caller types digits, so it is the numeric phone passcode, never the web passcode.
      const pass = d?.["pstn_password"];
      return ok({ numbers, meetingId: input.roomId, passcode: typeof pass === "string" && /^\d{4,10}$/.test(pass) ? pass : null, expiresAtMs: endsAtMs });
    },

    async endRoom(roomId, actingRole) {
      if (actingRole !== "clinician") return fail("unauthorized", "Only a clinician can end a consultation", false);
      if (!/^\d{9,12}$/.test(roomId)) return fail("not_found", "No such room", false);
      // Ending a Zoom meeting does not stop people rejoining a scheduled one, so it is ended and then deleted: the room is
      // closed for good. A meeting that was never started refuses "end"; that is fine, the delete is what matters.
      const ended = await call("PUT", `/meetings/${roomId}/status`, { action: "end" });
      if (!ended.ok && (ended.error.retryable || ended.error.code === "unauthorized")) return ended;
      const removed = await call("DELETE", `/meetings/${roomId}`);
      // Already gone is the same outcome as just deleted, so ending twice is safe.
      // The meeting may still be winding down, so a refused delete is worth repeating: until it succeeds the room can be rejoined.
      if (!removed.ok && removed.error.code !== "not_found") return fail(removed.error.code, "Meeting ended but could not be closed yet", true);
      return ok({ endedAtMs: now() });
    },

    subscribe(roomId, handler) {
      const set = handlers.get(roomId) ?? new Set();
      set.add(handler);
      handlers.set(roomId, set);
      return () => {
        set.delete(handler);
      };
    },

    async parseWebhook(rawBody, headers, nowMs) {
      if (!config.webhookSecretToken) return fail("not_configured", "Webhook secret is not set", false);
      const timestamp = headers["x-zm-request-timestamp"];
      const signature = headers["x-zm-signature"];
      if (!timestamp || !signature) return fail("invalid_signature", "Signature is missing", false);
      const expected = `v0=${await hmacHex("SHA-256", config.webhookSecretToken, `v0:${timestamp}:${rawBody}`)}`;
      if (!constantTimeEqual(signature, expected)) return fail("invalid_signature", "Signature does not match", false);
      // The timestamp is part of what was signed, so once the signature holds it can be trusted: refuse a stale or far-future one (seconds since the epoch).
      const sentAtMs = /^\d{1,12}$/.test(timestamp) ? Number(timestamp) * 1000 : Number.NaN;
      if (!Number.isFinite(sentAtMs) || Math.abs(nowMs - sentAtMs) > WEBHOOK_TOLERANCE_MS) return fail("invalid_signature", "Timestamp is outside the allowed window", false);
      let json: unknown;
      try {
        json = JSON.parse(rawBody);
      } catch {
        return fail("bad_response", "Webhook body is not JSON", false);
      }
      const root = asObject(json);
      const object = asObject(asObject(root?.["payload"])?.["object"]);
      const meetingId = object?.["id"];
      if (typeof root?.["event"] !== "string" || (typeof meetingId !== "number" && typeof meetingId !== "string")) return ok(null);
      const roomId = String(meetingId);
      const atMs = typeof root["event_ts"] === "number" ? root["event_ts"] : nowMs;
      if (root["event"] === "meeting.ended") return ok({ kind: "room_ended", roomId, atMs });
      const participant = asObject(object?.["participant"]);
      // The label is chosen by the person, so it is a hint. The key we issued (`customer_key`, "the participant's SDK identifier" in
      // Zoom's webhook reference) is what the caller verifies; a person who joined by plain link or by phone has none.
      const key = participant?.["customer_key"];
      const customerKey = typeof key === "string" && key.length > 0 ? key : undefined;
      const role = asVideoRole(participant?.["user_name"]) ?? (customerKey ? "observer" : null);
      const withKey = customerKey ? { customerKey } : {};
      // A person sitting in the waiting room has arrived (the room has a waiting room on): that is what "joined" has always meant for the
      // no-show rules, so the waiting-room event counts too. Admission fires `meeting.participant_joined` again, which changes nothing.
      if ((root["event"] === "meeting.participant_joined" || root["event"] === "meeting.participant_joined_waiting_room") && role) return ok({ kind: "participant_joined", roomId, role, atMs, ...withKey });
      if (root["event"] === "meeting.participant_left" && role) return ok({ kind: "participant_left", roomId, role, atMs, ...withKey });
      return ok(null);
    },
  };
}
