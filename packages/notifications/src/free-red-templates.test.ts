/**
 * Two-tier Free red-event notices (CMO 2026-10-08): the guidance, recheck and check-in notices pass the INV-07 lint (no
 * condition, reading, result or medicine), say the same neutral thing in the sender renderers and the in-app copy, and echo
 * nothing from the payload. They never say a doctor was or was not alerted: that sentence lives on the in-app red screen.
 */
import "./support/deno.ts";
import { describe, expect, it } from "@jest/globals";
import { describeViolations, lintRenderFn, lintText } from "./index.ts";
import { TEMPLATE_MAP } from "../../../supabase/functions/send-pending-notifications/templates.ts";
import { describe as describeInApp } from "../../../apps/web/src/lib/notifications/describe-in-app.ts";

const KEYS = ["free_red_guidance", "free_red_recheck", "free_red_checkin"] as const;
const ctx = { notificationId: "n", recipientId: "r" };
const payload = { patient_name: "Ada Obi", reading: "182/112", condition: "hypertension", systolic: 182 };
const LEAK = /Ada|Obi|182|112|hypertension/i;

describe("Free red-event notification templates", () => {
  for (const key of KEYS) {
    it(`${key}: sender renderer passes the lint and never echoes the payload`, () => {
      const fn = TEMPLATE_MAP[key];
      expect(fn).toBeDefined();
      expect(describeViolations(lintRenderFn((p) => fn!(p, ctx)))).toEqual([]);
      expect(JSON.stringify(fn!(payload, ctx))).not.toMatch(LEAK);
      expect(JSON.stringify(fn!(payload, ctx))).not.toContain("—");
    });
    it(`${key}: in-app copy is mapped, passes the lint and never echoes the payload`, () => {
      const text = describeInApp({ template: key, payload }).text;
      expect(text).not.toBe(describeInApp({ template: "unknown_template_zz", payload }).text);
      expect(describeViolations(lintText(text))).toEqual([]);
      expect(text).not.toMatch(LEAK);
      expect(text).not.toContain("—");
      expect(text).not.toMatch(/warning|emergency|danger|doctor/i);
    });
  }

  it("the lint would catch a leak (control)", () => {
    expect(lintText("Your high blood pressure reading needs attention").length).toBeGreaterThan(0);
  });
});
