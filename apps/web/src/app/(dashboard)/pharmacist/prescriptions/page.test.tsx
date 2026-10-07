const profile = jest.fn();
const rpc = jest.fn();
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: () => profile() }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
jest.mock("next/navigation", () => ({ redirect: jest.fn() }));
jest.mock("@/components/go-live/flash-clean", () => ({ FlashClean: () => null }));

import { renderToStaticMarkup } from "react-dom/server";
import Page from "./page";

const ID = "11111111-1111-4111-8111-111111111111";
const row = (state: string) => ({ prescription_id: ID, state, sent_at: null, dispensed_at: null, patient_name: "Test Patient", patient_number: "TH1", items: [{ drug: "Medicine", dose: "5 mg" }], open_flags: 0, location_name: null, code_locked: false });
const render = async (n?: string) => renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ n }) }));

beforeEach(() => {
  profile.mockResolvedValue({ language: "en" });
  rpc.mockReset();
});

describe("pharmacist prescriptions page", () => {
  it("offers Flag a problem on a waiting prescription", async () => {
    rpc.mockResolvedValue({ data: [row("sent")], error: null });
    const html = await render();
    expect(html).toContain("Flag a problem");
    // S28: the pharmacy never sees the collection code in this list (it can only test one at the counter), so none is shown.
    expect(html).not.toContain("AB12CD");
  });
  it("offers no flag form on a dispensed prescription", async () => {
    rpc.mockResolvedValue({ data: [row("dispensed")], error: null });
    expect(await render()).not.toContain("Flag a problem");
  });
  it("a failed load says so, it is not shown as an empty list", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "x", code: "XX000" } });
    const html = await render();
    expect(html).toContain("could not load");
    expect(html).not.toContain("No prescriptions have been sent");
  });
  it("shows only a known notice", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await render("flagged")).toContain("was sent to the prescribing team");
    expect(await render("<b>x</b>")).not.toContain("<b>x</b>");
  });
});
