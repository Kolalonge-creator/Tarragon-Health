import { actionLabel, formatDuration, planLabel, queryInput, reasonOk, sectionLabel, topList } from "./model";

describe("formatDuration", () => {
  it("never shows a real visit as zero", () => {
    expect(formatDuration(0)).toBe("0 min");
    expect(formatDuration(20)).toBe("1 min");
    expect(formatDuration(839)).toBe("14 min");
  });
  it("switches to hours", () => {
    expect(formatDuration(3600)).toBe("1 h");
    expect(formatDuration(5400)).toBe("1 h 30 min");
  });
  it("treats junk as zero", () => {
    expect(formatDuration(Number.NaN)).toBe("0 min");
    expect(formatDuration(-5)).toBe("0 min");
  });
});

describe("planLabel", () => {
  it("names the ladder", () => {
    expect(planLabel({ plan: "plus", membership_state: "active" })).toBe("Membership Plus");
    expect(planLabel({ plan: "evergreen", membership_state: "active" })).toBe("Membership");
  });
  it("does not show an ended or lapsed member as plain Free", () => {
    expect(planLabel({ plan: "free", membership_state: "ended" })).toBe("Free (membership ended)");
    expect(planLabel({ plan: "free", membership_state: "lapsed" })).toBe("Free (membership lapsed)");
    expect(planLabel({ plan: "free", membership_state: null })).toBe("Free");
  });
});

describe("labels", () => {
  it("shows an unknown action key as written rather than dropping it", () => {
    expect(actionLabel("health_log")).toBe("Logged health information");
    // The directory never names which health thing was logged, so no symptom/medication wording exists to show.
    expect(actionLabel("symptom")).toBe("symptom");
    expect(actionLabel("some_new_kind")).toBe("some new kind");
    expect(sectionLabel("my-care-plan")).toBe("My care plan");
    expect(topList([{ key: "health_log", count: 4 }], actionLabel)).toBe("Logged health information (4)");
  });
});

describe("reasonOk / queryInput", () => {
  it("needs 10 to 500 characters once trimmed", () => {
    expect(reasonOk("short")).toBe(false);
    expect(reasonOk("   padded   ")).toBe(false);
    expect(reasonOk("Monthly engagement review")).toBe(true);
    expect(reasonOk("x".repeat(501))).toBe(false);
  });
  it("rejects an unknown segment or sort so nothing odd reaches the database", () => {
    expect(queryInput.safeParse({ segment: "drop table" }).success).toBe(false);
    expect(queryInput.safeParse({ sort: "email" }).success).toBe(false);
    expect(queryInput.parse({}).segment).toBe("all");
  });
});
