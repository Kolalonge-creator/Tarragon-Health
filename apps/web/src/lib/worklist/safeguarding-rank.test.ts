import { describe, expect, it } from "@jest/globals";
import {
  compareSafeguardingConcerns,
  safeguardingCategoryRank,
  safeguardingCategoryVariant,
} from "./safeguarding-rank";

describe("safeguardingCategoryRank", () => {
  it("ranks immediate_safety_risk ahead of every other category", () => {
    expect(safeguardingCategoryRank("immediate_safety_risk")).toBeLessThan(
      safeguardingCategoryRank("child_safety")
    );
    expect(safeguardingCategoryRank("immediate_safety_risk")).toBeLessThan(
      safeguardingCategoryRank("other")
    );
  });

  it("ranks an unrecognised category the same as the 'other' catch-all bucket", () => {
    expect(safeguardingCategoryRank("mystery")).toBe(safeguardingCategoryRank("other"));
    expect(safeguardingCategoryRank("mystery")).toBeGreaterThan(
      safeguardingCategoryRank("child_safety")
    );
  });
});

describe("safeguardingCategoryVariant", () => {
  it("is grey for any closed concern regardless of how severe the category is", () => {
    // Category colour is a live-queue triage signal, not a permanent label —
    // a closed immediate-safety-risk must not still read as urgent.
    expect(safeguardingCategoryVariant("immediate_safety_risk", "closed")).toBe("grey");
  });

  it("is red only for an open/under-review immediate danger, amber for the rest of open work", () => {
    expect(safeguardingCategoryVariant("immediate_safety_risk", "open")).toBe("red");
    expect(safeguardingCategoryVariant("child_safety", "open")).toBe("amber");
    expect(safeguardingCategoryVariant("other", "under_review")).toBe("amber");
  });
});

describe("compareSafeguardingConcerns", () => {
  it("sorts an open concern ahead of a closed one regardless of category or age", () => {
    // The bug this guards against: the page ordered strictly by created_at
    // desc, so a closed "other" concern from this morning could outrank an
    // open immediate-safety-risk from yesterday.
    const openLowCategory = {
      status: "open",
      concern_category: "other",
      created_at: "2026-09-13T09:00:00Z",
    };
    const closedHighCategory = {
      status: "closed",
      concern_category: "immediate_safety_risk",
      created_at: "2026-09-14T09:00:00Z",
    };
    expect(compareSafeguardingConcerns(openLowCategory, closedHighCategory)).toBeLessThan(0);
  });

  it("within the same status, sorts the more severe category first", () => {
    const immediate = {
      status: "open",
      concern_category: "immediate_safety_risk",
      created_at: "2026-09-14T09:00:00Z",
    };
    const other = { status: "open", concern_category: "other", created_at: "2026-09-14T09:00:00Z" };
    expect(compareSafeguardingConcerns(immediate, other)).toBeLessThan(0);
  });

  it("orders open concerns oldest-first (a queue) but closed ones newest-first (a log)", () => {
    const olderOpen = {
      status: "open",
      concern_category: "other",
      created_at: "2026-09-01T09:00:00Z",
    };
    const newerOpen = {
      status: "open",
      concern_category: "other",
      created_at: "2026-09-10T09:00:00Z",
    };
    expect(compareSafeguardingConcerns(olderOpen, newerOpen)).toBeLessThan(0);

    const olderClosed = {
      status: "closed",
      concern_category: "other",
      created_at: "2026-09-01T09:00:00Z",
    };
    const newerClosed = {
      status: "closed",
      concern_category: "other",
      created_at: "2026-09-10T09:00:00Z",
    };
    expect(compareSafeguardingConcerns(newerClosed, olderClosed)).toBeLessThan(0);
  });
});
