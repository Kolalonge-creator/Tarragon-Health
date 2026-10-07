import { describe, expect, it } from "@jest/globals";
import { forwardPresenceEvent, isPresenceEvent, type FetchLike } from "../../../supabase/functions/_shared/integrations/index.ts";

const reply = (status: number) => ({ status, ok: status >= 200 && status < 300, text: async () => "" });
const headers = { timestamp: "1800000000", signature: "v0=abc" };

describe("which events are presence events", () => {
  it("is the three participant events and nothing else", () => {
    expect(isPresenceEvent("meeting.participant_joined")).toBe(true);
    expect(isPresenceEvent("meeting.participant_joined_waiting_room")).toBe(true);
    expect(isPresenceEvent("meeting.participant_left")).toBe(true);
    for (const other of ["meeting.started", "meeting.ended", "endpoint.url_validation", "", undefined, 5, null]) expect(isPresenceEvent(other)).toBe(false);
  });
});

describe("forwarding a participant event to the presence route", () => {
  it("sends the body and Zoom's two signature headers unchanged to /api/zoom/webhook (a trailing slash on the address does not matter)", async () => {
    const seen: { url: string; init: Parameters<FetchLike>[1] }[] = [];
    const fetch: FetchLike = async (url, init) => (seen.push({ url, init }), reply(200));
    expect(await forwardPresenceEvent(fetch, "https://app.example.test/", '{"event":"x"}', headers)).toBe("forwarded");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("https://app.example.test/api/zoom/webhook");
    expect(seen[0]?.init).toMatchObject({ method: "POST", body: '{"event":"x"}' });
    expect(seen[0]?.init.headers).toEqual({ "content-type": "application/json", "x-zm-request-timestamp": "1800000000", "x-zm-signature": "v0=abc" });
  });

  it("leaves out a signature header Zoom did not send, so the route refuses it rather than being given an empty one", async () => {
    const seen: Record<string, string>[] = [];
    const fetch: FetchLike = async (_u, init) => (seen.push(init.headers), reply(200));
    await forwardPresenceEvent(fetch, "http://localhost:3000", "{}", { timestamp: null, signature: null });
    expect(seen[0]).toEqual({ "content-type": "application/json" });
  });

  it("does not forward anywhere without a usable app address (presence is off)", async () => {
    const fetch: FetchLike = async () => {
      throw new Error("must not be called");
    };
    for (const address of [undefined, "", "app.example.test", "ftp://x", "https://"]) expect(await forwardPresenceEvent(fetch, address, "{}", headers)).toBe("not_configured");
  });

  it("asks Zoom to retry when the route fails or cannot be reached, but not when it refuses (4xx always answers the same)", async () => {
    expect(await forwardPresenceEvent(async () => reply(500), "https://a.test", "{}", headers)).toBe("retry");
    expect(await forwardPresenceEvent(async () => reply(503), "https://a.test", "{}", headers)).toBe("retry");
    expect(await forwardPresenceEvent(async () => reply(401), "https://a.test", "{}", headers)).toBe("forwarded");
    expect(await forwardPresenceEvent(async () => reply(200), "https://a.test", "{}", headers)).toBe("forwarded");
    expect(
      await forwardPresenceEvent(async () => {
        throw new TypeError("fetch failed");
      }, "https://a.test", "{}", headers),
    ).toBe("retry");
  });

  it("gives up after the timeout instead of holding Zoom's request open", async () => {
    const fetch: FetchLike = (_u, init) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    expect(await forwardPresenceEvent(fetch, "https://a.test", "{}", headers, 10)).toBe("retry");
  });
});
