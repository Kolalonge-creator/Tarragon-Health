import { asNotice, groupFreshness, recordFormSchema, freshnessRowsSchema, type FreshnessRow } from "./model";

const row = (o: Partial<FreshnessRow>): FreshnessRow => ({
  listing_table: "lab_providers",
  listing_id: "11111111-1111-4111-8111-111111111111",
  name: "A lab",
  is_active: true,
  last_verified_at: null,
  verified_by_name: null,
  next_verification_due: null,
  status: "never_verified",
  days_overdue: null,
  can_record: true,
  ...o,
});

describe("groupFreshness", () => {
  it("puts each listing in the list for its status and counts the current ones", () => {
    const g = groupFreshness([row({ status: "overdue", days_overdue: 4 }), row({ status: "due_soon" }), row({}), row({ status: "current" }), row({ status: "current" })]);
    expect([g.overdue.length, g.dueSoon.length, g.neverVerified.length, g.currentCount]).toEqual([1, 1, 1, 2]);
  });
  it("hides nothing: every row lands in a list or the current count", () => {
    const rows = [row({ status: "overdue" }), row({ status: "never_verified" }), row({ status: "current" })];
    const g = groupFreshness(rows);
    expect(g.overdue.length + g.dueSoon.length + g.neverVerified.length + g.currentCount).toBe(rows.length);
  });
});

describe("parsing", () => {
  it("refuses an unknown listing table or status", () => {
    expect(freshnessRowsSchema.safeParse([{ ...row({}), listing_table: "profiles" }]).success).toBe(false);
    expect(freshnessRowsSchema.safeParse([{ ...row({}), status: "hidden" }]).success).toBe(false);
  });
  it("needs a note of at least 10 characters", () => {
    const base = { listing_table: "facilities", listing_id: "11111111-1111-4111-8111-111111111111" };
    expect(recordFormSchema.safeParse({ ...base, note: "short" }).success).toBe(false);
    expect(recordFormSchema.safeParse({ ...base, note: "phoned and confirmed hours" }).success).toBe(true);
  });
  it("only fixed notices are accepted from the address", () => {
    expect(asNotice("recorded")).toBe("recorded");
    expect(asNotice("<b>hi</b>")).toBeNull();
  });
});
