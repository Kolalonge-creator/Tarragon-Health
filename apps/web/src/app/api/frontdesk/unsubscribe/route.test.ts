import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const fdRpcData = jest.fn<(s: unknown, fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: string | null }>>();
const rateLimit = jest.fn<(k: string, r: unknown) => Promise<{ success: boolean; retryAfterSeconds: number }>>();
jest.mock("server-only", () => ({}));
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));
jest.mock("@/lib/frontdesk/raw-db", () => ({ fdRpcData: (s: unknown, fn: string, a: Record<string, unknown>) => fdRpcData(s, fn, a) }));
jest.mock("@/lib/rate-limit", () => ({ rateLimit: (k: string, r: unknown) => rateLimit(k, r) }));

import { GET, POST } from "./route";

const CONTACT = "11111111-1111-4111-8111-111111111111";
const TOKEN = "b546d680d7b00bf4f89a1166a07d08d8370fcadd";
const url = (c = CONTACT, t = TOKEN) => `https://app.tarragonhealth.ng/api/frontdesk/unsubscribe?c=${c}&t=${t}`;

/** The database decides: valid only for the exact pair; unsubscribes only through the with_token function. */
function database(valid: boolean) {
  fdRpcData.mockImplementation(async (_s, fn, args) => {
    if (fn === "service_fd_unsubscribe_token_valid") return { data: valid && args.p_contact === CONTACT && args.p_token === TOKEN, error: null };
    if (fn === "service_fd_unsubscribe_with_token") return { data: valid && args.p_contact === CONTACT && args.p_token === TOKEN ? "ok" : "invalid", error: null };
    return { data: null, error: "unexpected rpc " + fn };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  rateLimit.mockResolvedValue({ success: true, retryAfterSeconds: 0 });
  database(true);
});

describe("unsubscribe route", () => {
  it("GET shows a confirmation and changes NOTHING (a link scanner must not unsubscribe anyone)", async () => {
    const res = await GET(new Request(url()));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Yes, stop these emails");
    expect(fdRpcData.mock.calls.map((c) => c[1])).toEqual(["service_fd_unsubscribe_token_valid"]);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("POST (the button, or the mail client's one-click request) unsubscribes that contact", async () => {
    const res = await POST(new Request(url(), { method: "POST", body: "List-Unsubscribe=One-Click", headers: { "content-type": "application/x-www-form-urlencoded" } }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("You are unsubscribed");
    expect(fdRpcData).toHaveBeenCalledWith(expect.anything(), "service_fd_unsubscribe_with_token", { p_contact: CONTACT, p_token: TOKEN });
  });

  it("refuses a token the database rejects and unsubscribes nobody", async () => {
    database(false);
    expect((await POST(new Request(url(), { method: "POST" }))).status).toBe(400);
    expect((await GET(new Request(url()))).status).toBe(400);
    expect(fdRpcData.mock.calls.some((c) => c[1] === "service_fd_unsubscribe_with_token")).toBe(false);
  });

  it("refuses missing or malformed parameters without asking the database", async () => {
    expect((await POST(new Request("https://app.tarragonhealth.ng/api/frontdesk/unsubscribe", { method: "POST" }))).status).toBe(400);
    expect((await POST(new Request(url("not-a-uuid", "short"), { method: "POST" }))).status).toBe(400);
    expect(fdRpcData).not.toHaveBeenCalled();
  });

  it("reads the link from a form body when the query is empty (the page's own button)", async () => {
    const form = new FormData();
    form.set("c", CONTACT);
    form.set("t", TOKEN);
    const res = await POST(new Request("https://app.tarragonhealth.ng/api/frontdesk/unsubscribe", { method: "POST", body: form }));
    expect(res.status).toBe(200);
  });

  it("never reports success when the database call failed", async () => {
    fdRpcData.mockImplementation(async (_s, fn) => (fn === "service_fd_unsubscribe_token_valid" ? { data: true, error: null } : { data: null, error: "boom" }));
    const res = await POST(new Request(url(), { method: "POST" }));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("You are unsubscribed");
  });

  it("treats a failed token check as an invalid link, never as valid", async () => {
    fdRpcData.mockResolvedValue({ data: null, error: "boom" });
    expect((await GET(new Request(url()))).status).toBe(400);
  });

  it("rate limits repeated posts", async () => {
    rateLimit.mockResolvedValue({ success: false, retryAfterSeconds: 60 });
    expect((await POST(new Request(url(), { method: "POST" }))).status).toBe(429);
    expect(fdRpcData).not.toHaveBeenCalled();
  });
});
