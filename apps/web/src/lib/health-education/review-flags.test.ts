import { flaggedButStillLive, isPastReviewDate, lagosToday } from "./review-flags";

type Item = Parameters<typeof flaggedButStillLive>[0][number];
const item = (over: Partial<Item>): Item => ({
  content_status: "review_due",
  is_active: true,
  next_review_due: null,
  ...over,
});

describe("health education review flags (F1, OQ-F1-04)", () => {
  it("uses the Lagos calendar day, not UTC", () => {
    // 23:30 UTC on 1 March is already 00:30 on 2 March in Lagos (UTC+1)
    expect(lagosToday(new Date("2027-03-01T23:30:00Z"))).toBe("2027-03-02");
  });

  it("a review date of today or earlier is past; no date is never past", () => {
    expect(isPastReviewDate({ next_review_due: "2027-03-02" }, "2027-03-02")).toBe(true);
    expect(isPastReviewDate({ next_review_due: "2027-03-03" }, "2027-03-02")).toBe(false);
    expect(isPastReviewDate({ next_review_due: null }, "2027-03-02")).toBe(false);
  });

  it("a flagged item with no date, or a future date, is listed as flagged but still live", () => {
    const items = [item({}), item({ next_review_due: "2027-06-01" })];
    expect(flaggedButStillLive(items, "2027-03-02")).toHaveLength(2);
  });

  it("an item already past its own date is hidden, so it is not in the still-live notice", () => {
    expect(flaggedButStillLive([item({ next_review_due: "2027-03-01" })], "2027-03-02")).toHaveLength(0);
  });

  it("published and unflagged items are never in the notice", () => {
    expect(flaggedButStillLive([item({ content_status: "published" })], "2027-03-02")).toHaveLength(0);
  });
});
