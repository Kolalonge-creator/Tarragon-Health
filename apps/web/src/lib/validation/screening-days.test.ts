import { requestScreeningDaySchema } from "./screening-days";

const base = { hostName: "Redeemer's Church", location: "Lekki", panelBundleId: "b1", slotsRequested: "20" };

describe("requestScreeningDaySchema event date", () => {
  it("refuses a date that has passed, with a sentence the person can act on", () => {
    const parsed = requestScreeningDaySchema.safeParse({ ...base, eventDate: "2020-01-01" });
    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues[0]?.message).toBe("Choose a date after today.");
  });

  it("refuses a blank date", () => {
    const parsed = requestScreeningDaySchema.safeParse({ ...base, eventDate: "" });
    expect(parsed.success ? "" : parsed.error.issues[0]?.message).toBe("When is it happening?");
  });

  it("accepts a future date", () => {
    expect(requestScreeningDaySchema.safeParse({ ...base, eventDate: "2099-01-01" }).success).toBe(true);
  });
});
