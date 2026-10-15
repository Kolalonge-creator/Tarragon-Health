/**
 * S69: the community notice and the neutralised wellness-challenge nudge pass the INV-07 lint, and nothing from the payload is echoed
 * (no cohort name, metric, progress figure, challenge title or condition).
 */
import "./support/deno.ts";
import { describe, expect, it } from "@jest/globals";
import { describeViolations, lintRenderFn, lintText } from "./index.ts";
import { TEMPLATE_MAP } from "../../../supabase/functions/send-pending-notifications/templates.ts";
import { describe as describeInApp } from "../../../apps/web/src/lib/notifications/describe-in-app.ts";

const KEYS = ["community_update", "wellness_challenge_ending"] as const;
const ctx = { notificationId: "n", recipientId: "r" };
const payload = {
  cohort_name: "Grace Estate Walkers",
  metric: "activity_minutes",
  progress: "73",
  target: "150",
  challenge_title: "5-Day Vitals Streak",
  condition: "hypertension",
  reading: "182/112",
};
const LEAK = /Grace|Estate|Walkers|activity|73|150|Vitals|Streak|hypertension|182|112/i;

describe("S69 community notification templates", () => {
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
  }

  it("the community notice is exactly the generic line", () => {
    expect(describeInApp({ template: "community_update", payload }).text).toBe("Your group has an update");
    expect(TEMPLATE_MAP["community_update"]!(payload, ctx).email?.subject).toBe("Your group has an update");
  });

  it("copy has no em dashes", () => {
    for (const key of KEYS) {
      expect(JSON.stringify(TEMPLATE_MAP[key]!(payload, ctx))).not.toContain("—");
      expect(describeInApp({ template: key, payload }).text).not.toContain("—");
    }
  });

  it("the lint would catch a leak (control)", () => {
    expect(lintText("Your walking group reached its blood pressure goal").length).toBeGreaterThan(0);
  });
});
