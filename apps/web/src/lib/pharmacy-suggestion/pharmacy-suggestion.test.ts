import { readFileSync } from "node:fs";
import { join } from "node:path";

const rpc = jest.fn();
const revalidatePath = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
let user: { id: string } | null = { id: "u1" };
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }), getCurrentUser: async () => user }));

import { suggestPharmacyAction, withdrawSuggestionAction } from "./actions";
import { loadOptions, loadRoutingRows } from "./load";
import { optionRowsSchema, proximityLabel, routingRowsSchema, statusLabel, stockLabel } from "./model";

const PAT = "11111111-1111-4111-8111-111111111111";
const RX = "22222222-2222-4222-8222-222222222222";
const P = "33333333-3333-4333-8333-333333333333";
const L = "44444444-4444-4444-8444-444444444444";
const S = "55555555-5555-4555-8555-555555555555";
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};
const form = { patientId: PAT, prescriptionId: RX, partnerId: P, locationId: L };

beforeEach(() => {
  rpc.mockReset();
  revalidatePath.mockReset();
  user = { id: "u1" };
});

describe("suggestPharmacyAction", () => {
  it("records a suggestion through the one database function and says nothing was sent", async () => {
    rpc.mockResolvedValue({ data: { suggestion_id: S, patient_id: PAT }, error: null });
    const r = await suggestPharmacyAction(undefined, fd(form));
    expect(revalidatePath).toHaveBeenCalledWith(`/clinician/patients/${PAT}`);
    expect(rpc).toHaveBeenCalledWith("care_team_suggest_pharmacy", { p_prescription: RX, p_partner: P, p_location: L });
    expect(r?.ok).toBe(true);
    expect(r?.message).toMatch(/nothing is sent until the patient confirms/);
  });
  it("refreshes the chart of the patient the DATABASE names, not the one the form claims", async () => {
    const OTHER = "99999999-9999-4999-8999-999999999999";
    rpc.mockResolvedValue({ data: { suggestion_id: S, patient_id: OTHER }, error: null });
    await suggestPharmacyAction(undefined, fd(form));
    expect(revalidatePath).toHaveBeenCalledWith(`/clinician/patients/${OTHER}`);
    expect(revalidatePath).not.toHaveBeenCalledWith(`/clinician/patients/${PAT}`);
  });
  it("never calls the database with a malformed id", async () => {
    const r = await suggestPharmacyAction(undefined, fd({ ...form, partnerId: "nope" }));
    expect(rpc).not.toHaveBeenCalled();
    expect(r?.ok).toBe(false);
  });
  it("needs a signed-in user", async () => {
    user = null;
    const r = await suggestPharmacyAction(undefined, fd(form));
    expect(rpc).not.toHaveBeenCalled();
    expect(r?.ok).toBe(false);
  });
  it("a refusal is a message, never a success", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "pharmacy_not_available", code: "22023" } });
    expect((await suggestPharmacyAction(undefined, fd(form)))?.ok).toBe(false);
    rpc.mockResolvedValue({ data: null, error: { message: "not authorised", code: "42501" } });
    const r = await suggestPharmacyAction(undefined, fd(form));
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/Nothing was sent/);
    rpc.mockResolvedValue({ data: null, error: { message: "patient_cannot_confirm", code: "22023" } });
    expect((await suggestPharmacyAction(undefined, fd(form)))?.message).toMatch(/managed by someone else/);
  });
});

describe("withdrawSuggestionAction", () => {
  it("withdraws only by id and says it worked", async () => {
    rpc.mockResolvedValue({ data: { withdrawn: true, patient_id: PAT }, error: null });
    const r = await withdrawSuggestionAction(undefined, fd({ patientId: PAT, suggestionId: S }));
    expect(rpc).toHaveBeenCalledWith("care_team_withdraw_pharmacy_suggestion", { p_suggestion: S });
    expect(r?.ok).toBe(true);
    rpc.mockClear();
    expect((await withdrawSuggestionAction(undefined, fd({ patientId: PAT, suggestionId: "x" })))?.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a refusal and an already-settled suggestion are said out loud, never shown as success", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "not authorised", code: "42501" } });
    const refused = await withdrawSuggestionAction(undefined, fd({ patientId: PAT, suggestionId: S }));
    expect(refused?.ok).toBe(false);
    expect(refused?.message).toMatch(/Only the clinician who made the suggestion/);
    rpc.mockResolvedValue({ data: null, error: { message: "network", code: "08006" } });
    const failed = await withdrawSuggestionAction(undefined, fd({ patientId: PAT, suggestionId: S }));
    expect(failed?.message).toMatch(/Please try again/);
    expect(failed?.message).not.toMatch(/Only the clinician/);
    rpc.mockResolvedValue({ data: { withdrawn: false, patient_id: PAT }, error: null });
    const settled = await withdrawSuggestionAction(undefined, fd({ patientId: PAT, suggestionId: S }));
    expect(settled?.ok).toBe(false);
    expect(settled?.message).toMatch(/already settled/);
  });
  it("needs a signed-in user", async () => {
    user = null;
    expect((await withdrawSuggestionAction(undefined, fd({ patientId: PAT, suggestionId: S })))?.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("audited reads", () => {
  it("send a reason and treat an error or a surprise shape as unavailable, never as an empty list", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom", code: "XX000" } });
    expect(await loadRoutingRows(PAT)).toEqual({ ok: false });
    expect(await loadOptions(PAT, RX)).toEqual({ ok: false });
    expect(rpc.mock.calls[0][1].p_reason.length).toBeGreaterThanOrEqual(10);
    // a column nobody agreed to (an earning, say) makes the whole read fail rather than reach the screen
    rpc.mockResolvedValue({
      data: [{ partner_id: P, partner_name: "A", location_id: L, location_name: "B", address: null, state: null, proximity: "same_city", in_stock: "yes", listable: true, [["commission", "rate"].join("_")]: 0.4 }],
      error: null,
    });
    expect(await loadOptions(PAT, RX)).toEqual({ ok: false });
  });
  it("accept exactly the neutral columns", async () => {
    const row = { partner_id: P, partner_name: "A", location_id: L, location_name: "B", address: null, state: "Lagos", proximity: "same_state", in_stock: "no", listable: true };
    rpc.mockResolvedValue({ data: [row], error: null });
    expect(await loadOptions(PAT, RX)).toEqual({ ok: true, data: [row] });
    expect(optionRowsSchema.safeParse([{ ...row, proximity: "far" }]).success).toBe(false);
    expect(routingRowsSchema.safeParse([]).success).toBe(true);
  });
});

describe("what a clinician can see (spec 8.16)", () => {
  const BAD = /\b(commission|margin|earn\w*|payout|rate_bps|price\w*|naira|kobo)\b/i;
  const files = [
    "apps/web/src/lib/pharmacy-suggestion/model.ts",
    "apps/web/src/lib/pharmacy-suggestion/load.ts",
    "apps/web/src/lib/pharmacy-suggestion/actions.ts",
    "apps/web/src/app/(dashboard)/clinician/patients/[patientId]/pharmacy-suggestion-panel.tsx",
    "apps/web/src/app/(dashboard)/clinician/patients/[patientId]/suggest-pharmacy-form.tsx",
    "apps/web/src/app/(dashboard)/clinician/patients/[patientId]/withdraw-pharmacy-suggestion-form.tsx",
  ];
  const root = join(__dirname, "../../../../..");
  it.each(files)("%s never names an earning, a margin, a payout or a price outside comments that forbid it", (f) => {
    const code = readFileSync(join(root, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code.match(BAD)).toBeNull();
  });
  it("shows no em dash and no banned word in any label", () => {
    const all = [...Object.values(proximityLabel), ...Object.values(stockLabel), ...Object.values(statusLabel)].join(" ");
    expect(all).not.toMatch(/—|\bcure\b|your doctor|instant doctor/i);
  });
  it("the patient screen suggestion card shows no price or ranking, only the pharmacy and the choice", () => {
    const page = readFileSync(join(root, "apps/web/src/app/(dashboard)/patient/pharmacy/collect/[prescriptionId]/page.tsx"), "utf8");
    const card = page.slice(page.indexOf("function SuggestionCard"), page.indexOf("function SuggestionCard") + 1800);
    expect(card).not.toMatch(/price|kobo|commission|earn|rank/i);
    expect(card).toContain("acceptSuggestionAction");
    expect(card).toContain("declineSuggestionAction");
  });
});
