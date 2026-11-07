import { describe, expect, it } from "@jest/globals";
import {
  handoverDeclineProblem,
  handoverRequestProblem,
  handoversOfferedTo,
  isEscalationHandoverStatus,
  isHandoverOverdue,
  overdueHandoversForOversight,
} from "./escalation-handover";

describe("handoverRequestProblem (DW-19)", () => {
  const ok = { toProfileId: "doc-b", reason: "Going on leave tomorrow", outstandingAction: "Call the patient about BP" };

  it("accepts a request with a doctor, a reason and an outstanding action", () => {
    expect(handoverRequestProblem(ok)).toBeNull();
  });

  it("asks for the doctor first", () => {
    expect(handoverRequestProblem({ ...ok, toProfileId: "" })).toMatch(/Choose the doctor/);
  });

  it("refuses a reason or action under 10 characters once trimmed", () => {
    expect(handoverRequestProblem({ ...ok, reason: "   ten chars!   " })).toBeNull();
    expect(handoverRequestProblem({ ...ok, reason: "  short  " })).toMatch(/why you are handing/);
    expect(handoverRequestProblem({ ...ok, outstandingAction: "call" })).toMatch(/what still needs doing/);
  });

  it("refuses text over 1000 characters", () => {
    expect(handoverRequestProblem({ ...ok, reason: "x".repeat(1001) })).toMatch(/under 1000/);
  });
});

describe("handoverDeclineProblem (DW-18)", () => {
  it("needs a reason of at least 10 characters", () => {
    expect(handoverDeclineProblem("busy")).toMatch(/why you are declining/);
    expect(handoverDeclineProblem("At my case limit today")).toBeNull();
  });
});

describe("isHandoverOverdue (DW-18)", () => {
  const now = new Date("2026-11-07T10:00:00Z");
  it("is overdue at or after the acknowledge-by time, not before", () => {
    expect(isHandoverOverdue({ acknowledge_by: "2026-11-07T09:59:00Z" }, now)).toBe(true);
    expect(isHandoverOverdue({ acknowledge_by: "2026-11-07T10:00:00Z" }, now)).toBe(true);
    expect(isHandoverOverdue({ acknowledge_by: "2026-11-07T10:01:00Z" }, now)).toBe(false);
  });
});

describe("isEscalationHandoverStatus", () => {
  it("knows the five database statuses and nothing else", () => {
    for (const s of ["pending", "accepted", "declined", "cancelled", "superseded"]) expect(isEscalationHandoverStatus(s)).toBe(true);
    expect(isEscalationHandoverStatus("expired")).toBe(false);
  });
});

describe("overdueHandoversForOversight and handoversOfferedTo", () => {
  const now = new Date("2026-11-07T10:00:00Z");
  const h = (id: string, over: Partial<{ acknowledge_by: string; is_critical: boolean; patient_is_test: boolean; to_profile_id: string }>) => ({
    id,
    acknowledge_by: "2026-11-07T09:00:00Z",
    is_critical: false,
    patient_is_test: false,
    to_profile_id: "doc-b",
    ...over,
  });
  const rows = [
    h("late-routine", { acknowledge_by: "2026-11-07T08:00:00Z" }),
    h("late-critical", { acknowledge_by: "2026-11-07T09:50:00Z", is_critical: true }),
    h("not-yet", { acknowledge_by: "2026-11-07T10:30:00Z" }),
    h("test-patient", { acknowledge_by: "2026-11-07T07:00:00Z", patient_is_test: true }),
    h("for-someone-else", { to_profile_id: "doc-c" }),
  ];

  it("shows the CMO only overdue, real-patient handovers, emergency-level first", () => {
    expect(overdueHandoversForOversight(rows, now).map((r) => r.id)).toEqual(["late-critical", "late-routine", "for-someone-else"]);
  });

  it("shows a doctor only handovers offered to them, never a test patient's", () => {
    expect(handoversOfferedTo(rows, "doc-b").map((r) => r.id)).toEqual(["late-critical", "late-routine", "not-yet"]);
    expect(handoversOfferedTo(rows, null)).toEqual([]);
  });
});
