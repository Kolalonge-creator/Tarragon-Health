import { chaseLabel } from "./chase";

const NOW = new Date("2026-10-06T09:00:00Z");

describe("chaseLabel", () => {
  it("shows the follow-up date for an open referral", () => {
    expect(chaseLabel({ status: "pending", chase_due_at: "2026-10-13T09:00:00Z" }, NOW)).toBe("Follow up by 13 Oct 2026");
  });

  it("says when the follow-up is overdue", () => {
    expect(chaseLabel({ status: "pending", chase_due_at: "2026-10-01T09:00:00Z" }, NOW)).toBe("Follow-up was due 1 Oct 2026");
  });

  it("shows nothing for a closed, declined, completed or draft referral, or with no date", () => {
    for (const status of ["draft", "declined", "closed", "completed"]) {
      expect(chaseLabel({ status, chase_due_at: "2026-10-13T09:00:00Z" }, NOW)).toBeNull();
    }
    expect(chaseLabel({ status: "pending", chase_due_at: null }, NOW)).toBeNull();
    expect(chaseLabel({ status: "pending", chase_due_at: "not a date" }, NOW)).toBeNull();
  });
});
