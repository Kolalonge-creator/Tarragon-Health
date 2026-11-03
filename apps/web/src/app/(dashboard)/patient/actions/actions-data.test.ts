import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));

import { bucketActionItems, type ActionItem } from "./actions-data";

const now = new Date("2026-11-03T10:00:00+01:00");

function item(partial: Partial<ActionItem> & { dueDate: string | null }): ActionItem {
  return { icon: "preventive", type: "Screening", title: "x", href: "/patient/prevention", ...partial };
}

describe("bucketActionItems", () => {
  it("keeps a screening scheduled four days ago out of High priority while it is inside its grace window", () => {
    const buckets = bucketActionItems([item({ dueDate: "2026-10-30", graceDays: 30 })], now);
    expect(buckets.highPriority).toHaveLength(0);
    expect(buckets.dueToday).toHaveLength(1);
  });

  it("still treats an item with no grace as overdue the day after its date", () => {
    const buckets = bucketActionItems([item({ dueDate: "2026-11-02", type: "Refill" })], now);
    expect(buckets.highPriority).toHaveLength(1);
    expect(buckets.dueToday).toHaveLength(0);
  });

  it("moves a screening to High priority once the grace window has passed", () => {
    const buckets = bucketActionItems([item({ dueDate: "2026-09-20", graceDays: 30 })], now);
    expect(buckets.highPriority).toHaveLength(1);
  });

  it("buckets the rest by date window as before", () => {
    const buckets = bucketActionItems(
      [
        item({ dueDate: null, alwaysHighPriority: true, type: "Video call" }),
        item({ dueDate: "2026-11-03", type: "Review" }),
        item({ dueDate: "2026-11-08", type: "Review" }),
        item({ dueDate: "2026-12-01", type: "Review" }),
      ],
      now,
    );
    expect(buckets.highPriority.map((i) => i.type)).toEqual(["Video call"]);
    expect(buckets.dueToday).toHaveLength(1);
    expect(buckets.dueThisWeek).toHaveLength(1);
    expect(buckets.upcoming).toHaveLength(1);
  });
});
