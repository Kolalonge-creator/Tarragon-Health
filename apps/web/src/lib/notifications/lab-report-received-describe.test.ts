import { describe, expect, it } from "@jest/globals";
import { describe as describeInApp } from "./describe-in-app";

/**
 * CDE-08: when the care team uploads a report the patient is told one was added, and nothing else. The wording is fixed, so a
 * payload carrying anything (it should carry only the intake id) can never reach the bell.
 */
describe("lab_report_received", () => {
  it("says a report was added and will be reviewed, with no test, value or laboratory", () => {
    const out = describeInApp({
      template: "lab_report_received",
      payload: { clinical_document_id: "x", test: "HIV", value: "Reactive", lab: "Synlab" },
    });
    expect(out.href).toBe("/patient/labs");
    expect(out.text).toMatch(/added a report/);
    expect(out.text).toMatch(/review/);
    expect(out.text).not.toMatch(/HIV|Reactive|Synlab/);
    expect(out.text).not.toMatch(/—/);
  });
});
