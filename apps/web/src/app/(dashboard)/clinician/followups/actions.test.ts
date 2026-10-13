const rpc = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({ rpc: (...args: unknown[]) => rpc(...args) }),
}));

import { offerTimes, withdrawOffer } from "./actions";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const OFFER = "33333333-3333-4333-8333-333333333333";

function form(entries: Array<[string, string]>): FormData {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}
const base: Array<[string, string]> = [
  ["times", "2026-10-13T09:00"],
  ["times", "2026-10-13T09:30"],
  ["kind", "monthly"],
  ["minutes", ""],
];

beforeEach(() => rpc.mockReset());

describe("offerTimes", () => {
  it("offers to one Member through the single function, with Lagos times turned into instants", async () => {
    rpc.mockResolvedValue({ data: { status: "offered", offer_id: OFFER, minutes: 15, slots: 2 }, error: null });
    const r = await offerTimes(undefined, form([["patients", P1], ...base]));
    expect(r?.message).toMatch(/Offer sent/);
    expect(rpc).toHaveBeenCalledWith("offer_followup_slots", {
      p_patient: P1,
      p_starts: ["2026-10-13T08:00:00.000Z", "2026-10-13T08:30:00.000Z"],
      p_kind: "monthly",
      p_minutes: null,
    });
  });

  it("uses the bulk function for several Members and reports who was not offered, with the database's reason", async () => {
    rpc.mockResolvedValue({
      data: {
        offered: 1,
        fewer_times_than_people: false,
        results: [
          { patient_id: P1, status: "offered", offer_id: OFFER },
          { patient_id: P2, status: "refused", reason: "monthly check-ins are part of Membership, and this person is not a Member" },
        ],
      },
      error: null,
    });
    const r = await offerTimes(undefined, form([["patients", P1], ["patients", P2], ...base]));
    expect(rpc.mock.calls[0]?.[0]).toBe("offer_followup_slots_bulk");
    expect(r?.message).toBe("1 offered, 1 not offered.");
    expect(r?.refused).toEqual(["monthly check-ins are part of Membership, and this person is not a Member"]);
  });

  it("refuses a choice of call length for more than one Member before calling the database", async () => {
    const r = await offerTimes(undefined, form([["patients", P1], ["patients", P2], ["times", "2026-10-13T09:00"], ["times", "2026-10-13T09:30"], ["kind", "monthly"], ["minutes", "10"]]));
    expect(r?.error).toMatch(/only when you offer to one Member/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("checks the form before it calls the database", async () => {
    expect((await offerTimes(undefined, form([...base])))?.error).toMatch(/at least one Member/);
    expect((await offerTimes(undefined, form([["patients", P1], ["times", "2026-10-13T09:00"], ["kind", "monthly"]])))?.error).toMatch(/2 to 6 different times/);
    expect((await offerTimes(undefined, form([["patients", P1], ["times", "soon"], ["times", "2026-10-13T09:00"], ["kind", "monthly"]])))?.error).toMatch(/not a valid date/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows the database's plain refusal, and a generic line for anything else", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "that person is not one of your patients" } });
    expect((await offerTimes(undefined, form([["patients", P1], ...base])))?.error).toBe("that person is not one of your patients");
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "boom internals" } });
    expect((await offerTimes(undefined, form([["patients", P1], ...base])))?.error).toMatch(/could not be sent/);
  });

  it("does not guess when the answer cannot be read", async () => {
    rpc.mockResolvedValue({ data: { surprise: true }, error: null });
    expect((await offerTimes(undefined, form([["patients", P1], ...base])))?.error).toMatch(/could not be sent/);
  });
});

describe("withdrawOffer", () => {
  it("withdraws by id", async () => {
    rpc.mockResolvedValue({ data: { status: "withdrawn" }, error: null });
    const r = await withdrawOffer(undefined, form([["offer_id", OFFER]]));
    expect(rpc).toHaveBeenCalledWith("withdraw_followup_offer", { p_offer: OFFER });
    expect(r?.message).toBe("Withdrawn");
  });
  it("refuses a bad id before calling the database", async () => {
    const r = await withdrawOffer(undefined, form([["offer_id", "nope"]]));
    expect(r?.error).toMatch(/could not be withdrawn/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("explains a refusal", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "offer not found" } });
    expect((await withdrawOffer(undefined, form([["offer_id", OFFER]])))?.error).toMatch(/do not have access/);
  });
});
