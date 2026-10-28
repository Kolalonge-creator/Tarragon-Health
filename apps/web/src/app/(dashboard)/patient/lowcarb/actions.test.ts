/**
 * S50b: the patient answers an offer or stops. Only these two database functions are ever called, an unreadable reply is never treated as accepted,
 * and the patient cannot start a programme by any route here (the offer comes from a clinician).
 */
const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: (...args: unknown[]) => rpc(...args) }),
}));
const revalidatePath = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { respondToLowCarbOffer, stopLowCarbAsPatient } from "./actions";

const ID = "7a1c2e3d-4b5a-4c6d-8e7f-9a0b1c2d3e4f";
const form = (v: Record<string, string>): FormData => {
  const f = new FormData();
  for (const [k, val] of Object.entries(v)) f.set(k, val);
  return f;
};

beforeEach(() => {
  rpc.mockReset();
  revalidatePath.mockReset();
});

describe("respondToLowCarbOffer", () => {
  it("yes accepts, and passes exactly the id and true", async () => {
    rpc.mockResolvedValue({ data: "active", error: null });
    await expect(respondToLowCarbOffer(undefined, form({ enrolmentId: ID, answer: "yes" }))).resolves.toEqual({ outcome: "active" });
    expect(rpc).toHaveBeenCalledWith("respond_lowcarb_offer", { p_enrolment: ID, p_accept: true });
    expect(revalidatePath).toHaveBeenCalledWith("/patient/lowcarb");
  });

  it("no declines, and anything other than yes is a no", async () => {
    rpc.mockResolvedValue({ data: "declined", error: null });
    await expect(respondToLowCarbOffer(undefined, form({ enrolmentId: ID, answer: "no" }))).resolves.toEqual({ outcome: "declined" });
    expect(rpc).toHaveBeenLastCalledWith("respond_lowcarb_offer", { p_enrolment: ID, p_accept: false });
    await respondToLowCarbOffer(undefined, form({ enrolmentId: ID }));
    expect(rpc).toHaveBeenLastCalledWith("respond_lowcarb_offer", { p_enrolment: ID, p_accept: false });
  });

  it("an offer that is no longer available is said calmly", async () => {
    rpc.mockResolvedValue({ data: "unavailable", error: null });
    await expect(respondToLowCarbOffer(undefined, form({ enrolmentId: ID, answer: "yes" }))).resolves.toEqual({ outcome: "unavailable" });
  });

  it("an error or an unreadable reply is never treated as accepted", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await respondToLowCarbOffer(undefined, form({ enrolmentId: ID, answer: "yes" })))?.outcome).toBeUndefined();
    rpc.mockResolvedValue({ data: "active-ish", error: null });
    expect((await respondToLowCarbOffer(undefined, form({ enrolmentId: ID, answer: "yes" })))?.outcome).toBeUndefined();
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await respondToLowCarbOffer(undefined, form({ enrolmentId: ID, answer: "yes" })))?.error).toBeTruthy();
  });

  it("refuses a bad id without calling the database", async () => {
    await expect(respondToLowCarbOffer(undefined, form({ enrolmentId: "x", answer: "yes" }))).resolves.toEqual({ error: expect.any(String) });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("stopLowCarbAsPatient", () => {
  it("stops through the one function", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(stopLowCarbAsPatient(undefined, form({ enrolmentId: ID }))).resolves.toEqual({ outcome: "stopped" });
    expect(rpc).toHaveBeenCalledWith("stop_lowcarb_programme", { p_enrolment: ID });
  });
  it("a failure says nothing was changed", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "x" } });
    const r = await stopLowCarbAsPatient(undefined, form({ enrolmentId: ID }));
    expect(r?.error).toMatch(/nothing was changed/);
  });
});

describe("the patient folder", () => {
  const dir = join(process.cwd(), "src", "app", "(dashboard)", "patient", "lowcarb");
  const sources = ["actions.ts", "lowcarb-client.tsx", "page.tsx", "lowcarb-link.tsx"].map((f) => readFileSync(join(dir, f), "utf8"));
  it("has no way to start a programme: no offer function, no insert", () => {
    for (const s of sources) {
      expect(s).not.toMatch(/offer_lowcarb_programme|\.insert\(|\.from\(/);
    }
  });
  it("shows no medicine, dose, condition or reading name in its own words", () => {
    for (const s of sources) expect(s).not.toMatch(/insulin|gliclazide|metformin|sulfonylurea|ketoacidosis|pregnan/i);
  });
  it("never calls a model", () => {
    for (const s of sources) expect(s).not.toMatch(/anthropic|openai|runGovernedAi/i);
  });
});
