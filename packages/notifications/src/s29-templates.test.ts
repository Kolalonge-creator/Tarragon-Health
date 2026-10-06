/**
 * S29: the Care Circle templates pass the INV-07 lint (no condition, reading, result or medicine, no name, no payer), the sender
 * renderers and the in-app copy say the same neutral thing, and nothing from the payload is echoed.
 */
import "./support/deno.ts";
import { describe, expect, it } from "@jest/globals";
import { describeViolations, lintRenderFn, lintText } from "./index.ts";
import { TEMPLATE_MAP } from "../../../supabase/functions/send-pending-notifications/templates.ts";
import { describe as describeInApp } from "../../../apps/web/src/lib/notifications/describe-in-app.ts";

const KEYS = ["circle_check_in", "circle_joined", "circle_left", "circle_paid_for_you"] as const;
const ctx = { notificationId: "n", recipientId: "r" };
const payload = { patient_name: "Ada Obi", reading: "182/112", amount: "100000", payer: "Chidi", condition: "hypertension" };
const LEAK = /Ada|Obi|182|112|100000|Chidi|hypertension/i;

describe("S29 Care Circle notification templates", () => {
  for (const key of KEYS) {
    it(`${key}: sender renderer passes the lint and never echoes the payload`, () => {
      const fn = TEMPLATE_MAP[key];
      expect(fn).toBeDefined();
      expect(describeViolations(lintRenderFn((p) => fn!(p, ctx)))).toEqual([]);
      const out = fn!(payload, ctx);
      expect(JSON.stringify(out)).not.toMatch(LEAK);
    });
    it(`${key}: in-app copy passes the lint and never echoes the payload`, () => {
      const text = describeInApp({ template: key, payload }).text;
      expect(text).not.toBe(describeInApp({ template: "unknown_template_zz", payload }).text);
      expect(describeViolations(lintText(text))).toEqual([]);
      expect(text).not.toMatch(LEAK);
    });
  }

  it("the red alert to a supporter says only that someone may need them (safety: no cause, no grade)", () => {
    const out = TEMPLATE_MAP["circle_check_in"]!(payload, ctx);
    expect(out.email?.text).toMatch(/may need you/);
    expect(out.email?.text).not.toMatch(/emergency|urgent|red|critical|collapse|attack|stroke/i);
  });

  it("copy has no em dashes", () => {
    for (const key of KEYS) {
      expect(JSON.stringify(TEMPLATE_MAP[key]!(payload, ctx))).not.toContain("—");
      expect(describeInApp({ template: key, payload }).text).not.toContain("—");
    }
  });

  it("the lint would catch a leak (control)", () => {
    expect(lintText("Someone in your Care Circle has a high blood pressure reading").length).toBeGreaterThan(0);
  });
});
