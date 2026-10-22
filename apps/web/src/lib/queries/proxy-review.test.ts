import { describe, expect, it } from "@jest/globals";
import { categoryLabel, dueReviews, parseProxyReviews } from "./proxy-review";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n: number, over: Record<string, unknown> = {}) => ({
  grant_id: id(n),
  grantee_id: id(n + 100),
  first_name: "Chidi",
  since: "2025-09-01T10:00:00Z",
  categories: ["medications"],
  due_at: "2026-09-01T10:00:00Z",
  is_due: true,
  days_overdue: 0,
  last_reviewed_at: null,
  ...over,
});

describe("yearly proxy review client helpers", () => {
  it("parses the RPC payload", () => {
    expect(parseProxyReviews([row(1)])).toHaveLength(1);
    expect(parseProxyReviews(null)).toEqual([]);
  });

  it("a malformed payload throws instead of reading as 'nothing to review'", () => {
    expect(() => parseProxyReviews([{ grant_id: "not-a-uuid" }])).toThrow();
    expect(() => parseProxyReviews({ not: "a list" })).toThrow();
  });

  it("shows only the reviews that are due, oldest first", () => {
    const rows = parseProxyReviews([
      row(1, { is_due: false, due_at: "2027-01-01T00:00:00Z" }),
      row(2, { due_at: "2026-10-01T00:00:00Z" }),
      row(3, { due_at: "2026-08-01T00:00:00Z", days_overdue: 60 }),
    ]);
    expect(dueReviews(rows).map((r) => r.grant_id)).toEqual([id(3), id(2)]);
  });

  it("labels known categories and never prints a raw code for an unknown one", () => {
    expect(categoryLabel("medications")).toBe("Medications");
    expect(categoryLabel("some_future_category")).toBe("Something else");
  });
});
