import { readFileSync } from "node:fs";
import { join } from "node:path";

const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn().mockResolvedValue({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import { raiseSafetyConcern } from "./safety-concern-actions";

const form = (extra: Record<string, string> = {}) => {
  const f = new FormData();
  f.set("category", "patient_safety");
  f.set("severity", "medium");
  f.set("description", "The hand-over note left out an allergy for this patient.");
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
};

beforeEach(() => rpc.mockReset());

describe("raise a safety concern (23.19, S20 promise)", () => {
  it("goes through the speak-up RPC only and emits no domain event", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const res = await raiseSafetyConcern(undefined, form());
    expect(res).toEqual({ sent: true });
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["raise_safety_concern"]);
  });

  it("the anonymous path sends no screen or task", async () => {
    rpc.mockResolvedValue({ data: "ABCD-1234", error: null });
    const res = await raiseSafetyConcern(undefined, form({ anonymous: "yes", screen: "/clinician/queue" }));
    expect(res).toEqual({ sent: true, code: "ABCD-1234" });
    expect(Object.keys(rpc.mock.calls[0][1] as object)).not.toContain("p_screen");
  });

  it("is mounted for clinicians only and never emits safety_concern.raised", () => {
    const layout = readFileSync(join(__dirname, "../../app/(dashboard)/layout.tsx"), "utf8");
    expect(layout).toMatch(/profile\?\.role === "clinician" && <SafetyConcernButton \/>/);
    expect(readFileSync(join(__dirname, "safety-concern-actions.ts"), "utf8")).not.toMatch(/safety_concern\.raised/);
  });
});
