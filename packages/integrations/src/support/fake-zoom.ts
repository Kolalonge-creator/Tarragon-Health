import { hmacHex } from "../../../../supabase/functions/_shared/integrations/crypto.ts";
import type { FetchLike } from "../../../../supabase/functions/_shared/integrations/http.ts";

/** Answers with the shapes in Zoom's published REST reference (Server-to-Server OAuth, scheduled meetings). Not Zoom. */
export interface FakeZoom {
  readonly fetch: FetchLike;
  readonly calls: { method: string; path: string; body: Record<string, unknown> | null }[];
  readonly webhookSecret: string;
  readonly clock: { now: number };
  failNextCall(): void;
  signedEvent(event: string, meetingId: string, userName?: string): Promise<{ rawBody: string; headers: Record<string, string> }>;
  forgedEvent(event: string, meetingId: string): Promise<{ rawBody: string; headers: Record<string, string> }>;
}

const reply = (status: number, body: unknown) => ({ status, ok: status >= 200 && status < 300, text: async () => (body === undefined ? "" : JSON.stringify(body)) });

export function createFakeZoom(clock = { now: 1_800_000_000_000 }): FakeZoom {
  const calls: FakeZoom["calls"] = [];
  const meetings = new Map<string, { start_time: string; duration: number }>();
  let failNext = false;
  let seq = 0;
  const webhookSecret = "zoom-secret-token";

  const fetchImpl: FetchLike = async (url, init) => {
    if (failNext) {
      failNext = false;
      throw new TypeError("fetch failed");
    }
    const u = new URL(url);
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ method: init.method, path: u.pathname, body });
    if (u.hostname === "zoom.us" && u.pathname === "/oauth/token") {
      return init.headers["Authorization"]?.startsWith("Basic ") ? reply(200, { access_token: `tok_${(seq += 1)}`, expires_in: 3600 }) : reply(401, { reason: "Invalid client" });
    }
    if (!init.headers["Authorization"]?.startsWith("Bearer tok_")) return reply(401, { message: "Invalid access token" });
    if (init.method === "POST" && u.pathname === "/v2/users/me/meetings") {
      seq += 1;
      const id = String(81_000_000_000 + seq);
      meetings.set(id, { start_time: body?.["start_time"] as string, duration: body?.["duration"] as number });
      return reply(201, { id: Number(id), join_url: `https://zoom.example/j/${id}`, ...meetings.get(id) });
    }
    const m = /^\/v2\/meetings\/(\d+)(\/status)?$/.exec(u.pathname);
    if (m) {
      const id = m[1]!;
      const meeting = meetings.get(id);
      if (!meeting) return reply(404, { code: 3001, message: "Meeting does not exist" });
      if (init.method === "GET") return reply(200, { id: Number(id), ...meeting });
      if (init.method === "PUT") return reply(204, undefined);
      if (init.method === "DELETE") {
        meetings.delete(id);
        return reply(204, undefined);
      }
    }
    return reply(404, { message: "Not found" });
  };

  const sign = async (raw: string, ts: string) => `v0=${await hmacHex("SHA-256", webhookSecret, `v0:${ts}:${raw}`)}`;
  const body = (event: string, meetingId: string, userName?: string) =>
    JSON.stringify({ event, event_ts: clock.now, payload: { object: { id: meetingId, ...(userName ? { participant: { user_name: userName } } : {}) } } });

  return {
    fetch: fetchImpl,
    calls,
    webhookSecret,
    clock,
    failNextCall() {
      failNext = true;
    },
    async signedEvent(event, meetingId, userName) {
      const rawBody = body(event, meetingId, userName);
      const ts = String(clock.now);
      return { rawBody, headers: { "x-zm-request-timestamp": ts, "x-zm-signature": await sign(rawBody, ts) } };
    },
    async forgedEvent(event, meetingId) {
      const rawBody = body(event, meetingId);
      return { rawBody, headers: { "x-zm-request-timestamp": String(clock.now), "x-zm-signature": `v0=${"0".repeat(64)}` } };
    },
  };
}
