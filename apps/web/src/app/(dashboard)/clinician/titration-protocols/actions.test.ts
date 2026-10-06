import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const rpc = jest.fn<(fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>>();
let stored: { data: unknown; error: { message: string } | null } = { data: null, error: null };
const isCmo = jest.fn(() => true);

jest.mock("next/navigation", () => ({
  redirect: jest.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() =>
    Promise.resolve({
      rpc: (fn: string, args: Record<string, unknown>) => rpc(fn, args),
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(stored) }) }) }),
    }),
  ),
}));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentClinicalStaff: jest.fn(() => ({ doctor_tier: "chief_medical_officer" })) }));
jest.mock("@/lib/clinical/doctor-tier", () => ({ canAssignCases: () => isCmo() }));

import { approveProtocolAction, checkProtocolAction, saveProtocolDraftAction } from "./actions";
import { INITIAL_CHECK_STATE } from "@/lib/protocols/titration-review";

// The fictional, marked-placeholder fixture. No clinical content is written in this test.
const FIXTURE_TEXT = readFileSync(join(__dirname, "../../../../../../../packages/clinical/fixtures/titration-placeholder.json"), "utf8");
const FIXTURE = JSON.parse(FIXTURE_TEXT) as Record<string, unknown>;
const ID = "5b2f3c52-6f29-4d1a-8f3e-1a2b3c4d5e6f";

function form(fields: Record<string, string | null>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== null) fd.append(k, v);
  return fd;
}
async function approve(fields: Record<string, string | null>): Promise<string> {
  try {
    await approveProtocolAction(form(fields));
    return "NO_REDIRECT";
  } catch (e: unknown) {
    const msg = (e as Error).message;
    if (msg.startsWith("REDIRECT:")) return decodeURIComponent(msg.slice("REDIRECT:".length));
    throw e;
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  isCmo.mockReturnValue(true);
  rpc.mockResolvedValue({ data: null, error: null });
  // Stored as a real (non-placeholder) draft: the guard refuses a definition flagged placeholder.
  const { placeholder: _placeholder, ...REAL_SHAPED } = FIXTURE;
  void _placeholder;
  stored = { data: { code: "x_code", status: "draft", definition: { ...REAL_SHAPED, code: "x_code", status: "draft" } }, error: null };
});

describe("checkProtocolAction", () => {
  it("says valid and never saves", async () => {
    const s = await checkProtocolAction(INITIAL_CHECK_STATE, form({ code: "x_code", definition: FIXTURE_TEXT }));
    expect(s.kind).toBe("valid");
    expect(s.messages[0]).toContain("This definition is valid");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("reports invalid JSON", async () => {
    const s = await checkProtocolAction(INITIAL_CHECK_STATE, form({ code: "x_code", definition: "{oops" }));
    expect(s.kind).toBe("invalid");
    expect(s.messages[0]).toContain("not valid JSON");
  });
  it("shows every validation error", async () => {
    const s = await checkProtocolAction(INITIAL_CHECK_STATE, form({ code: "x_code", definition: JSON.stringify({ params: {}, steps: [] }) }));
    expect(s.kind).toBe("invalid");
    expect(s.messages.length).toBeGreaterThan(2);
  });
  it("rejects a bad code", async () => {
    const s = await checkProtocolAction(INITIAL_CHECK_STATE, form({ code: "Bad Code", definition: FIXTURE_TEXT }));
    expect(s.kind).toBe("invalid");
  });
  it("refuses a non-CMO", async () => {
    isCmo.mockReturnValue(false);
    const s = await checkProtocolAction(INITIAL_CHECK_STATE, form({ code: "x_code", definition: FIXTURE_TEXT }));
    expect(s).toEqual({ kind: "error", messages: ["Only the Chief Medical Officer can do this."] });
  });
});

describe("saveProtocolDraftAction", () => {
  it("saves a valid definition through save_protocol_draft only", async () => {
    const s = await saveProtocolDraftAction(INITIAL_CHECK_STATE, form({ code: "x_code", definition: FIXTURE_TEXT, note: " a note " }));
    expect(s.kind).toBe("saved");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("save_protocol_draft", { p_code: "x_code", p_definition: FIXTURE, p_note: "a note" });
  });
  it("does not save when validation fails or JSON is bad", async () => {
    const bad = await saveProtocolDraftAction(INITIAL_CHECK_STATE, form({ code: "x_code", definition: JSON.stringify({ params: {}, steps: [] }) }));
    const worse = await saveProtocolDraftAction(INITIAL_CHECK_STATE, form({ code: "x_code", definition: "nope" }));
    expect(bad.kind).toBe("invalid");
    expect(worse.kind).toBe("invalid");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps 42501 and hides unknown errors", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "only the Chief Medical Officer can save a protocol draft", code: "42501" } });
    expect((await saveProtocolDraftAction(INITIAL_CHECK_STATE, form({ code: "x_code", definition: FIXTURE_TEXT }))).messages[0]).toBe("Only the Chief Medical Officer can do this.");
    rpc.mockResolvedValueOnce({ data: null, error: { message: "relation boom", code: "XX000" } });
    const s = await saveProtocolDraftAction(INITIAL_CHECK_STATE, form({ code: "x_code", definition: FIXTURE_TEXT }));
    expect(s.kind).toBe("error");
    expect(s.messages[0]).not.toContain("boom");
  });
  it("refuses a non-CMO without calling the database", async () => {
    isCmo.mockReturnValue(false);
    const s = await saveProtocolDraftAction(INITIAL_CHECK_STATE, form({ code: "x_code", definition: FIXTURE_TEXT }));
    expect(s.kind).toBe("error");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("approveProtocolAction", () => {
  it("approves a valid confirmed draft", async () => {
    const url = await approve({ id: ID, confirmed: "yes", note: "ok" });
    expect(url).toContain("done=");
    expect(rpc).toHaveBeenCalledWith("approve_protocol", { p_id: ID, p_note: "ok" });
  });
  it("never approves a draft flagged as the test placeholder", async () => {
    stored = { data: { code: "x_code", status: "draft", definition: { ...FIXTURE, code: "x_code", status: "draft", placeholder: true } }, error: null };
    const msg = await approve({ id: ID, confirmed: "yes" });
    expect(msg).toContain("test placeholder");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never calls the RPC when the stored draft fails validation", async () => {
    stored = { data: { code: "x_code", status: "draft", definition: { code: "x_code", version: 1, status: "draft", params: {}, steps: [] } }, error: null };
    const url = await approve({ id: ID, confirmed: "yes" });
    expect(url).toContain("error=");
    expect(url).toContain("not valid");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("never calls the RPC without confirmation, with a bad id, a non-draft, a load failure or a non-CMO", async () => {
    expect(await approve({ id: ID })).toContain("error=");
    expect(await approve({ id: "nope", confirmed: "yes" })).toContain("error=");
    stored = { data: { code: "x_code", status: "approved", definition: FIXTURE }, error: null };
    expect(await approve({ id: ID, confirmed: "yes" })).toContain("Only a draft");
    stored = { data: null, error: { message: "x" } };
    expect(await approve({ id: ID, confirmed: "yes" })).toContain("could not be loaded");
    isCmo.mockReturnValue(false);
    expect(await approve({ id: ID, confirmed: "yes" })).toContain("Only the Chief Medical Officer");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps an RPC error to plain words", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "only the Chief Medical Officer can approve a protocol", code: "42501" } });
    expect(await approve({ id: ID, confirmed: "yes" })).toContain("Only the Chief Medical Officer can do this.");
    rpc.mockResolvedValueOnce({ data: null, error: { message: "secret detail", code: "XX000" } });
    expect(await approve({ id: ID, confirmed: "yes" })).not.toContain("secret detail");
  });
});
