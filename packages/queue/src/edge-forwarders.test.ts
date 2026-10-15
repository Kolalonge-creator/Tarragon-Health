// S16-S20: the queue-next and queue-handback edge functions are deployed but nothing in the repository calls them. They were kept
// (deleting a deployed function's source would leave the live one undeployable without an owner step) and are now tested, so the
// surface that exists is the surface that is proven: they forward the caller's own token to the database function and decide nothing.
import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";

type Handler = (req: Request) => Promise<Response>;
const rpc = jest.fn<(name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>>();
const createClient = jest.fn((..._args: unknown[]) => ({ rpc }));
const handlers: Record<string, Handler> = {};
let current = "";

(globalThis as unknown as { Deno: unknown }).Deno = {
  env: { get: (k: string) => (k === "SUPABASE_URL" ? "http://db.invalid" : k === "SUPABASE_ANON_KEY" ? "anon-key" : undefined) },
  serve: (h: Handler) => { handlers[current] = h; },
};

jest.unstable_mockModule("jsr:@supabase/supabase-js@2", () => ({ createClient }), { virtual: true } as never);

const UUID = "11111111-1111-4111-8111-111111111111";
const post = (body: unknown, auth: string | null = "Bearer user-jwt"): Request =>
  new Request("http://fn.invalid", { method: "POST", headers: auth ? { Authorization: auth } : {}, body: typeof body === "string" ? body : JSON.stringify(body) });

beforeAll(async () => {
  current = "queue-next";
  await import("../../../supabase/functions/queue-next/index.ts");
  current = "queue-handback";
  await import("../../../supabase/functions/queue-handback/index.ts");
});
beforeEach(() => { rpc.mockReset(); createClient.mockClear(); });

describe("queue-next", () => {
  it("only accepts POST and a bearer token", async () => {
    expect((await handlers["queue-next"]!(new Request("http://fn.invalid", { method: "GET" }))).status).toBe(405);
    expect((await handlers["queue-next"]!(post({}, null))).status).toBe(401);
    expect((await handlers["queue-next"]!(post({}, "Basic abc"))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("forwards the caller's own token and returns the database's answer untouched", async () => {
    rpc.mockResolvedValue({ data: { already_claimed: false, task: null, reason: "none_eligible" }, error: null });
    const res = await handlers["queue-next"]!(post({}));
    expect(await res.json()).toEqual({ already_claimed: false, task: null, reason: "none_eligible" });
    expect(rpc).toHaveBeenCalledWith("queue_next");
    expect(JSON.stringify(createClient.mock.calls[0])).toContain("Bearer user-jwt");
    expect(JSON.stringify(createClient.mock.calls[0])).not.toContain("service_role");
  });

  it("maps a database refusal to a status and a stable code, never raw text", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "queue_cooling_off" } });
    const res = await handlers["queue-next"]!(post({}));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "queue_cooling_off" });
    rpc.mockResolvedValue({ data: null, error: { message: "relation \"clinical_tasks\" does not exist" } });
    const res2 = await handlers["queue-next"]!(post({}));
    expect(res2.status).toBe(500);
    expect(await res2.json()).toEqual({ error: "queue_failed" });
  });
});

describe("queue-handback", () => {
  it("only accepts POST and a bearer token, and a readable body with a real task id", async () => {
    expect((await handlers["queue-handback"]!(new Request("http://fn.invalid", { method: "GET" }))).status).toBe(405);
    expect((await handlers["queue-handback"]!(post({ task_id: UUID, reason: "other" }, null))).status).toBe(401);
    expect((await handlers["queue-handback"]!(post("not json"))).status).toBe(400);
    expect((await handlers["queue-handback"]!(post({ task_id: "nope", reason: "other" }))).status).toBe(400);
    expect((await handlers["queue-handback"]!(post({ reason: "other" }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("validates the reason before calling the database", async () => {
    expect((await handlers["queue-handback"]!(post({ task_id: UUID, reason: "bored" }))).status).toBe(422);
    expect((await handlers["queue-handback"]!(post({ task_id: UUID, reason: "other", note: "short" }))).status).toBe(422);
    expect((await handlers["queue-handback"]!(post({ task_id: UUID }))).status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("hands back with the caller's token", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const res = await handlers["queue-handback"]!(post({ task_id: UUID, reason: "needs_information", note: 5 }));
    expect(await res.json()).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("queue_handback", { p_task: UUID, p_reason: "needs_information", p_note: null });
    expect(JSON.stringify(createClient.mock.calls[0])).toContain("Bearer user-jwt");
  });

  it("maps a refusal to a stable code", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "queue_no_claim" } });
    const res = await handlers["queue-handback"]!(post({ task_id: UUID, reason: "outside_competence" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "queue_no_claim" });
  });
});
