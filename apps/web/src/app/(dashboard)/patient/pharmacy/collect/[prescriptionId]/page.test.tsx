const loaders = {
  loadCollection: jest.fn(),
  loadPharmacies: jest.fn(),
  loadSuggestion: jest.fn(),
  loadHasControlledItem: jest.fn(),
  loadOverview: jest.fn(),
  loadVisit: jest.fn(),
};
jest.mock("@/lib/pharmacy-collection/load", () => loaders);
jest.mock("@/lib/pharmacy-collection/actions", () => ({
  acceptSuggestionAction: jest.fn(), choosePharmacyAction: jest.fn(), declineSuggestionAction: jest.fn(), newCodeAction: jest.fn(), newVisitCodeAction: jest.fn(), withdrawAction: jest.fn(),
}));
jest.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
jest.mock("@/components/go-live/flash-clean", () => ({ FlashClean: () => null }));
jest.mock("@/components/partner-portal/pharmacy-chat-card", () => ({ PharmacyChatCard: () => null }));

import { renderToStaticMarkup } from "react-dom/server";
import Page from "./page";

const RX = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const P = "33333333-3333-4333-8333-333333333333";
const L = "44444444-4444-4444-8444-444444444444";
const V = "55555555-5555-4555-8555-555555555555";
// Stock answers are only shown as available while newer than the versioned limit (medicines.runway_and_stock_freshness, 48 hours).
const FRESH = new Date(Date.now() - 3_600_000).toISOString();
const STALE = new Date(Date.now() - 100 * 3_600_000).toISOString();
const collection = (state: string, over: Record<string, unknown> = {}) => ({
  state, pharmacy_name: "A Pharmacy", location_name: "Lekki", address: "1 Test Road", code: state === "sent" ? "ABCD2345" : null, code_expires_at: "2026-11-01T00:00:00Z",
  locked: false, expired: false, collected: false, can_repeat: false, other_pharmacy_needed: false, ...over,
});
const item = (id: string, over: Record<string, unknown> = {}) => ({
  prescription_id: id, medicine: "Losartan", state: "signed", visit_id: null, pharmacy_name: null, location_name: null, address: null, code: null, code_expires_at: null,
  locked: false, expired: false, stock_confirmed_at: null, other_pharmacy_needed: false, controlled: false, pharmacy_partner_id: null, pharmacy_location_id: null, ...over,
});
const render = async (query: { n?: string; for?: string } = {}) =>
  renderToStaticMarkup(await Page({ params: Promise.resolve({ prescriptionId: RX }), searchParams: Promise.resolve(query) }));

beforeEach(() => {
  Object.values(loaders).forEach((m) => m.mockReset());
  loaders.loadPharmacies.mockResolvedValue({ ok: true, data: [{ partner_id: P, partner_name: "A Pharmacy", location_id: L, location_name: "Lekki", state: "Lagos", address: "1 Test Road" }] });
  loaders.loadSuggestion.mockResolvedValue({ ok: true, data: null });
  loaders.loadHasControlledItem.mockResolvedValue(false);
});

describe("patient collect page (S28e)", () => {
  it("offers her other waiting medicines as tick boxes inside the one pharmacy form, and never as a separate send", async () => {
    loaders.loadCollection.mockResolvedValue({ ok: true, data: collection("signed") });
    loaders.loadOverview.mockResolvedValue({ ok: true, data: [item(RX, { medicine: "Amlodipine" }), item(OTHER)] });
    const html = await render();
    expect(html).toContain('name="also"');
    expect(html).toContain(`value="${OTHER}"`);
    expect(html).not.toContain(`name="also" value="${RX}"`); // this medicine is not offered to itself
    expect(html).toContain(`value="${P}:${L}"`);
    expect(html).toContain('name="choice"');
    expect((html.match(/<form/g) ?? []).length).toBe(1); // one form: the ticks and the pharmacy buttons travel together
    // Enter on a tick box must not press the first pharmacy for her: the form's first (default) submit button is a disabled one
    expect(html).toMatch(/<form[^>]*><button type="submit" disabled=""[^>]*class="hidden"/);
    expect(html).toContain("Losartan");
  });
  it("shows no price, price comparison or stock level while she chooses (OQ-714, Part C.2, OQ-283), and still says she can take it anywhere", async () => {
    loaders.loadCollection.mockResolvedValue({ ok: true, data: collection("signed") });
    loaders.loadOverview.mockResolvedValue({ ok: true, data: [item(RX)] });
    const html = await render();
    expect(html).not.toMatch(/compare prices|₦|in stock|running low|prices last updated/i);
    expect(html).toContain("take it to any pharmacy you like");
    expect(html).toContain(`value="${P}:${L}"`);
  });
  it("with no other medicine waiting there are no tick boxes", async () => {
    loaders.loadCollection.mockResolvedValue({ ok: true, data: collection("signed") });
    loaders.loadOverview.mockResolvedValue({ ok: true, data: [item(RX)] });
    expect(await render()).not.toContain('name="also"');
  });
  it("a failed read of the other medicines is said out loud and the page still works", async () => {
    loaders.loadCollection.mockResolvedValue({ ok: true, data: collection("signed") });
    loaders.loadOverview.mockResolvedValue({ ok: false, denied: false });
    const html = await render();
    expect(html).toContain("could not load your other medicines");
    expect(html).toContain(`value="${P}:${L}"`);
  });
  it("a sent medicine shows the pharmacy's plain yes (or that it has not said), and the medicines that share the code", async () => {
    loaders.loadCollection.mockResolvedValue({ ok: true, data: collection("sent") });
    loaders.loadOverview.mockResolvedValue({ ok: true, data: [item(RX, { state: "sent", visit_id: V, code: "ABCD2345", stock_confirmed_at: FRESH })] });
    loaders.loadVisit.mockResolvedValue({
      ok: true,
      data: [
        { prescription_id: RX, medicine: "Amlodipine", state: "sent", collected: false, stock_confirmed_at: FRESH, other_pharmacy_needed: false },
        { prescription_id: OTHER, medicine: "Losartan", state: "sent", collected: false, stock_confirmed_at: null, other_pharmacy_needed: false },
      ],
    });
    const html = await render();
    expect(html).toContain("This code covers 2 medicines");
    expect(html).toContain("The pharmacy says it has this");
    expect(html).toContain("The pharmacy has not said yet whether it has this");
    expect(html).toContain("Get a new code for all of them");
    expect(html).not.toMatch(/₦|naira/i);
  });
  it("a stock answer older than the limit is never shown as available: it says to ask the pharmacy to confirm", async () => {
    loaders.loadCollection.mockResolvedValue({ ok: true, data: collection("sent") });
    loaders.loadOverview.mockResolvedValue({ ok: true, data: [item(RX, { state: "sent", visit_id: null, code: "ABCD2345", stock_confirmed_at: STALE })] });
    const html = await render();
    expect(html).toContain("Ask the pharmacy to confirm");
    expect(html).not.toContain("The pharmacy says it has this");
    expect(html).not.toMatch(/₦|naira|price/i);
  });
  it("a failed read of the visit is said out loud, never shown as only this medicine", async () => {
    loaders.loadCollection.mockResolvedValue({ ok: true, data: collection("sent") });
    loaders.loadOverview.mockResolvedValue({ ok: true, data: [item(RX, { state: "sent", visit_id: V, code: "ABCD2345" })] });
    loaders.loadVisit.mockResolvedValue({ ok: false, denied: false });
    const html = await render();
    expect(html).toContain("could not load the other medicines that share this code");
    expect(html).not.toContain("Get a new code for all of them");
  });
  it("shows the lock from the visit even when the single prescription flag has not caught up", async () => {
    loaders.loadCollection.mockResolvedValue({ ok: true, data: collection("sent", { locked: false }) });
    loaders.loadOverview.mockResolvedValue({ ok: true, data: [item(RX, { state: "sent", visit_id: V, code: "ABCD2345", locked: true })] });
    loaders.loadVisit.mockResolvedValue({ ok: true, data: [] });
    expect(await render()).toContain("locked");
  });
  it("the collection code is shown on the page only, never in a notice that rides in the address", async () => {
    loaders.loadCollection.mockResolvedValue({ ok: true, data: collection("sent") });
    loaders.loadOverview.mockResolvedValue({ ok: true, data: [item(RX, { state: "sent", code: "ABCD2345" })] });
    const html = await render({ n: "chosen_many" });
    expect(html).toContain("One collection code covers all of them");
    expect((html.match(/ABCD2345/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });
});
