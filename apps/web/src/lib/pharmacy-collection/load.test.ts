const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { loadHasControlledItem } from "./load";

const RX = "11111111-1111-4111-8111-111111111111";
const FOR = "22222222-2222-4222-8222-222222222222";

/**
 * OQ-276: the patient's note before choosing a pharmacy. It is advisory (the counter refuses a controlled medicine anyway), so only a clear "true"
 * shows the note; an error or anything else shows none and never blocks the page.
 */
describe("loadHasControlledItem", () => {
  beforeEach(() => rpc.mockReset());

  it("is true only when the database says true, and asks for the right prescription", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(loadHasControlledItem(RX)).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("patient_prescription_has_controlled_item", { p_prescription: RX });
  });

  it("passes the person a caregiver acts for", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(loadHasControlledItem(RX, FOR)).resolves.toBe(false);
    expect(rpc).toHaveBeenCalledWith("patient_prescription_has_controlled_item", { p_prescription: RX, p_beneficiary: FOR });
  });

  it("shows no note on an error or an unexpected answer", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(loadHasControlledItem(RX)).resolves.toBe(false);
    rpc.mockResolvedValue({ data: "yes", error: null });
    await expect(loadHasControlledItem(RX)).resolves.toBe(false);
  });
});
