import { describe, expect, it } from "@jest/globals";
import { summarise, trainingAttention, trainingDueDate, trainingStatus, worstStatus, type TrainingRecord } from "./training";

const TODAY = "2026-11-07";
const P = "00000000-0000-4000-8000-000000000001";

function rec(over: Partial<TrainingRecord> = {}): TrainingRecord {
  return {
    profile_id: P,
    course_id: "00000000-0000-4000-8000-0000000000c1",
    course_name: "Data protection",
    category: "mandatory",
    renewal_months: 12,
    due_on: "2026-12-07",
    completion_id: null,
    completed_on: null,
    expires_on: null,
    verified: null,
    ...over,
  };
}
const done = (over: Partial<TrainingRecord> = {}) =>
  rec({ completion_id: "00000000-0000-4000-8000-0000000000d1", completed_on: "2026-10-01", expires_on: "2027-10-01", verified: true, ...over });

describe("trainingStatus", () => {
  it("is compliant once verified and in date", () => {
    expect(trainingStatus(done(), TODAY, 30)).toBe("compliant");
    expect(trainingStatus(done({ expires_on: null }), TODAY, 30)).toBe("compliant");
  });

  it("is due soon in the renewal window, overdue once expired", () => {
    expect(trainingStatus(done({ expires_on: "2026-11-30" }), TODAY, 30)).toBe("due_soon");
    expect(trainingStatus(done({ expires_on: "2026-11-01" }), TODAY, 30)).toBe("overdue");
  });

  it("never counts an unverified completion as compliant", () => {
    expect(trainingStatus(done({ verified: false }), TODAY, 30)).toBe("pending_verification");
    // past its due date it is still a record waiting for an admin, not something to record again
    expect(trainingStatus(done({ verified: false, due_on: "2026-11-01" }), TODAY, 30)).toBe("pending_verification");
  });

  it("is due soon until its due date when nothing is recorded, then overdue", () => {
    expect(trainingStatus(rec(), TODAY, 30)).toBe("due_soon");
    expect(trainingStatus(rec({ due_on: TODAY }), TODAY, 30)).toBe("due_soon");
    expect(trainingStatus(rec({ due_on: "2026-11-06" }), TODAY, 30)).toBe("overdue");
  });

  it("dates a verified record by its expiry, anything else by its due date", () => {
    expect(trainingDueDate(done())).toBe("2027-10-01");
    expect(trainingDueDate(done({ verified: false }))).toBe("2026-12-07");
  });
});

describe("summaries", () => {
  it("picks the worst status for a person", () => {
    expect(worstStatus(["compliant", "due_soon", "pending_verification"])).toBe("pending_verification");
    expect(worstStatus(["compliant", "overdue"])).toBe("overdue");
    expect(worstStatus([])).toBeNull();
  });

  it("counts mandatory requirements only, as plain counts", () => {
    const s = summarise([done(), rec({ due_on: "2026-11-01" }), done({ verified: false }), done({ category: "professional", verified: false })], TODAY, 30);
    expect(s).toEqual({ required: 3, compliant: 1, overdue: 1, pendingVerification: 1, dueSoon: 0 });
  });
});

describe("trainingAttention", () => {
  const people = new Map([[P, { name: "Ada Obi", department: "Operations" }]]);

  it("raises overdue mandatory training as high and a waiting record as low", () => {
    const items = trainingAttention([rec({ due_on: "2026-11-01" }), done({ verified: false, course_name: "Safeguarding" })], people, TODAY, 30);
    expect(items.map((i) => [i.kind, i.priority])).toEqual([
      ["training_overdue", "high"],
      ["training_pending_verification", "low"],
    ]);
    expect(items[0]?.href).toBe(`/admin/people/${P}?tab=training`);
  });

  it("raises a record waiting past its due date as medium, with the verify step", () => {
    const [item] = trainingAttention([done({ verified: false, due_on: "2026-11-01" })], people, TODAY, 30);
    expect([item?.kind, item?.priority, item?.nextAction]).toEqual(["training_pending_verification", "medium", "Check the evidence and verify"]);
  });

  it("raises overdue professional development as medium, and nothing for compliant or test people", () => {
    expect(trainingAttention([rec({ category: "professional", due_on: "2026-11-01" })], people, TODAY, 30)[0]?.priority).toBe("medium");
    expect(trainingAttention([done()], people, TODAY, 30)).toEqual([]);
    expect(trainingAttention([rec({ due_on: "2026-11-01" })], new Map(), TODAY, 30)).toEqual([]);
  });
});
