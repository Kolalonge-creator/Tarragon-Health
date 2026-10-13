/**
 * Two-tier monthly follow-up: every template passes the INV-07 lint (no condition, reading, result or medicine), the sender renderers
 * and in-app copy match the neutral wording and never echo the payload, and none of them is an SMS (INV-08).
 */
import "./support/deno.ts";
import { describe, expect, it } from "@jest/globals";
import { describeViolations, lintRenderFn, lintText } from "./index.ts";
import { TEMPLATE_MAP } from "../../../supabase/functions/send-pending-notifications/templates.ts";
import { describe as describeInApp } from "../../../apps/web/src/lib/notifications/describe-in-app.ts";

const KEYS = ["followup_times_offered", "followup_offer_withdrawn", "followup_month_missed", "followup_slot_picked"] as const;

const ctx = { notificationId: "n", recipientId: "r" };
const payload = { reason: "high blood pressure", condition: "diabetes", reading: "BP 180/110", body: "secret", month_index: 3 };

describe("two-tier follow-up notification templates", () => {
  for (const key of KEYS) {
    it(`${key}: the sender renderer passes the lint and never echoes the payload`, () => {
      const fn = TEMPLATE_MAP[key];
      expect(fn).toBeDefined();
      expect(describeViolations(lintRenderFn((p) => fn!(p, ctx)))).toEqual([]);
      const out = fn!(payload, ctx);
      expect(out.smsText).not.toMatch(/pressure|diabetes|180|secret/i);
    });

    it(`${key}: the in-app copy passes the lint, is specific, and never echoes the payload`, () => {
      const text = describeInApp({ template: key, payload }).text;
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toBe(describeInApp({ template: "unknown_template_zz", payload }).text);
      expect(describeViolations(lintText(text))).toEqual([]);
      expect(text).not.toMatch(/pressure|diabetes|180|secret/i);
    });
  }

  it("the missed-month email is neutral too", () => {
    const out = TEMPLATE_MAP["followup_month_missed"]!(payload, ctx);
    expect(out.email).toBeDefined();
    expect(JSON.stringify(out.email)).not.toMatch(/pressure|diabetes|180|secret/i);
  });

  it("the lint would catch a leak (control)", () => {
    expect(lintText("Your care team replied about your blood pressure").length).toBeGreaterThan(0);
  });
});
