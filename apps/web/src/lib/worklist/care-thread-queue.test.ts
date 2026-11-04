import { describe, expect, it } from "@jest/globals";
import { inView, isNeedsDoctorCloseError, isNoDoctorAvailableError, isUnanswered, parseInboxView, parseUnansweredOnly } from "./care-thread-queue";

describe("MSG-3 inbox views", () => {
  const support = { queue: "support" as const, needs_doctor: false };
  const clinical = { queue: "clinical" as const, needs_doctor: false };
  const flagged = { queue: "support" as const, needs_doctor: true };

  it("filters by queue, and 'needs a doctor' across both queues", () => {
    expect(inView(support, "support")).toBe(true);
    expect(inView(support, "clinical")).toBe(false);
    expect(inView(clinical, "clinical")).toBe(true);
    expect(inView(flagged, "needs_doctor")).toBe(true);
    expect(inView(clinical, "needs_doctor")).toBe(false);
    for (const t of [support, clinical, flagged]) expect(inView(t, "all")).toBe(true);
  });

  it("treats only an open thread with a running reply clock as unanswered", () => {
    expect(isUnanswered({ status: "open", awaiting_reply_since: "2026-11-04T10:00:00Z" })).toBe(true);
    expect(isUnanswered({ status: "open", awaiting_reply_since: null })).toBe(false);
    expect(isUnanswered({ status: "closed", awaiting_reply_since: "2026-11-04T10:00:00Z" })).toBe(false);
    expect(parseUnansweredOnly("1")).toBe(true);
    expect(parseUnansweredOnly(undefined)).toBe(false);
  });

  it("reads the view from a tile link and ignores anything else", () => {
    expect(parseInboxView("support")).toBe("support");
    expect(parseInboxView(["needs_doctor", "x"])).toBe("needs_doctor");
    expect(parseInboxView("drop table")).toBe("all");
    expect(parseInboxView(undefined)).toBe("all");
  });

  it("recognises the no-doctor-available refusal", () => {
    expect(isNoDoctorAvailableError({ code: "P0001", hint: "no_doctor_available" })).toBe(true);
    expect(isNoDoctorAvailableError({ code: "P0001", hint: "needs_doctor" })).toBe(false);
  });

  it("recognises only the needs-doctor refusal", () => {
    expect(isNeedsDoctorCloseError({ code: "42501", hint: "needs_doctor" })).toBe(true);
    expect(isNeedsDoctorCloseError({ code: "42501", hint: null })).toBe(false);
    expect(isNeedsDoctorCloseError(new Error("x"))).toBe(false);
  });
});
