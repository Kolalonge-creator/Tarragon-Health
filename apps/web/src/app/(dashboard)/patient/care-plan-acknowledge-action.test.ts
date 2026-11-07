/** PD-06: the patient's "Got it". Input is validated, the RPC runs on the user's own server client, and a failure is never "saved". */
const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: (...args: unknown[]) => rpc(...args) }),
}));
const revalidatePath = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

import { acknowledgeCarePlanChange } from "./care-plan-acknowledge-action";

const ID = "0b8f6d0e-3c1a-4f3e-9a52-1d6f6a9f7c11";

beforeEach(() => {
  rpc.mockReset();
  revalidatePath.mockReset();
});

it("calls the acknowledge RPC with the id and revalidates the care page", async () => {
  rpc.mockResolvedValue({ data: true, error: null });
  await expect(acknowledgeCarePlanChange({ revisionId: ID })).resolves.toEqual({ ok: true });
  expect(rpc).toHaveBeenCalledWith("acknowledge_care_plan_revision", { p_revision: ID });
  expect(revalidatePath).toHaveBeenCalledWith("/patient/care");
});

it("refuses bad input without calling the database", async () => {
  for (const bad of [undefined, null, {}, { revisionId: "nope" }, { revisionId: 3 }, "x"]) {
    await expect(acknowledgeCarePlanChange(bad)).resolves.toEqual({ ok: false });
  }
  expect(rpc).not.toHaveBeenCalled();
});

it("an RPC error (for example a supporter acting for the patient) is a failure, never saved", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Only the patient can confirm" } });
  await expect(acknowledgeCarePlanChange({ revisionId: ID })).resolves.toEqual({ ok: false });
  expect(revalidatePath).not.toHaveBeenCalled();
});

it("an unexpected reply is a failure", async () => {
  rpc.mockResolvedValue({ data: null, error: null });
  await expect(acknowledgeCarePlanChange({ revisionId: ID })).resolves.toEqual({ ok: false });
});
