import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const rpc = jest.fn(async (..._args: unknown[]) => ({ data: "id", error: null as { message: string; code?: string } | null }));
const refuse = jest.fn(async (..._args: unknown[]) => null as string | null);
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
jest.mock("@/lib/clinical/refuse-superseded-draft", () => ({ refuseSupersededDraft: (...a: unknown[]) => refuse(...a) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { signLabPanels } from "./actions";

const ID = "7b1a6f2e-6f0d-4e8e-9f55-0c6a3b2f9c11";
function form(reviewed = true) {
  const f = new FormData();
  f.set("id", ID);
  if (reviewed) f.set("reviewed", "on");
  return f;
}

describe("signLabPanels error messages", () => {
  let logged: jest.SpiedFunction<typeof console.error>;
  beforeEach(() => {
    rpc.mockClear();
    refuse.mockClear();
    refuse.mockResolvedValue(null);
    logged = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("shows the reason when the database raised one on purpose", async () => {
    const reason = "Version 4 of lab_panel_signoffs is older than signed version 5. Draft a new version instead.";
    rpc.mockResolvedValueOnce({ data: null, error: { message: reason, code: "P0001" } });
    expect(await signLabPanels(undefined, form())).toEqual({ error: reason });
    expect(logged).not.toHaveBeenCalled();
  });

  it("keeps the plain wording for a refusal on role", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "not authorised: only the active Chief Medical Officer can sign the lab panels", code: "P0001" } });
    expect(await signLabPanels(undefined, form())).toEqual({ error: "Only the Chief Medical Officer can sign this." });
  });

  it("keeps a generic message for anything else, and logs the real one", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "connection reset by peer", code: "08006" } });
    expect(await signLabPanels(undefined, form())).toEqual({ error: "That did not work. Please try again." });
    expect(logged).toHaveBeenCalledWith("sign_lab_panels failed", { code: "08006", message: "connection reset by peer" });
  });

  it("signs when the database accepts, and never calls it unconfirmed", async () => {
    expect(await signLabPanels(undefined, form())).toEqual({ success: true });
    rpc.mockClear();
    expect((await signLabPanels(undefined, form(false))).error).toMatch(/reviewed/i);
    expect(rpc).not.toHaveBeenCalled();
  });
});
