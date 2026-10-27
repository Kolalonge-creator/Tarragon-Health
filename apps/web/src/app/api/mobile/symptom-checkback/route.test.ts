import { beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * S59c: the phone's follow-up route. Bearer only; closed (and says so) while the symptom checker guard is closed; reuses the web's
 * answerCheckback rather than a copy; never throws an empty answer at a patient.
 */
const getUser = jest.fn<() => Promise<{ data: { user: { id: string } | null }; error: unknown }>>();
let rows: { data: { id: string }[] | null; error: unknown } = { data: [{ id: "c1" }], error: null };
jest.mock("@/lib/supabase/bearer", () => ({
  createBearerClient: () => ({
    auth: { getUser: () => getUser() },
    from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: async () => rows }) }) }) }),
  }),
}));
const isOpen = jest.fn<() => Promise<boolean>>();
jest.mock("@/lib/symptom-triage/protocol", () => ({ isSymptomCheckerOpen: () => isOpen() }));
const readCheckbackView = jest.fn<(c: unknown, id: string) => Promise<unknown>>();
const answerCheckback = jest.fn<(c: unknown, user: string | null, input: unknown) => Promise<unknown>>();
jest.mock("@/lib/symptom-checkback/answer", () => ({
  readCheckbackView: (c: unknown, id: string) => readCheckbackView(c, id),
  answerCheckback: (c: unknown, u: string | null, i: unknown) => answerCheckback(c, u, i),
}));

import { GET, POST } from "./route";

const req = (method: string, opts: { token?: string | null; url?: string; body?: unknown } = {}) =>
  new Request(opts.url ?? "http://localhost/api/mobile/symptom-checkback", {
    method,
    headers: { ...(opts.token === null ? {} : { authorization: `Bearer ${opts.token ?? "t"}` }), "content-type": "application/json" },
    body: opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body),
  });

beforeEach(() => {
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  isOpen.mockReset();
  isOpen.mockResolvedValue(true);
  readCheckbackView.mockReset();
  answerCheckback.mockReset();
  rows = { data: [{ id: "c1" }], error: null };
});

describe("GET /api/mobile/symptom-checkback", () => {
  it("needs a bearer token and a valid session", async () => {
    expect((await GET(req("GET", { token: null }))).status).toBe(401);
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "bad" } });
    expect((await GET(req("GET"))).status).toBe(401);
  });
  it("lists the follow-ups waiting for an answer, ids only", async () => {
    const body = await (await GET(req("GET"))).json();
    expect(body).toEqual({ open: true, checkbacks: [{ id: "c1" }] });
  });
  it("is closed, and says so, while the symptom checker guard is closed (fails closed too)", async () => {
    isOpen.mockResolvedValue(false);
    expect(await (await GET(req("GET"))).json()).toEqual({ open: false, checkbacks: [], view: null });
    isOpen.mockRejectedValue(new Error("down"));
    expect(await (await GET(req("GET"))).json()).toEqual({ open: false, checkbacks: [], view: null });
    expect(readCheckbackView).not.toHaveBeenCalled();
  });
  it("a failed read of the list reads as closed, never as an empty all-clear with open: true", async () => {
    rows = { data: null, error: { message: "x" } };
    expect(await (await GET(req("GET"))).json()).toMatchObject({ open: false });
  });
  it("returns one follow-up when asked for it by id", async () => {
    readCheckbackView.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" });
    const body = await (await GET(req("GET", { url: "http://localhost/api/mobile/symptom-checkback?id=11111111-1111-4111-8111-111111111111" }))).json();
    expect(body).toEqual({ open: true, view: { id: "11111111-1111-4111-8111-111111111111" } });
  });
});

describe("POST /api/mobile/symptom-checkback", () => {
  const input = { checkbackId: "11111111-1111-4111-8111-111111111111", progress: "worse", care: null, signs: [] };
  it("needs a session, and rejects a body that is not JSON", async () => {
    expect((await POST(req("POST", { token: null, body: input }))).status).toBe(401);
    expect((await POST(req("POST", { body: "not json" }))).status).toBe(400);
  });
  it("hands the answer to the web's own function for the signed-in person only", async () => {
    answerCheckback.mockResolvedValue({ ok: true, complaintKey: "headache", outcome: { action: "escalate" } });
    const res = await POST(req("POST", { body: input }));
    expect(await res.json()).toMatchObject({ ok: true });
    expect(answerCheckback).toHaveBeenCalledWith(expect.anything(), "u1", input);
  });
  it("a refusal is a normal answer with a short reason code", async () => {
    answerCheckback.mockResolvedValue({ ok: false, reason: "closed" });
    const res = await POST(req("POST", { body: input }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, reason: "closed" });
  });
  it("an unexpected failure is a 503 with a reason, never an empty answer", async () => {
    answerCheckback.mockRejectedValue(new Error("boom"));
    const res = await POST(req("POST", { body: input }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, reason: "failed" });
  });
});
