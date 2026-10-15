import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const rpc = jest.fn<(name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>>();
let role: string | null = "admin";

jest.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: async () => (role ? { role } : null) }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { closeBreakAction, replayProviderEventAction } from "./actions";

const ID = "6f1d7a2e-3b44-4c8e-9a51-0c2d1e8f7a10";
const form = (e: Record<string, string>): FormData => { const f = new FormData(); for (const [k, v] of Object.entries(e)) f.set(k, v); return f; };
async function run(fn: (f: FormData) => Promise<void>, f: FormData): Promise<string> {
  try { await fn(f); } catch (e) { return (e as Error).message; }
  return "no redirect";
}

describe("closeBreakAction", () => {
  beforeEach(() => { rpc.mockReset(); role = "admin"; });
  it("closes through the audited function with the note, and posts nothing else", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await run(closeBreakAction, form({ break_id: ID, status: "explained", note: "Paid by transfer outside Paystack" }))).toBe("REDIRECT:/admin/ops/providers?r=ok");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("close_reconciliation_break", { p_id: ID, p_status: "explained", p_note: "Paid by transfer outside Paystack" });
  });
  it("refuses a non-admin before calling the database", async () => {
    role = "clinician";
    expect(await run(closeBreakAction, form({ break_id: ID, status: "explained", note: "A perfectly good note" }))).toBe("REDIRECT:/admin/ops/providers?r=failed");
    role = null;
    expect(await run(closeBreakAction, form({ break_id: ID, status: "explained", note: "A perfectly good note" }))).toBe("REDIRECT:/admin/ops/providers?r=failed");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses a short note, a bad id and a status outside explained or resolved", async () => {
    for (const bad of [{ break_id: ID, status: "explained", note: "short" }, { break_id: "nope", status: "explained", note: "A perfectly good note" }, { break_id: ID, status: "deleted", note: "A perfectly good note" }]) {
      expect(await run(closeBreakAction, form(bad))).toBe("REDIRECT:/admin/ops/providers?r=invalid");
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("reports failure when the database refuses or says nothing was closed", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await run(closeBreakAction, form({ break_id: ID, status: "resolved", note: "A perfectly good note" }))).toBe("REDIRECT:/admin/ops/providers?r=failed");
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await run(closeBreakAction, form({ break_id: ID, status: "resolved", note: "A perfectly good note" }))).toBe("REDIRECT:/admin/ops/providers?r=failed");
  });
});

describe("replayProviderEventAction", () => {
  beforeEach(() => { rpc.mockReset(); role = "admin"; });
  it("replays through the audited function with a reason", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await run(replayProviderEventAction, form({ event_id: ID, reason: "Handler was fixed, reprocess it" }))).toBe("REDIRECT:/admin/ops/providers?r=ok");
    expect(rpc).toHaveBeenCalledWith("replay_provider_event", { p_id: ID, p_reason: "Handler was fixed, reprocess it" });
  });
  it("needs an admin, an id and a reason", async () => {
    role = "clinician";
    expect(await run(replayProviderEventAction, form({ event_id: ID, reason: "Handler was fixed, reprocess it" }))).toContain("r=failed");
    role = "admin";
    expect(await run(replayProviderEventAction, form({ event_id: ID, reason: "no" }))).toContain("r=invalid");
    expect(await run(replayProviderEventAction, form({ event_id: "x", reason: "Handler was fixed, reprocess it" }))).toContain("r=invalid");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("tells the admin when the event is being handled right now, and fails on any other refusal", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "provider_event_in_flight" } });
    expect(await run(replayProviderEventAction, form({ event_id: ID, reason: "Handler was fixed, reprocess it" }))).toContain("r=busy");
    rpc.mockResolvedValue({ data: null, error: { message: "provider_event_unverified_never_replayed" } });
    expect(await run(replayProviderEventAction, form({ event_id: ID, reason: "Handler was fixed, reprocess it" }))).toContain("r=failed");
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await run(replayProviderEventAction, form({ event_id: ID, reason: "Handler was fixed, reprocess it" }))).toContain("r=failed");
  });
});
