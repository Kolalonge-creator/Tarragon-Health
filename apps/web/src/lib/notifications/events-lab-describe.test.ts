import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "@jest/globals";
import { describe as describeInApp } from "./describe-in-app";

/**
 * E8 of the events harness. packages/db/tests/events_lab_order_to_specimen_notices.sql drives a lab order from request to a rejected
 * sample and lists, on its `E8_IN_APP` line, every in-app template that path queues. Each of them must have its own bell wording.
 * Before E8 the rejected-sample notices (patient and Chief Medical Officer) fell to the generic "You have an update" linking to
 * /patient, so a patient was not told a new sample was needed and the CMO was sent to a patient page.
 */
const GENERIC = describeInApp({ template: "no_such_template_e8", payload: {} });

const sql = readFileSync(join(__dirname, "../../../../../packages/db/tests/events_lab_order_to_specimen_notices.sql"), "utf8");
const listed = /^-- E8_IN_APP:\s*(.+)$/m.exec(sql)?.[1]?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];

describe("E8: every in-app notice the lab order path queues has its own wording", () => {
  it("the proof lists the templates", () => {
    expect(listed.length).toBeGreaterThanOrEqual(5);
    expect(GENERIC.text).toBe("You have an update");
  });

  for (const template of listed) {
    it(`${template} is not the generic line`, () => {
      const out = describeInApp({ template, payload: { reason: "Label did not match", specimen_number: "SP-1", order_number: "LO-1" } });
      expect(out.text).not.toBe(GENERIC.text);
      expect(out.text.length).toBeGreaterThan(10);
    });
  }

  it("a rejected sample is explained to the patient without showing the reason, and links to their labs", () => {
    for (const template of ["lab_specimen_rejected_recollection_needed", "lab_sample_rejected"]) {
      const out = describeInApp({ template, payload: { reason: "Label did not match", specimen_number: "SP-1" } });
      expect(out.href).toBe("/patient/labs");
      expect(out.text).toMatch(/new one is needed/);
      expect(out.text).not.toMatch(/Label did not match|SP-1/);
      expect(out.text).not.toMatch(/—/);
    }
  });

  it("the Chief Medical Officer's copy links to a staff page, never a patient one", () => {
    const out = describeInApp({ template: "lab_specimen_rejected_recollection_needed_staff", payload: {} });
    expect(out.href).toBe("/clinician");
  });
});
