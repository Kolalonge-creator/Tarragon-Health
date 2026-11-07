import { describe, expect, it } from "@jest/globals";
import { journeyStages, medianText, operationalWarnings, parseJourneySummary } from "./clinical-operations";

const NOW = new Date("2026-11-07T12:00:00Z");

const RAW = {
  generated_at: "2026-11-07T12:00:00Z",
  stages: {
    registered: 10,
    onboarded: 8,
    with_coordinator: 6,
    care_plan_approved: 4,
    investigation_ordered: 3,
    result_received: 2,
    result_reviewed: 1,
    follow_up_raised: 0,
    follow_up_all_closed: 0,
    with_result_document: 1,
  },
  awaiting: {
    onboarding: { count: 2, oldest_days: 12 },
    care_plan_approval: { count: 0, oldest_days: null },
    investigation_result: { count: 1, oldest_days: 9 },
    doctor_review: { count: 1, oldest_days: 3 },
    follow_up_open: { count: 3, oldest_days: 7 },
    follow_up_overdue: { count: 2, oldest_days: 2 },
    no_coordinator: { count: 4, oldest_days: null },
  },
  median_hours: { registered_to_onboarded: "30.5", ordered_to_resulted: 96, uploaded_to_reviewed: null, follow_up_raised_to_closed: null },
};

describe("parseJourneySummary", () => {
  it("reads the RPC answer, numeric strings included", () => {
    const s = parseJourneySummary(RAW);
    expect(s?.stages.registered).toBe(10);
    expect(s?.median_hours.registered_to_onboarded).toBe(30.5);
    expect(s?.median_hours.uploaded_to_reviewed).toBeNull();
    expect(s?.withResultDocument).toBe(1);
  });

  it("is null when the document denominator is missing (an older function), never a guess", () => {
    const stages = { ...RAW.stages } as Record<string, unknown>;
    delete stages.with_result_document;
    expect(parseJourneySummary({ ...RAW, stages })).toBeNull();
  });

  it("returns null instead of zeros when any count is missing or malformed", () => {
    expect(parseJourneySummary(null)).toBeNull();
    expect(parseJourneySummary({ ...RAW, stages: { ...RAW.stages, onboarded: "x" } })).toBeNull();
    const awaiting = { ...RAW.awaiting } as Record<string, unknown>;
    delete awaiting.doctor_review;
    expect(parseJourneySummary({ ...RAW, awaiting })).toBeNull();
  });
});

describe("journeyStages", () => {
  it("gives each stage its share of all registered patients, never a share of the previous stage", () => {
    const stages = journeyStages(parseJourneySummary(RAW)!);
    expect(stages.map((s) => s.reached)).toEqual([10, 8, 6, 4, 3, 2, 1, 0, 0]);
    expect(stages[0]?.ofRegistered).toBeNull();
    expect(stages[1]?.ofRegistered).toEqual({ pct: 80, text: "8 of 10" });
    expect(stages[8]?.ofRegistered).toEqual({ pct: 0, text: "0 of 10" });
  });

  it("never passes 100% when stages are not nested (more coordinators than onboarded patients)", () => {
    const raw = { ...RAW, stages: { ...RAW.stages, onboarded: 3, with_coordinator: 5 } };
    const stages = journeyStages(parseJourneySummary(raw)!);
    expect(stages.every((s) => (s.ofRegistered?.pct ?? 0) <= 100)).toBe(true);
    expect(stages[2]?.ofRegistered?.text).toBe("5 of 10");
  });

  it("has nothing to divide by when nobody is registered", () => {
    const raw = { ...RAW, stages: { ...RAW.stages, registered: 0 } };
    expect(journeyStages(parseJourneySummary(raw)!).every((s) => s.ofRegistered === null)).toBe(true);
  });
});

describe("operationalWarnings", () => {
  it("lists only non-empty waits, never above requires attention, with only due-date breaches at attention", () => {
    const items = operationalWarnings(parseJourneySummary(RAW)!, NOW);
    expect(items.map((i) => [i.key, i.tier])).toEqual([
      ["ops:follow_up_overdue", "attention"],
      ["ops:doctor_review", "routine"],
      ["ops:investigation_result", "routine"],
      ["ops:onboarding", "routine"],
      ["ops:no_coordinator", "routine"],
    ]);
    expect(items.every((i) => i.tier !== "critical" && i.tier !== "high")).toBe(true);
    expect(items[0]?.title).toBe("2 follow-ups past their due date");
    expect(items[0]?.raisedAt).toBe("2026-11-05T12:00:00.000Z");
    expect(items.find((i) => i.key === "ops:no_coordinator")?.raisedAt).toBeNull();
  });
});

describe("medianText", () => {
  it("uses hours under two days and days above", () => {
    expect(medianText(30.5)).toBe("30.5 hours");
    expect(medianText(96)).toBe("4 days");
    expect(medianText(null)).toBeNull();
  });
});
