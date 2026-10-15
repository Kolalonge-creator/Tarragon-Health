import { approveGrantSchema, cancelGrantSchema, confirmDonationSchema, describeFundError, nairaToKobo } from "./admin";

const id = "11111111-2222-4333-8444-555555555555";

describe("operations forms for the Community Access Fund", () => {
  it("converts whole naira to integer kobo", () => {
    expect(nairaToKobo(3000)).toBe(300_000);
    expect(Number.isInteger(nairaToKobo(1))).toBe(true);
  });
  it("a grant needs a person, an item, whole naira, a published-shaped reason key and a written reason", () => {
    const ok = { patientId: id, itemCode: "membership_annual", naira: "3000", criterion: "care_cost_is_a_barrier", note: "Asked through the care team." };
    expect(approveGrantSchema.safeParse(ok).success).toBe(true);
    expect(approveGrantSchema.safeParse({ ...ok, naira: "12.5" }).success).toBe(false);
    expect(approveGrantSchema.safeParse({ ...ok, naira: "0" }).success).toBe(false);
    expect(approveGrantSchema.safeParse({ ...ok, note: "short" }).success).toBe(false);
    expect(approveGrantSchema.safeParse({ ...ok, patientId: "nope" }).success).toBe(false);
    expect(approveGrantSchema.safeParse({ ...ok, criterion: "Made Up!" }).success).toBe(false);
  });
  it("confirming a gift needs the bank reference and a reason", () => {
    expect(confirmDonationSchema.safeParse({ id, bankReference: "TRF-1234", note: "Seen on the statement." }).success).toBe(true);
    expect(confirmDonationSchema.safeParse({ id, bankReference: "ab", note: "Seen on the statement." }).success).toBe(false);
    expect(confirmDonationSchema.safeParse({ id, bankReference: "TRF-1234", note: "no" }).success).toBe(false);
  });
  it("cancelling needs a reason", () => {
    expect(cancelGrantSchema.safeParse({ id, reason: "No longer needed here." }).success).toBe(true);
    expect(cancelGrantSchema.safeParse({ id, reason: "short" }).success).toBe(false);
  });
  it("database refusals become plain sentences, and the unknown one is general", () => {
    expect(describeFundError("fund_pool_short")).toMatch(/does not hold enough/);
    expect(describeFundError("grant_already_open")).toMatch(/already has an open grant/);
    expect(describeFundError("something odd")).toBe("Something went wrong. Please try again.");
    expect(describeFundError(undefined)).toBe("Something went wrong. Please try again.");
  });
});
