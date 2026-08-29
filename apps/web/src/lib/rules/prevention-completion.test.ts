import { describe, expect, it } from "@jest/globals";
import {
  computePreventionCompletion,
  lifestyleCategoryStatus,
  type PreventionItem,
} from "./prevention-completion";

describe("computePreventionCompletion", () => {
  it("marks a category complete when every item is completed", () => {
    const items: PreventionItem[] = [
      { category: "cardiovascular", status: "completed" },
      { category: "cardiovascular", status: "completed" },
    ];
    const [summary] = computePreventionCompletion(items);
    expect(summary.status).toBe("complete");
    expect(summary.totalCount).toBe(2);
  });

  it("marks a category needing attention when anything is pending/booked/overdue", () => {
    const items: PreventionItem[] = [
      { category: "cancer", status: "completed" },
      { category: "cancer", status: "overdue" },
    ];
    const [summary] = computePreventionCompletion(items);
    expect(summary.status).toBe("needs_attention");
    expect(summary.overdueCount).toBe(1);
  });

  it("ignores cancelled items entirely", () => {
    const items: PreventionItem[] = [{ category: "metabolic", status: "cancelled" }];
    expect(computePreventionCompletion(items)).toHaveLength(0);
  });

  it("groups multiple categories independently", () => {
    const items: PreventionItem[] = [
      { category: "cardiovascular", status: "pending" },
      { category: "vaccination", status: "completed" },
    ];
    const summaries = computePreventionCompletion(items);
    const byCategory = new Map(summaries.map((s) => [s.category, s]));
    expect(byCategory.get("cardiovascular")?.status).toBe("needs_attention");
    expect(byCategory.get("vaccination")?.status).toBe("complete");
  });

  it("counts due vs overdue separately", () => {
    const items: PreventionItem[] = [
      { category: "cardiovascular", status: "pending" },
      { category: "cardiovascular", status: "booked" },
      { category: "cardiovascular", status: "overdue" },
    ];
    const [summary] = computePreventionCompletion(items);
    expect(summary.dueCount).toBe(2);
    expect(summary.overdueCount).toBe(1);
  });
});

describe("lifestyleCategoryStatus", () => {
  const today = new Date("2026-08-27T00:00:00Z");

  it("is needs_attention when never assessed", () => {
    expect(lifestyleCategoryStatus(null, today).status).toBe("needs_attention");
  });

  it("is complete when assessed within the last 12 months", () => {
    expect(lifestyleCategoryStatus("2026-06-01T00:00:00Z", today).status).toBe("complete");
  });

  it("is needs_attention once 12+ months have passed", () => {
    expect(lifestyleCategoryStatus("2025-08-01T00:00:00Z", today).status).toBe("needs_attention");
  });
});
