import { describe, expect, it } from "@jest/globals";
import { describe as describeInApp } from "./describe-in-app";

/**
 * E6 of the events harness. A booking, its reminder and a cancellation each queue an in-app notice to the patient
 * (packages/db/tests/events_booking_round_trip.sql). None had bell wording, so each read "You have an update" and linked to the
 * dashboard instead of the appointments screen.
 */
const GENERIC = describeInApp({ template: "no_such_template_e6", payload: {} });
const TEMPLATES = ["appointment_booking_confirmation", "appointment_cancelled", "appointment_reminder"];
// 09:00 UTC is 10:00 in Lagos (fixed UTC+1, no daylight saving)
const payload = { appointment_id: "a1", scheduled_for: "2026-11-03T09:00:00Z" };

describe("E6: booking notices have their own bell wording", () => {
  for (const template of TEMPLATES) {
    it(`${template} is not the generic line and opens the appointments screen`, () => {
      const out = describeInApp({ template, payload });
      expect(out.text).not.toBe(GENERIC.text);
      expect(out.href).toBe("/patient/appointments");
      expect(out.text).not.toMatch(/—/);
    });

    it(`${template} reads sensibly when the time is missing or not a date`, () => {
      for (const bad of [{}, { scheduled_for: "not a date" }, { scheduled_for: 5 }]) {
        const out = describeInApp({ template, payload: bad });
        expect(out.text).not.toBe(GENERIC.text);
        expect(out.text).not.toMatch(/Invalid|undefined|null/);
      }
    });
  }

  it("names the day and the Lagos time, not the UTC one", () => {
    const out = describeInApp({ template: "appointment_booking_confirmation", payload });
    expect(out.text).toMatch(/3 Nov/);
    expect(out.text).toMatch(/10:00/);
    expect(out.text).not.toMatch(/09:00/);
  });

  it("a cancellation says it was cancelled", () => {
    expect(describeInApp({ template: "appointment_cancelled", payload }).text).toMatch(/cancelled/);
  });
});
