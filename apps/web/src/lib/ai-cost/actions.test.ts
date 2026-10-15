const rpc = jest.fn();
const redirect = jest.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
jest.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { addAiModelPriceAction } from "./actions";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};
const goes = async (p: Promise<void>) => p.then(() => "no redirect", (e: Error) => e.message);
const good = { model: "m", input: "300", output: "1500", currency: "USD", valid_from: "2026-01-01", source_note: "vendor price page read" };

beforeEach(() => rpc.mockReset());

describe("addAiModelPriceAction", () => {
  it("sends integer prices to the database", async () => {
    rpc.mockResolvedValue({ data: "id", error: null });
    expect(await goes(addAiModelPriceAction(fd(good)))).toBe("REDIRECT:/admin/settings/ai-governance/cost?n=added");
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_input_per_million_minor: 300, p_output_per_million_minor: 1500, p_currency: "USD" });
  });
  it("never calls the database with a decimal price", async () => {
    expect(await goes(addAiModelPriceAction(fd({ ...good, input: "3.5" })))).toBe("REDIRECT:/admin/settings/ai-governance/cost?n=bad_input");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a refusal is a denied notice, not success", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "x", code: "42501" } });
    expect(await goes(addAiModelPriceAction(fd(good)))).toBe("REDIRECT:/admin/settings/ai-governance/cost?n=denied");
  });
});
