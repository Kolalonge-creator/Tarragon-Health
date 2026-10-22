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
  it("S28e: prescriptions sent together are marked as one visit and open together, each with a plain yes or no for stock and no price", async () => {
    const OTHER = "22222222-2222-4222-8222-222222222222";
    const VISIT = "33333333-3333-4333-8333-333333333333";
    rpc.mockImplementation(async (name: string) => {
      if (name === "pharmacist_prescriptions") return { data: [row("sent"), { ...row("sent"), prescription_id: OTHER }], error: null };
      return {
        data: [
          { prescription_id: ID, visit_id: VISIT, stock_confirmed_at: "2026-10-16T10:00:00Z" },
          { prescription_id: OTHER, visit_id: VISIT, stock_confirmed_at: null },
        ],
        error: null,
      };
    });
    const html = await render();
    expect(html).toContain(`/pharmacist/prescriptions/visit/${VISIT}`);
    expect(html).toContain("Sent together with 1 other medicines");
    expect(html).toContain("We have this");
    expect(html).toContain("We cannot supply this");
    expect(html).toContain("You said you have this");
    expect(html).toContain("Stock not confirmed yet");
    expect(html).not.toMatch(/naira|kobo|₦/i);
    expect(html).not.toContain('name="price"');
    expect(html).not.toContain("<textarea");
  });
  it("S28e: a single prescription has no visit link", async () => {
    rpc.mockImplementation(async (name: string) => (name === "pharmacist_prescriptions" ? { data: [row("sent")], error: null } : { data: [{ prescription_id: ID, visit_id: null, stock_confirmed_at: null }], error: null }));
    const html = await render();
    expect(html).not.toContain("/pharmacist/prescriptions/visit/");
    expect(html).toContain(`/pharmacist/prescriptions/${ID}`);
  });
  it("S28e: if the grouping cannot be loaded the list is still shown and the page says the grouping is missing", async () => {
    rpc.mockImplementation(async (name: string) => (name === "pharmacist_prescriptions" ? { data: [row("sent")], error: null } : { data: null, error: { message: "boom", code: "XX000" } }));
    const html = await render();
    expect(html).toContain(`/pharmacist/prescriptions/${ID}`);
    expect(html).toContain("could not be loaded just now");
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
