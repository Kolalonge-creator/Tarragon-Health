jest.mock("./supabase", () => ({ supabase: { rpc: jest.fn(async () => ({ error: null })) } }));

import { supabase } from "./supabase";
import { requestScreeningDay } from "./screening-days";

const rpc = supabase.rpc as unknown as jest.Mock;
const base = { hostName: "Redeemer's Church", contactPhone: "", location: "Lekki", panelBundleId: "b1", slotsRequested: 20, notes: "" };

describe("requestScreeningDay date check", () => {
  beforeEach(() => rpc.mockClear());

  it("explains a mis-typed date and never calls the database", async () => {
    const result = await requestScreeningDay({ ...base, eventDate: "next friday" });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/year-month-day/) });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a date that has passed", async () => {
    const result = await requestScreeningDay({ ...base, eventDate: "2020-01-01" });
    expect(result).toEqual({ ok: false, error: "Choose a date after today." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends a good future date", async () => {
    const result = await requestScreeningDay({ ...base, eventDate: "2099-01-01" });
    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
