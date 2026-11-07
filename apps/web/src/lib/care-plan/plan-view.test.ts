import {
  formatPlanDate,
  groupActionsByCategory,
  isCarePlanActionCategory,
  pendingAcknowledgements,
  snapshotActions,
  type CarePlanRevision,
  type PlanActionView,
} from "./plan-view";

const action = (description: string, category: PlanActionView["category"]): PlanActionView => ({
  description,
  frequency: null,
  category,
  why: null,
  when: null,
  how: null,
});

function revision(over: Partial<CarePlanRevision>): CarePlanRevision {
  return {
    id: "r",
    organisation_id: "o",
    patient_id: "p",
    care_plan_id: "c",
    version_number: 1,
    change_summary: "Something changed.",
    needs_acknowledgement: false,
    plan_snapshot: {},
    published_by: "d",
    published_at: "2026-11-01T10:00:00Z",
    acknowledged_at: null,
    acknowledged_by: null,
    ...over,
  };
}

describe("groupActionsByCategory", () => {
  it("groups in the fixed category order and puts uncategorised actions last", () => {
    const groups = groupActionsByCategory([
      action("Walk", "lifestyle"),
      action("Loose", null),
      action("HbA1c", "tests"),
      action("Morning BP", "monitoring"),
      action("Evening BP", "monitoring"),
    ]);
    expect(groups.map((g) => g.category)).toEqual(["tests", "monitoring", "lifestyle", null]);
    expect(groups[1].actions.map((a) => a.description)).toEqual(["Morning BP", "Evening BP"]);
  });

  it("returns no groups for no actions", () => {
    expect(groupActionsByCategory([])).toEqual([]);
  });
});

describe("snapshotActions", () => {
  it("reads why/when/how and category from a snapshot", () => {
    expect(
      snapshotActions({
        actions: [{ description: "Check BP", frequency: "daily", category: "monitoring", why: "W", when: "Mornings", how: "Seated" }],
      }),
    ).toEqual([{ description: "Check BP", frequency: "daily", category: "monitoring", why: "W", when: "Mornings", how: "Seated" }]);
  });

  it("skips malformed entries and unknown categories instead of throwing", () => {
    expect(snapshotActions(null)).toEqual([]);
    expect(snapshotActions([])).toEqual([]);
    expect(snapshotActions({ actions: "x" })).toEqual([]);
    expect(snapshotActions({ actions: [null, 3, { description: "" }, { description: "Ok", category: "nope" }] })).toEqual([
      { description: "Ok", frequency: null, category: null, why: null, when: null, how: null },
    ]);
  });
});

describe("pendingAcknowledgements", () => {
  it("keeps only unacknowledged changes that asked for acknowledgement, oldest first", () => {
    const list = pendingAcknowledgements([
      revision({ id: "late", needs_acknowledgement: true, published_at: "2026-11-05T10:00:00Z" }),
      revision({ id: "done", needs_acknowledgement: true, acknowledged_at: "2026-11-02T10:00:00Z" }),
      revision({ id: "noack", needs_acknowledgement: false }),
      revision({ id: "early", needs_acknowledgement: true, published_at: "2026-11-03T10:00:00Z" }),
    ]);
    expect(list.map((r) => r.id)).toEqual(["early", "late"]);
  });
});

describe("formatPlanDate", () => {
  it("formats timestamps and bare dates in Lagos time", () => {
    expect(formatPlanDate("2026-11-06T23:30:00Z")).toBe("7 Nov 2026");
    expect(formatPlanDate("2027-02-01")).toBe("1 Feb 2027");
  });
  it("returns null for empty or bad input", () => {
    expect(formatPlanDate(null)).toBeNull();
    expect(formatPlanDate("not a date")).toBeNull();
  });
});

describe("isCarePlanActionCategory", () => {
  it("accepts the eight categories only", () => {
    expect(isCarePlanActionCategory("follow_up")).toBe(true);
    expect(isCarePlanActionCategory("other")).toBe(false);
    expect(isCarePlanActionCategory(3)).toBe(false);
  });
});
