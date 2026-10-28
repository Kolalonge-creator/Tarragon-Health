import { describe, expect, it, jest } from "@jest/globals";
import { loadEatingGuidance } from "./eating-plans";

type Rpc = (name: string) => Promise<{ data: unknown; error: { message: string } | null }>;
function client(rpc: Rpc) {
  return { rpc: jest.fn(rpc) } as unknown as Parameters<typeof loadEatingGuidance>[0];
}
const okPayload = {
  state: "ok",
  config_version: 1,
  swaps: [],
  plans: [{ code: "weight", title: "t", intro: "i", care_team_prompt: "c", tips: [{ heading: "h", body: "b" }] }],
};

describe("loadEatingGuidance", () => {
  it("is not signed and asks nothing else when no version is signed (old hints stay the fallback)", async () => {
    const c = client(async (n) => (n === "nutrition_guidance_is_signed" ? { data: false, error: null } : { data: okPayload, error: null }));
    expect(await loadEatingGuidance(c)).toEqual({ signed: false, guidance: { state: "unavailable" }, raw: { state: "unavailable" }, failed: false });
    expect((c.rpc as unknown as jest.Mock).mock.calls.map((x) => x[0])).toEqual(["nutrition_guidance_is_signed"]);
  });

  it("returns the plans once signed", async () => {
    const c = client(async (n) => (n === "nutrition_guidance_is_signed" ? { data: true, error: null } : { data: okPayload, error: null }));
    const v = await loadEatingGuidance(c);
    expect(v.signed).toBe(true);
    expect(v.guidance.state).toBe("ok");
    expect(v.raw).toEqual(okPayload);
    expect(v.failed).toBe(false);
  });

  it("when signed but withheld, is unavailable and signed (so the old hints do NOT come back)", async () => {
    const c = client(async (n) => (n === "nutrition_guidance_is_signed" ? { data: true, error: null } : { data: { state: "unavailable" }, error: null }));
    expect(await loadEatingGuidance(c)).toEqual({ signed: true, guidance: { state: "unavailable" }, raw: { state: "unavailable" }, failed: false });
  });

  it("treats a failed gate or a failed signed check as signed and unavailable, never as the old hints", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const failGate = client(async (n) => (n === "nutrition_guidance_is_signed" ? { data: true, error: null } : { data: null, error: { message: "boom" } }));
    expect(await loadEatingGuidance(failGate)).toEqual({ signed: true, guidance: { state: "unavailable" }, raw: null, failed: true });
    const failSigned = client(async () => ({ data: null, error: { message: "boom" } }));
    expect(await loadEatingGuidance(failSigned)).toEqual({ signed: true, guidance: { state: "unavailable" }, raw: null, failed: true });
    spy.mockRestore();
  });
});
