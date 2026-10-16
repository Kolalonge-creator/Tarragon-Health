/**
 * Yearly proxy-access review: the two templates pass the INV-07 lint (no condition, reading, result or medicine), the sender renderers
 * and the in-app copy say the same neutral thing, nothing from the payload is echoed (no name of the person or the proxy), the proxy's
 * notice says nothing about narrowing or removal (decision D5), and there are no em dashes.
 */
import "./support/deno.ts";
import { describe, expect, it } from "@jest/globals";
import { describeViolations, lintRenderFn, lintText } from "./index.ts";
import { TEMPLATE_MAP } from "../../../supabase/functions/send-pending-notifications/templates.ts";
import { describe as describeInApp } from "../../../apps/web/src/lib/notifications/describe-in-app.ts";

const KEYS = ["proxy_review_due", "proxy_review_due_proxy"] as const;
const ctx = { notificationId: "n", recipientId: "r" };
const payload = { patient_name: "Ada Obi", grantee_name: "Chidi Eze", reading: "182/112", condition: "hypertension", categories: "medications" };
const LEAK = /Ada|Obi|Chidi|Eze|182|112|hypertension|medications/i;

describe("yearly proxy review notification templates", () => {
  for (const key of KEYS) {
    it(`${key}: sender renderer passes the lint and never echoes the payload`, () => {
      const fn = TEMPLATE_MAP[key];
      expect(fn).toBeDefined();
      expect(describeViolations(lintRenderFn((p) => fn!(p, ctx)))).toEqual([]);
      expect(JSON.stringify(fn!(payload, ctx))).not.toMatch(LEAK);
    });
    it(`${key}: in-app copy is mapped, passes the lint and never echoes the payload`, () => {
      const text = describeInApp({ template: key, payload }).text;
      expect(text).not.toBe(describeInApp({ template: "unknown_template_zz", payload }).text);
      expect(describeViolations(lintText(text))).toEqual([]);
      expect(text).not.toMatch(LEAK);
    });
    it(`${key}: no em dashes`, () => {
      expect(JSON.stringify(TEMPLATE_MAP[key]!(payload, ctx))).not.toContain("—");
      expect(describeInApp({ template: key, payload }).text).not.toContain("—");
    });
  }

  it("the proxy notice is calm: no alarm words, and nothing that hints at narrowing or removal (D5)", () => {
    const out = JSON.stringify(TEMPLATE_MAP["proxy_review_due_proxy"]!(payload, ctx)) + describeInApp({ template: "proxy_review_due_proxy", payload }).text;
    expect(out).not.toMatch(/remov|narrow|revok|end(ed)? your|lose|lost|urgent|warning|deadline|must/i);
    expect(out).toMatch(/do not need to do anything/i);
  });

  it("the person's notice never says access will be removed for not answering", () => {
    const out = JSON.stringify(TEMPLATE_MAP["proxy_review_due"]!(payload, ctx)) + describeInApp({ template: "proxy_review_due", payload }).text;
    expect(out).not.toMatch(/will be removed|will end|expire|deadline|urgent|warning/i);
  });

  it("the lint would catch a leak (control)", () => {
    expect(lintText("Someone who helps you can see your blood pressure readings").length).toBeGreaterThan(0);
  });
});
