/**
 * S69b: the Care Circle digest, gentle nudge and shared-job notices. Push, email and the sender text are the same generic line
 * ("Your circle has an update") for all three, so nothing about a person, a dose, a reading or a condition can be in them (INV-07).
 * The in-app line for the nudge says nothing about doses either.
 */
import "./support/deno.ts";
import { describe, expect, it } from "@jest/globals";
import { describeViolations, lintRenderFn, lintText } from "./index.ts";
import { TEMPLATE_MAP } from "../../../supabase/functions/send-pending-notifications/templates.ts";
import { describe as describeInApp } from "../../../apps/web/src/lib/notifications/describe-in-app.ts";

const ctx = { notificationId: "n", recipientId: "r" };
const KEYS = ["circle_digest", "circle_gentle_nudge", "circle_task_update"] as const;
const payload = { patient_name: "Ada Obi", medication: "Metformin", scheduled_time: "08:00", reading: "182/112", condition: "diabetes" };

describe("S69b Care Circle notices", () => {
  for (const key of KEYS) {
    it(`${key}: the push, email and sender text are the one generic line and pass the lint`, () => {
      const fn = TEMPLATE_MAP[key]!;
      expect(fn).toBeDefined();
      expect(describeViolations(lintRenderFn((p) => fn(p, ctx)))).toEqual([]);
      const out = fn(payload, ctx);
      expect(out.smsText).toBe("Your circle has an update. Tarragon Health");
      expect(out.email?.subject).toBe("Your circle has an update");
      expect(JSON.stringify(out)).not.toMatch(/Ada|Obi|Metformin|08:00|182|diabet|dose|missed|reading/i);
    });
    it(`${key}: the in-app line is neutral and known`, () => {
      const text = describeInApp({ template: key, payload }).text;
      expect(text).not.toBe(describeInApp({ template: "unknown_template_zz", payload }).text);
      expect(describeViolations(lintText(text))).toEqual([]);
      expect(text).not.toMatch(/Ada|Obi|Metformin|182|diabet|dose|missed|forgot|reading/i);
      expect(text).not.toContain("—");
    });
  }

  it("the nudge never says what happened or to whom", () => {
    const text = describeInApp({ template: "circle_gentle_nudge", payload }).text;
    expect(text).toBe("Someone in your Care Circle may like a friendly call");
  });
});
