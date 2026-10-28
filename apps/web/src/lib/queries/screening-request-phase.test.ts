/**
 * S98: the state a patient sees for a screening that has a self-arranged test request, and the generic in-app text that points at it (INV-07).
 */
import { describe, expect, it } from "@jest/globals";
import { screeningRequestPhase } from "./screening";
import { describe as describeInApp } from "../notifications/describe-in-app";

describe("screeningRequestPhase", () => {
  it("is none when no request was issued", () => {
    expect(screeningRequestPhase(undefined)).toBe("none");
  });
  it("awaits the result until something is uploaded", () => {
    expect(screeningRequestPhase({ upload_count: 0, doctor_reviewed: false })).toBe("awaiting_result");
  });
  it("shows result received after an upload, before a doctor has looked", () => {
    expect(screeningRequestPhase({ upload_count: 1, doctor_reviewed: false })).toBe("result_received");
  });
  it("shows reviewed only when a review is on record", () => {
    expect(screeningRequestPhase({ upload_count: 2, doctor_reviewed: true })).toBe("reviewed");
    expect(screeningRequestPhase({ upload_count: 0, doctor_reviewed: true })).toBe("awaiting_result");
  });
});

describe("screening reminders in the inbox", () => {
  it("say the request is ready when the payload names one, and never echo the test name", () => {
    const out = describeInApp({ template: "screening_due", payload: { screen_type_name: "Lipid panel", lab_order_id: "abc" } });
    expect(out.text).toBe("Your test request is ready to download");
    expect(out.text).not.toMatch(/lipid/i);
    expect(out.href).toBe("/patient/prevention");
  });
  it("keep the old wording when there is no request (or a null one)", () => {
    expect(describeInApp({ template: "screening_due", payload: { lab_order_id: null } }).text).toBe("A reminder is due");
    expect(describeInApp({ template: "screening_overdue", payload: {} }).text).toBe("A reminder is still waiting");
  });
  it("the overdue and escalated versions also point at the waiting request", () => {
    expect(describeInApp({ template: "screening_overdue", payload: { lab_order_id: "x" } }).text).toBe("Your test request is waiting for you");
    expect(describeInApp({ template: "screening_escalated", payload: { lab_order_id: "x" } }).text).toMatch(/test request/);
  });
});
