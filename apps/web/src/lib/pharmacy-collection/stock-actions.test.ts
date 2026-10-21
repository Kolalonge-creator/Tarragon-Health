const rpc = jest.fn();
const redirect = jest.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
jest.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { confirmStockAction } from "./stock-actions";

const RX = "11111111-1111-4111-8111-111111111111";
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};
const goes = async (p: Promise<void>) => p.then(() => "no redirect", (e: Error) => e.message);

beforeEach(() => {
  rpc.mockReset();
  redirect.mockClear();
});

/**
 * S28e: the pharmacy's stock answer is a plain yes or no. The only things sent are the prescription id and a boolean, so there is nowhere for a price or
 * a quantity to go, and the result that comes back is one of four short codes, never the medicine or the patient.
 */
describe("confirmStockAction", () => {
  it("sends a yes as true and a no as false, and nothing else", async () => {
    rpc.mockResolvedValue({ data: "confirmed", error: null });
    expect(await goes(confirmStockAction(fd({ prescription: RX, answer: "yes", price: "5000", quantity: "30" })))).toBe("REDIRECT:/pharmacist/prescriptions?s=confirmed");
    expect(rpc).toHaveBeenCalledWith("pharmacist_confirm_stock", { p_prescription: RX, p_in_stock: true });
    rpc.mockResolvedValue({ data: "out_of_stock", error: null });
    expect(await goes(confirmStockAction(fd({ prescription: RX, answer: "no" })))).toBe("REDIRECT:/pharmacist/prescriptions?s=out_of_stock");
    expect(rpc).toHaveBeenLastCalledWith("pharmacist_confirm_stock", { p_prescription: RX, p_in_stock: false });
  });
  it("a controlled medicine is reported as refused, never as confirmed", async () => {
    rpc.mockResolvedValue({ data: "controlled_medicine", error: null });
    expect(await goes(confirmStockAction(fd({ prescription: RX, answer: "yes" })))).toBe("REDIRECT:/pharmacist/prescriptions?s=controlled_medicine");
  });
  it("an error or an unexpected answer is a failure, never a success", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "pharmacy_collection_off", code: "55000" } });
    expect(await goes(confirmStockAction(fd({ prescription: RX, answer: "yes" })))).toBe("REDIRECT:/pharmacist/prescriptions?s=failed");
    rpc.mockResolvedValue({ data: "price_agreed", error: null });
    expect(await goes(confirmStockAction(fd({ prescription: RX, answer: "yes" })))).toBe("REDIRECT:/pharmacist/prescriptions?s=failed");
  });
  it("never calls the database for a bad id or an answer that is neither yes nor no", async () => {
    expect(await goes(confirmStockAction(fd({ prescription: "x", answer: "yes" })))).toBe("REDIRECT:/pharmacist/prescriptions?s=failed");
    expect(await goes(confirmStockAction(fd({ prescription: RX, answer: "maybe" })))).toBe("REDIRECT:/pharmacist/prescriptions?s=failed");
    expect(rpc).not.toHaveBeenCalled();
  });
});
