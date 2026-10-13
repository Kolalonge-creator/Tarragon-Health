/**
 * S28: every pharmacy collection notice is neutral (INV-07: no medicine, person, reading or collection code), the in-app lines open the
 * right place, and none of them is an SMS (INV-08: they are in-app only, so the sender has no text for them).
 */
import "./support/deno.ts";
import { describe, expect, it } from "@jest/globals";
import { describeViolations, lintText } from "./index.ts";
import { TEMPLATE_MAP } from "../../../supabase/functions/send-pending-notifications/templates.ts";
import { describe as describeInApp } from "../../../apps/web/src/lib/notifications/describe-in-app.ts";

const KEYS = [
  "pharmacy_new_prescription",
  "pharmacy_question_answered",
  "pharmacy_collection_update",
  "prescription_sent_patient",
  "prescription_collected_patient",
  "pharmacy_flag_notice",
] as const;
const payload = { drug_name: "Amlodipine", collection_code: "K7M2QX9P", patient_name: "Ada Obi", prescription_id: "abc", body: "secret" };

describe("S28 notices", () => {
  for (const key of KEYS) {
    it(`${key}: the in-app line passes the lint and never echoes the payload`, () => {
      const out = describeInApp({ template: key, payload });
      expect(out.text.length).toBeGreaterThan(0);
      expect(out.text).not.toBe(describeInApp({ template: "unknown_template_zz", payload }).text);
      expect(describeViolations(lintText(out.text))).toEqual([]);
      expect(out.text).not.toMatch(/amlodipine|K7M2QX9P|Ada|Obi|secret/i);
    });
    it(`${key}: no SMS text exists for it (INV-08)`, () => {
      expect((TEMPLATE_MAP as Record<string, unknown>)[key]).toBeUndefined();
    });
  }

  it("the notices open the right place", () => {
    expect(describeInApp({ template: "pharmacy_new_prescription", payload }).href).toBe("/pharmacist/prescriptions");
    expect(describeInApp({ template: "pharmacy_question_answered", payload }).href).toBe("/pharmacist/prescriptions");
    expect(describeInApp({ template: "pharmacy_flag_notice", payload }).href).toBe("/clinician/pharmacy");
    expect(describeInApp({ template: "pharmacy_collection_update", payload }).href).toBe("/patient/medications");
    expect(describeInApp({ template: "prescription_sent_patient", payload }).href).toBe("/patient/medications");
  });

  it("the refill reminder stays neutral and opens the Medicines screen, where each prescription links to choosing a pharmacy", () => {
    const refill = describeInApp({ template: "medication_refill_reminder", payload });
    expect(refill.href).toBe("/patient/medications");
    expect(refill.text).not.toMatch(/amlodipine/i);
    expect(describeViolations(lintText(refill.text))).toEqual([]);
  });

  it("the lint would catch a leak (control)", () => {
    expect(lintText("Your care team replied about your blood pressure").length).toBeGreaterThan(0);
  });
});
