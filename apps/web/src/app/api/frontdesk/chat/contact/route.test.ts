import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ChatTurnResult } from "@/lib/frontdesk/chat-service";

const rpc = jest.fn<(fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: string | null }>>();
const open = jest.fn<(hash: string, page: string, intro: string) => Promise<string>>();
const turn = jest.fn<(c: string, h: string, t: string) => Promise<unknown>>();
const handleChatTurn = jest.fn<(deps: unknown, input: { text: string }) => Promise<ChatTurnResult>>();
const rateLimit = jest.fn<(k: string, r: unknown) => Promise<{ success: boolean; retryAfterSeconds: number }>>();
jest.mock("server-only", () => ({}));
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));
jest.mock("@/lib/frontdesk/raw-db", () => ({ fdRpcData: (_s: unknown, fn: string, a: Record<string, unknown>) => rpc(fn, a) }));
jest.mock("@/lib/frontdesk/chat-db", () => ({ createChatDb: () => ({ open: (h: string, p: string, i: string) => open(h, p, i), turn: (c: string, h: string, t: string) => turn(c, h, t) }) }));
jest.mock("@/lib/frontdesk/chat-service", () => ({ handleChatTurn: (d: unknown, i: { text: string }) => handleChatTurn(d, i) }));
jest.mock("@/lib/frontdesk/chat-runtime", () => ({ createChatDeps: () => ({}) }));
jest.mock("@/lib/rate-limit", () => ({ rateLimit: (k: string, r: unknown) => rateLimit(k, r) }));

import { POST } from "./route";

const CONV = "11111111-1111-4111-8111-111111111111";
const SECRET = "s".repeat(43);

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://tarragonhealth.ng/api/frontdesk/chat/contact", {
    method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", origin: "https://tarragonhealth.ng", host: "tarragonhealth.ng", ...headers },
  });
}
const valid = { name: "Ada Obi", contact: "ada@example.invalid", consent: true };

beforeEach(() => {
  jest.clearAllMocks();
  rateLimit.mockResolvedValue({ success: true, retryAfterSeconds: 0 });
  open.mockResolvedValue(CONV);
  turn.mockResolvedValue({ ok: true });
  rpc.mockImplementation(async (fn) => (fn === "service_fd_chat_capture" ? { data: { captured: true, contact_id: "c1" }, error: null } : { data: { ok: true }, error: null }));
});

describe("contact route", () => {
  it("needs the explicit consent tick (true, not just present)", async () => {
    for (const consent of [false, "true", undefined, 1]) {
      expect((await POST(post({ ...valid, consent, conversationId: CONV, secret: SECRET }))).status).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses a foreign origin, non-JSON, a bad contact, and a lone conversation id", async () => {
    expect((await POST(post(valid, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await POST(post(valid, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await POST(post({ ...valid, contact: "hello" }))).status).toBe(400);
    expect((await POST(post({ ...valid, conversationId: CONV }))).status).toBe(400);
  });
  it("captures on an existing chat using THIS site's wording and version, never text from the request", async () => {
    const res = await POST(post({ ...valid, conversationId: CONV, secret: SECRET, consentWording: "attacker wording" }));
    expect(res.status).toBe(200);
    const [fn, args] = rpc.mock.calls[0]!;
    expect(fn).toBe("service_fd_chat_capture");
    expect(args).toMatchObject({ p_conv: CONV, p_email: "ada@example.invalid", p_phone: null, p_consent: true, p_wording_version: "enquiry-consent-v1" });
    expect(String(args.p_wording)).toMatch(/email me about my enquiry/);
    expect(String(args.p_wording)).not.toMatch(/attacker/);
    expect(args.p_secret_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(open).not.toHaveBeenCalled();
  });
  it("normalises a Nigerian phone number", async () => {
    await POST(post({ ...valid, contact: "0803 123 4567", conversationId: CONV, secret: SECRET }));
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_email: null, p_phone: "+2348031234567" });
  });
  it("form fallback: opens a conversation, stores the message, captures, and opens a form_fallback handoff", async () => {
    const res = await POST(post({ ...valid, message: "Do you do corporate plans?" }));
    const json = (await res.json()) as { captured: boolean; conversationId: string; secret: string };
    expect(json).toMatchObject({ captured: true, conversationId: CONV });
    expect(json.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(open).toHaveBeenCalledTimes(1);
    expect(turn).toHaveBeenCalledWith(CONV, expect.stringMatching(/^[0-9a-f]{64}$/), "Do you do corporate plans?");
    const handoff = rpc.mock.calls.find((c) => c[0] === "service_fd_chat_handoff");
    expect(handoff![1]).toMatchObject({ p_reason: "form_fallback", p_urgency: "normal" });
  });
  it("an emergency typed into the contact form is answered at once, before any limit or capture", async () => {
    rateLimit.mockResolvedValue({ success: false, retryAfterSeconds: 60 });
    handleChatTurn.mockResolvedValue({ mode: "chat", conversationId: CONV, reply: "emergency reply", status: "emergency", needsContact: true, emergency: true });
    const res = await POST(post({ ...valid, message: "my father has collapsed" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ emergency: true, reply: "emergency reply" });
    expect(rpc.mock.calls.some((c) => c[0] === "service_fd_chat_capture")).toBe(false);
  });
  it("still answers an emergency if the chat service fails", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    handleChatTurn.mockRejectedValue(new Error("down"));
    expect(await (await POST(post({ ...valid, message: "I cannot breathe" }))).json()).toMatchObject({ emergency: true, reply: expect.stringMatching(/nearest hospital/) });
    spy.mockRestore();
  });
  it("rate limits ordinary submissions", async () => {
    rateLimit.mockResolvedValue({ success: false, retryAfterSeconds: 120 });
    const res = await POST(post(valid));
    expect(res.status).toBe(429);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a wrong conversation secret is a 404, not a capture", async () => {
    rpc.mockResolvedValue({ data: { captured: false, reason: "not_found" }, error: null });
    expect((await POST(post({ ...valid, conversationId: CONV, secret: SECRET }))).status).toBe(404);
  });
  it("no consent recorded by the database is not reported as saved", async () => {
    rpc.mockResolvedValue({ data: { captured: false, reason: "consent_required" }, error: null });
    expect((await POST(post({ ...valid, conversationId: CONV, secret: SECRET }))).status).toBe(400);
  });
  it("a database failure is a 500, never a false success", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    rpc.mockResolvedValue({ data: null, error: "boom" });
    expect((await POST(post({ ...valid, conversationId: CONV, secret: SECRET }))).status).toBe(500);
    spy.mockRestore();
  });
});
