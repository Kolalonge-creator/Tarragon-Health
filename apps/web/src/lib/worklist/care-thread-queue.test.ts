import { describe, expect, it } from "@jest/globals";
import { inView, isNeedsDoctorCloseError } from "./care-thread-queue";

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

  it("recognises only the needs-doctor refusal", () => {
    expect(isNeedsDoctorCloseError({ code: "42501", hint: "needs_doctor" })).toBe(true);
    expect(isNeedsDoctorCloseError({ code: "42501", hint: null })).toBe(false);
    expect(isNeedsDoctorCloseError(new Error("x"))).toBe(false);
  });
});
