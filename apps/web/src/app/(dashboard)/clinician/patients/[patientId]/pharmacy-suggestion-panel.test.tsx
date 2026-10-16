/** @jest-environment jsdom */
/**
 * S54c: the clinician panel shows neutral facts only (name, place, proximity, stock), lists in the order the database gives, offers a withdraw
 * only for a pending suggestion, and says "not available" (not "none") when a read is refused.
 */
import { renderToStaticMarkup } from "react-dom/server";

const loadRoutingRows = jest.fn();
const loadOptions = jest.fn();
jest.mock("@/lib/pharmacy-suggestion/load", () => ({ loadRoutingRows: (...a: unknown[]) => loadRoutingRows(...a), loadOptions: (...a: unknown[]) => loadOptions(...a) }));
jest.mock("@/lib/pharmacy-suggestion/actions", () => ({ suggestPharmacyAction: jest.fn(), withdrawSuggestionAction: jest.fn() }));

import { PharmacySuggestionPanel } from "./pharmacy-suggestion-panel";

const PAT = "11111111-1111-4111-8111-111111111111";
const RX = "22222222-2222-4222-8222-222222222222";
const opt = (n: string, i: number, extra: object = {}) => ({
  partner_id: `3333333${i}-3333-4333-8333-333333333333`,
  partner_name: n,
  location_id: `4444444${i}-4444-4444-8444-444444444444`,
  location_name: `${n} branch`,
  address: "1 Test Road",
  state: "Lagos",
  proximity: "same_city",
  in_stock: "yes",
  listable: true,
  ...extra,
});
const row = (extra: object = {}) => ({
  prescription_id: RX, rx_state: "signed", item_summary: "Item one", signed_at: "2026-10-07T10:00:00Z",
  suggestion_id: null, suggestion_status: null, suggested_partner_name: null, suggested_location_name: null, suggested_at: null, suggested_by_me: null, patient_can_confirm: true, ...extra,
});
const render = async () => renderToStaticMarkup(await PharmacySuggestionPanel({ patientId: PAT }));

beforeEach(() => {
  loadRoutingRows.mockReset();
  loadOptions.mockReset();
});

describe("PharmacySuggestionPanel", () => {
  it("lists the options in the order given and shows no price, earning or ranking word", async () => {
    loadRoutingRows.mockResolvedValue({ ok: true, data: [row()] });
    loadOptions.mockResolvedValue({ ok: true, data: [opt("Alpha Pharmacy", 1), opt("Beta Pharmacy", 2, { proximity: "same_state", in_stock: "no" })] });
    const html = await render();
    expect(html.indexOf("Alpha Pharmacy")).toBeGreaterThan(-1);
    expect(html.indexOf("Alpha Pharmacy")).toBeLessThan(html.indexOf("Beta Pharmacy"));
    expect(html).toContain("Same city as the patient");
    expect(html).toContain("Some medicines not listed or not in stock");
    expect(html).toContain("Verified partner");
    expect(html).toContain("The patient chooses and confirms");
    expect(html).not.toMatch(/commission|earn|margin|payout|price|cheapest|best|₦/i);
    expect(html.match(/Suggest this pharmacy/g)?.length).toBe(2);
  });
  it("offers a withdraw only while the suggestion is pending", async () => {
    loadRoutingRows.mockResolvedValue({ ok: true, data: [row({ suggestion_id: "55555555-5555-4555-8555-555555555555", suggestion_status: "pending", suggested_partner_name: "Alpha Pharmacy", suggested_by_me: true })] });
    loadOptions.mockResolvedValue({ ok: true, data: [] });
    const mine = await render();
    expect(mine).toContain("Withdraw suggestion");
    expect(mine).toContain("Your suggestion");
    // options are not read (and so not audited) for a prescription that already has a live suggestion
    expect(loadOptions).not.toHaveBeenCalled();
    // a colleague's suggestion is labelled as theirs and cannot be withdrawn from here
    loadRoutingRows.mockResolvedValue({ ok: true, data: [row({ suggestion_id: "55555555-5555-4555-8555-555555555555", suggestion_status: "pending", suggested_partner_name: "Alpha Pharmacy", suggested_by_me: false })] });
    const theirs = await render();
    expect(theirs).toContain("A colleague&#x27;s suggestion");
    expect(theirs).not.toContain("Withdraw suggestion");
    loadRoutingRows.mockResolvedValue({ ok: true, data: [row({ rx_state: "sent", suggestion_id: "55555555-5555-4555-8555-555555555555", suggestion_status: "accepted", suggested_partner_name: "Alpha Pharmacy" })] });
    const html = await render();
    expect(html).not.toContain("Withdraw suggestion");
    expect(html).toContain("The patient confirmed it");
  });
  it("a refused or failed read says not available, never none", async () => {
    loadRoutingRows.mockResolvedValue({ ok: false });
    expect(await render()).toContain("Not available to you right now");
    loadRoutingRows.mockResolvedValue({ ok: true, data: [row()] });
    loadOptions.mockResolvedValue({ ok: false });
    const html = await render();
    expect(html).toContain("not available to you right now");
    expect(html).not.toContain("No verified partner pharmacy");
  });
  it("with no partner pharmacy near the patient it says she can still take the prescription anywhere", async () => {
    loadRoutingRows.mockResolvedValue({ ok: true, data: [row()] });
    loadOptions.mockResolvedValue({ ok: true, data: [] });
    expect(await render()).toContain("take the signed prescription to any pharmacy");
  });
  it("says so when nothing is waiting, without claiming the patient has nothing", async () => {
    loadRoutingRows.mockResolvedValue({ ok: true, data: [] });
    const html = await render();
    expect(html).toContain("No signed prescription is waiting for a pharmacy, or this patient is not on your care team");
  });
  it("a dependant account is told it cannot confirm, and no options are read for it", async () => {
    loadRoutingRows.mockResolvedValue({ ok: true, data: [row({ patient_can_confirm: false })] });
    const html = await render();
    expect(html).toContain("managed by someone else and cannot confirm");
    expect(html).not.toContain("Suggest this pharmacy");
    expect(loadOptions).not.toHaveBeenCalled();
  });
  it("says when it is showing only the most recent prescriptions", async () => {
    const many = Array.from({ length: 7 }, (_, i) => row({ prescription_id: `22222222-2222-4222-8222-22222222222${i}` }));
    loadRoutingRows.mockResolvedValue({ ok: true, data: many });
    loadOptions.mockResolvedValue({ ok: true, data: [] });
    expect(await render()).toContain("Showing the 5 most recent of 7 prescriptions");
  });
});
