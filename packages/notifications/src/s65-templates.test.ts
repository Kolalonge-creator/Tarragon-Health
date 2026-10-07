/**
 * S65: the Care Circle one-tap alert and the facility booking reminder pass the INV-07 lint, say the same neutral thing in the sender
 * renderer and the in-app inbox, and echo nothing from the payload (no location, no name, no facility, no time).
 */
import "./support/deno.ts";
import { describe, expect, it } from "@jest/globals";
import { describeViolations, lintRenderFn, lintText } from "./index.ts";
import { TEMPLATE_MAP } from "../../../supabase/functions/send-pending-notifications/templates.ts";
import { describe as describeInApp } from "../../../apps/web/src/lib/notifications/describe-in-app.ts";

const KEYS = ["circle_help_tap", "facility_booking_reminder"] as const;
const ctx = { notificationId: "n", recipientId: "r" };
const payload = { patient_name: "Ada Obi", latitude: "6.4474", longitude: "3.3903", facility: "Island Diabetes Clinic", slot_at: "2026-10-12T09:00", reading: "182/112", condition: "hypertension" };
const LEAK = /Ada|Obi|6\.4474|3\.3903|Island|Diabetes|Clinic|2026-10|09:00|182|hypertension/i;

describe("S65 notification templates", () => {
  for (const key of KEYS) {
    it(`${key}: sender renderer passes the lint and never echoes the payload`, () => {
      const fn = TEMPLATE_MAP[key];
      expect(fn).toBeDefined();
      expect(describeViolations(lintRenderFn((p) => fn!(p, ctx)))).toEqual([]);
      expect(JSON.stringify(fn!(payload, ctx))).not.toMatch(LEAK);
    });
    it(`${key}: in-app copy passes the lint and never echoes the payload`, () => {
      const text = describeInApp({ template: key, payload }).text;
      expect(text).not.toBe(describeInApp({ template: "unknown_template_zz", payload }).text);
      expect(describeViolations(lintText(text))).toEqual([]);
      expect(text).not.toMatch(LEAK);
    });
    it(`${key}: no em dash, no location words, no urgency words`, () => {
      const all = JSON.stringify(TEMPLATE_MAP[key]!(payload, ctx)) + describeInApp({ template: key, payload }).text;
      expect(all).not.toContain("—");
      expect(all).not.toMatch(/location|map|gps|coordinates|emergency|urgent|critical|collapse/i);
    });
  }

  it("the lint would catch a leak (control)", () => {
    expect(lintText("Someone in your Care Circle has a high blood pressure reading").length).toBeGreaterThan(0);
  });
});
