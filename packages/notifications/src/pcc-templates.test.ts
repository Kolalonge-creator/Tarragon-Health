/**
 * PCC: the post-consultation check-in templates pass the INV-07 lint, the sender renderers and the in-app copy match the neutral
 * wording, and neither echoes anything from the payload. Registered with the same lint the other consultation templates use (S13).
 */
import "./support/deno.ts";
import { describe, expect, it } from "@jest/globals";
import { describeViolations, lintRenderFn, lintText } from "./index.ts";
import { TEMPLATE_MAP } from "../../../supabase/functions/send-pending-notifications/templates.ts";
import { describe as describeInApp } from "../../../apps/web/src/lib/notifications/describe-in-app.ts";

const KEYS = ["consult_checkin_due", "consult_checkin_nudge"] as const;
const ctx = { notificationId: "n", recipientId: "r" };
const payload = { checkin_id: "11111111-1111-1111-1111-111111111111", answers: "worse", question: "my chest hurts", details: "HbA1c 9" };

describe("PCC notification templates", () => {
  for (const key of KEYS) {
    it(`${key}: sender renderer passes the lint and never echoes the payload`, () => {
      const fn = TEMPLATE_MAP[key];
      expect(fn).toBeDefined();
      expect(describeViolations(lintRenderFn((p) => fn!(p, ctx)))).toEqual([]);
      const out = fn!(payload, ctx);
      expect(out.smsText).not.toMatch(/chest|HbA1c|worse/i);
      expect(out.pushUrl).toBe(`/patient/consult-checkin/${payload.checkin_id}`);
      expect(JSON.stringify(out)).not.toContain("—");
    });
    it(`${key}: in-app copy passes the lint and links to the check-in`, () => {
      const d = describeInApp({ template: key, payload });
      expect(d.text).not.toBe(describeInApp({ template: "unknown_template_zz", payload }).text);
      expect(describeViolations(lintText(d.text))).toEqual([]);
      expect(d.text).not.toMatch(/chest|HbA1c|worse/i);
      expect(d.href).toBe(`/patient/consult-checkin/${payload.checkin_id}`);
    });
  }

  it("the lint would catch a leak (control)", () => {
    expect(lintText("Your check-in about your blood pressure is waiting").length).toBeGreaterThan(0);
  });
});
