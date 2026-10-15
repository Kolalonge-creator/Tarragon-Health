/**
 * S78b: the response-time notices pass the INV-07 lint, echo nothing from the payload, carry no number (CMO decision S-9),
 * and the patient notice points to emergency care. SMS is not used (D-12): the notices are in-app.
 */
import "./support/deno.ts";
import { describe, expect, it } from "@jest/globals";
import { describeViolations, lintRenderFn, lintText } from "./index.ts";
import { TEMPLATE_MAP } from "../../../supabase/functions/send-pending-notifications/templates.ts";
import { describe as describeInApp } from "../../../apps/web/src/lib/notifications/describe-in-app.ts";

const KEYS = ["response_slower_notice"] as const;
const ctx = { notificationId: "n", recipientId: "r" };
const payload = { question: "my chest hurts", minutes: 1440, hours: 24, details: "HbA1c 9", body: "secret" };

describe("S78b response-time notices", () => {
  for (const key of KEYS) {
    it(`${key}: sender renderer passes the lint and never echoes the payload`, () => {
      const fn = TEMPLATE_MAP[key];
      expect(fn).toBeDefined();
      expect(describeViolations(lintRenderFn((p) => fn!(p, ctx)))).toEqual([]);
      const out = fn!(payload, ctx);
      expect(out.smsText).not.toMatch(/chest|HbA1c|secret|1440|24/i);
    });
    it(`${key}: in-app copy passes the lint, has no number and never echoes the payload`, () => {
      const text = describeInApp({ template: key, payload }).text;
      expect(text).not.toBe(describeInApp({ template: "unknown_template_zz", payload }).text);
      expect(describeViolations(lintText(text))).toEqual([]);
      expect(text).not.toMatch(/chest|HbA1c|secret|\d/i);
    });
  }
  it("the patient notice says to use emergency care if urgent", () => {
    expect(describeInApp({ template: "response_slower_notice", payload: {} }).text).toMatch(/urgent.*emergency care/i);
  });
  it("the lint would catch a number-and-condition leak (control)", () => {
    expect(lintText("Your reading of 150/95 is slower than usual").length).toBeGreaterThan(0);
  });
});
