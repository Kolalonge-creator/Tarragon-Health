const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
jest.mock("next/navigation", () => ({ redirect: jest.fn() }));

import { renderToStaticMarkup } from "react-dom/server";
import Page from "./page";

const ID = "11111111-1111-4111-8111-111111111111";
const row = (state: string) => ({ prescription_id: ID, state, sent_at: null, dispensed_at: null, patient_name: "Test Patient", patient_number: "TH1", items: [{ drug: "Medicine", dose: "5 mg" }], open_flags: 0, location_name: null, code_locked: false });
const render = async () => renderToStaticMarkup(await Page());

beforeEach(() => rpc.mockReset());

describe("pharmacist prescriptions page", () => {
  it("lists a waiting prescription with a link to the counter and no free-text form (S28c: structured questions only)", async () => {
    rpc.mockResolvedValue({ data: [row("sent")], error: null });
    const html = await render();
    expect(html).toContain(`/pharmacist/prescriptions/${ID}`);
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("Flag a problem");
  });
  it("a dispensed prescription has no counter link", async () => {
    rpc.mockResolvedValue({ data: [row("dispensed")], error: null });
    expect(await render()).not.toContain(`/pharmacist/prescriptions/${ID}`);
  });
  it("a failed load says so, it is not shown as an empty list", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "x", code: "XX000" } });
    const html = await render();
    expect(html).toContain("could not load");
    expect(html).not.toContain("No prescriptions have been sent");
  });
  it("while the go-live guard is closed it says so calmly, not as a failure", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "pharmacy_collection_off", code: "55000" } });
    const html = await render();
    expect(html).toContain("not switched on yet");
    expect(html).not.toContain("could not load");
  });
});
