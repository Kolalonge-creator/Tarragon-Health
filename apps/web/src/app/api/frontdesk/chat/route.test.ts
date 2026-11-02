import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ChatTurnResult } from "@/lib/frontdesk/chat-service";

const handleChatTurn = jest.fn<(deps: unknown, input: { conversationId: string | null; secretHash: string; text: string; page: string }) => Promise<ChatTurnResult>>();
const rateLimit = jest.fn<(key: string, rule: unknown) => Promise<{ success: boolean; retryAfterSeconds: number }>>();
jest.mock("server-only", () => ({}));
jest.mock("@/lib/frontdesk/chat-service", () => ({ handleChatTurn: (d: unknown, i: never) => handleChatTurn(d, i) }));
jest.mock("@/lib/frontdesk/chat-runtime", () => ({ createChatDeps: () => ({}) }));
jest.mock("@/lib/rate-limit", () => ({ rateLimit: (k: string, r: unknown) => rateLimit(k, r) }));

import { POST } from "./route";

const CONV = "11111111-1111-4111-8111-111111111111";
const SECRET = "s".repeat(43);
const ok = { mode: "chat", conversationId: CONV, reply: "Hello", status: "open", needsContact: false, emergency: false } as const;

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://tarragonhealth.ng/api/frontdesk/chat", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", origin: "https://tarragonhealth.ng", host: "tarragonhealth.ng", ...headers },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  rateLimit.mockResolvedValue({ success: true, retryAfterSeconds: 0 });
  handleChatTurn.mockResolvedValue(ok);
});

describe("chat route: gatekeeping", () => {
  it("accepts JSON only", async () => {
    expect((await POST(post({ message: "hi" }, { "content-type": "text/plain" }))).status).toBe(415);
    expect(handleChatTurn).not.toHaveBeenCalled();
  });
  it("refuses a request with no Origin or a foreign Origin", async () => {
    expect((await POST(post({ message: "hi" }, { origin: "" }))).status).toBe(403);
    expect((await POST(post({ message: "hi" }, { origin: "https://evil.example" }))).status).toBe(403);
    expect(handleChatTurn).not.toHaveBeenCalled();
  });
  it("validates the body: message length, and the id and secret travel together", async () => {
    expect((await POST(post({ message: "" }))).status).toBe(400);
    expect((await POST(post({ message: "x".repeat(1001) }))).status).toBe(400);
    expect((await POST(post({ message: "hi", conversationId: CONV }))).status).toBe(400);
    expect((await POST(post({ message: "hi", secret: SECRET }))).status).toBe(400);
    expect((await POST(post("not json"))).status).toBe(400);
  });
});

describe("chat route: conversation secret", () => {
  it("starts a conversation: generates a secret, passes only its hash on, and returns the secret ONCE", async () => {
    const res = await POST(post({ message: "How much is it?", page: "/pricing" }));
    const json = (await res.json()) as { secret?: string; conversationId: string };
    expect(res.status).toBe(200);
    expect(json.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const input = handleChatTurn.mock.calls[0]![1];
    expect(input.conversationId).toBeNull();
    expect(input.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(input.secretHash).not.toContain(json.secret as string);
  });
  it("continues a conversation: no new secret is issued, and the supplied secret is hashed", async () => {
    const res = await POST(post({ message: "And a refund?", conversationId: CONV, secret: SECRET }));
    expect(((await res.json()) as { secret?: string }).secret).toBeUndefined();
    expect(handleChatTurn.mock.calls[0]![1]).toMatchObject({ conversationId: CONV });
  });
  it("passes the form fallback and errors through with the right status", async () => {
    handleChatTurn.mockResolvedValueOnce({ mode: "form", reason: "spend_cap" });
    expect(await (await POST(post({ message: "hi" }))).json()).toEqual({ mode: "form", reason: "spend_cap" });
    handleChatTurn.mockResolvedValueOnce({ mode: "error", reason: "not_found" });
    expect((await POST(post({ message: "hi", conversationId: CONV, secret: SECRET }))).status).toBe(404);
    handleChatTurn.mockResolvedValueOnce({ mode: "error", reason: "closed" });
    expect((await POST(post({ message: "hi", conversationId: CONV, secret: SECRET }))).status).toBe(409);
  });
});

describe("chat route: limits never block an emergency", () => {
  it("a rate limited ordinary message gets 429 with a retry time", async () => {
    rateLimit.mockResolvedValue({ success: false, retryAfterSeconds: 90 });
    const res = await POST(post({ message: "How much is it?" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("90");
    expect(handleChatTurn).not.toHaveBeenCalled();
  });
  it("a rate limited EMERGENCY message still gets the emergency reply", async () => {
    rateLimit.mockResolvedValue({ success: false, retryAfterSeconds: 90 });
    const res = await POST(post({ message: "I have chest pain" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ emergency: true, status: "emergency", reply: expect.stringMatching(/nearest hospital/) });
  });
  it("an unexpected failure shows the contact form for an ordinary message but still answers an emergency", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    handleChatTurn.mockRejectedValue(new Error("boom"));
    expect(await (await POST(post({ message: "How much is it?" }))).json()).toEqual({ mode: "form", reason: "error" });
    expect(await (await POST(post({ message: "I cannot breathe" }))).json()).toMatchObject({ emergency: true });
    spy.mockRestore();
  });
  it("limits per connection, per day and per conversation", async () => {
    await POST(post({ message: "hi", conversationId: CONV, secret: SECRET }));
    const keys = rateLimit.mock.calls.map((c) => c[0]);
    expect(keys.some((k) => k.startsWith("fd-chat:ip:"))).toBe(true);
    expect(keys.some((k) => k.startsWith("fd-chat:ip-day:"))).toBe(true);
    expect(keys).toContain(`fd-chat:conv:${CONV}`);
  });
});
