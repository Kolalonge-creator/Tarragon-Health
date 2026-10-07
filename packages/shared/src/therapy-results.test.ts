import { describe, expect, it } from "@jest/globals";
import { classifyRpcError, readEnrolOutcome, readStartOutcome } from "./therapy-results";

describe("therapy results", () => {
  it("a database rejection is permanent and a transport fault is retryable", () => {
    for (const code of ["22023", "42501"]) expect(classifyRpcError({ code })).toBe("permanent");
    for (const code of ["55000", "", "PGRST000", "08006", null, undefined]) expect(classifyRpcError({ code })).toBe("transport");
    expect(classifyRpcError(null)).toBe("transport");
  });
  it("reads a stop with its task flag, and the cooldown reason", () => {
    expect(readStartOutcome({ status: "stopped", route: "crisis", task_failed: true })).toEqual({ kind: "stopped", route: "crisis", taskFailed: true });
    expect(readEnrolOutcome({ enrolled: false, reason: "clinician_review_pending" })).toEqual({ kind: "closed", reason: "clinician_review_pending" });
  });
  it("never reads an unknown shape as success", () => {
    expect(readEnrolOutcome({ enrolled: true })).toEqual({ kind: "unknown" });
    expect(readEnrolOutcome("x")).toEqual({ kind: "unknown" });
    expect(readStartOutcome({ status: "ok" })).toEqual({ kind: "unknown" });
  });
});
