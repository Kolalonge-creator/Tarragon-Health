const rpc = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({ rpc: (...args: unknown[]) => rpc(...args) }),
}));

import { clearOrganisationPrice, setOrganisationPrice } from "./actions";
import { organisationPriceLimits } from "./limits";

const ORG = "6f1c3c9e-5b7a-4f0e-9a43-0d7a0c6c1a11";
const form = (entries: Record<string, string>): FormData => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};
beforeEach(() => rpc.mockReset());

describe("the floor and ceiling come from the proposed config", () => {
  it("is 50,000 to 200,000 naira in kobo", () => {
    expect(organisationPriceLimits()).toEqual({ minKobo: 5_000_000, maxKobo: 20_000_000 });
  });
});

describe("setOrganisationPrice", () => {
  const base = { organisation_id: ORG, naira: "95000", starts_on: "", reason: "Negotiated for a large employer" };

  it("converts whole naira to integer kobo exactly and sets one organisation's price", async () => {
    rpc.mockResolvedValue({ data: "p1", error: null });
    const r = await setOrganisationPrice(undefined, form(base));
    expect(r?.message).toBe("Organisation price saved.");
    expect(rpc).toHaveBeenCalledWith("set_organisation_member_price", expect.objectContaining({ p_employer_org: ORG, p_amount_kobo: 9_500_000, p_reason: base.reason }));
  });

  it("sets the default when no organisation is chosen", async () => {
    rpc.mockResolvedValue({ data: "p1", error: null });
    const r = await setOrganisationPrice(undefined, form({ ...base, organisation_id: "", naira: "100000" }));
    expect(r?.message).toBe("Default price saved.");
    expect(rpc).toHaveBeenCalledWith("set_default_organisation_member_price", expect.objectContaining({ p_amount_kobo: 10_000_000 }));
  });

  it("starts at the start of the chosen day in Lagos", async () => {
    rpc.mockResolvedValue({ data: "p1", error: null });
    await setOrganisationPrice(undefined, form({ ...base, starts_on: "2026-11-01" }));
    expect(rpc).toHaveBeenCalledWith("set_organisation_member_price", expect.objectContaining({ p_valid_from: "2026-10-31T23:00:00.000Z" }));
  });

  it("refuses a one naira typo and an absurd amount before the database is called", async () => {
    for (const naira of ["1", "100", "49999", "200001", "999999999"]) {
      const r = await setOrganisationPrice(undefined, form({ ...base, naira }));
      expect(r?.error).toMatch(/between ₦50,000 and ₦200,000/);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("accepts the band's edges", async () => {
    rpc.mockResolvedValue({ data: "p1", error: null });
    expect((await setOrganisationPrice(undefined, form({ ...base, naira: "50000" })))?.message).toBeDefined();
    expect((await setOrganisationPrice(undefined, form({ ...base, naira: "200000" })))?.message).toBeDefined();
  });

  it("refuses fractions, letters, a short reason, a bad organisation id and a bad date", async () => {
    for (const over of [{ naira: "95000.5" }, { naira: "abc" }, { naira: "" }, { reason: "short" }, { organisation_id: "not-a-uuid" }, { starts_on: "soon" }]) {
      expect((await setOrganisationPrice(undefined, form({ ...base, ...over })))?.error).toBeDefined();
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps the database's refusals to sentences", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "catalogue_not_authorised" } });
    expect((await setOrganisationPrice(undefined, form(base)))?.error).toMatch(/admin/);
    rpc.mockResolvedValue({ data: null, error: { message: "organisation_price_out_of_range" } });
    expect((await setOrganisationPrice(undefined, form(base)))?.error).toMatch(/outside the allowed band/);
    rpc.mockResolvedValue({ data: null, error: { message: "price_start_before_current" } });
    expect((await setOrganisationPrice(undefined, form(base)))?.error).toMatch(/must start after/);
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await setOrganisationPrice(undefined, form(base)))?.error).toMatch(/did not save/);
  });
});

describe("clearOrganisationPrice", () => {
  it("puts an organisation back on the default", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const r = await clearOrganisationPrice(undefined, form({ organisation_id: ORG, starts_on: "", reason: "Back to the flat price now" }));
    expect(r?.message).toBe("Back on the default price.");
    expect(rpc).toHaveBeenCalledWith("clear_organisation_member_price", expect.objectContaining({ p_employer_org: ORG, p_reason: "Back to the flat price now" }));
  });
  it("needs an organisation and a reason", async () => {
    expect((await clearOrganisationPrice(undefined, form({ organisation_id: "", reason: "Back to the flat price now" })))?.error).toBeDefined();
    expect((await clearOrganisationPrice(undefined, form({ organisation_id: ORG, reason: "short" })))?.error).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("explains an organisation with no price of its own", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "organisation_price_no_override" } });
    expect((await clearOrganisationPrice(undefined, form({ organisation_id: ORG, reason: "Back to the flat price now" })))?.error).toMatch(/no price of its own/);
  });
});
