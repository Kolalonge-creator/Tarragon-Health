/**
 * SR5: the operations alert templates (ops_alert, ops_all_clear) pass the INV-07 lint, never echo the payload (so no alert detail can
 * reach an email or push), and the in-app copy matches.
 */
import "./support/deno.ts";
import { describe, expect, it } from "@jest/globals";
import { describeViolations, lintRenderFn, lintText } from "./index.ts";
import { TEMPLATE_MAP } from "../../../supabase/functions/send-pending-notifications/templates.ts";
import { describe as describeInApp } from "../../../apps/web/src/lib/notifications/describe-in-app.ts";

const KEYS = ["ops_alert", "ops_all_clear"] as const;
const ctx = { notificationId: "n", recipientId: "r" };
const payload = { alert_id: "a-1", rule: "db_connections", severity: "sev1", detail: "connections 97 percent", patient_name: "Ada Obi" };
const LEAK = /a-1|db_connections|sev1|97|Ada|Obi/i;

describe("SR5 operations alert templates", () => {
  for (const key of KEYS) {
    it(`${key}: sender renderer passes the lint and never echoes the payload`, () => {
      const fn = TEMPLATE_MAP[key];
      expect(fn).toBeDefined();
      expect(describeViolations(lintRenderFn((p) => fn!(p, ctx)))).toEqual([]);
      expect(JSON.stringify(fn!(payload, ctx))).not.toMatch(LEAK);
    });
    it(`${key}: in-app copy is specific, passes the lint and never echoes the payload`, () => {
      const text = describeInApp({ template: key, payload }).text;
      expect(text).not.toBe(describeInApp({ template: "unknown_template_zz", payload }).text);
      expect(describeViolations(lintText(text))).toEqual([]);
      expect(text).not.toMatch(LEAK);
    });
    it(`${key}: links to the operations wall and has no em dash`, () => {
      const out = TEMPLATE_MAP[key]!(payload, ctx);
      expect(out.pushUrl).toBe("/admin/ops/wall");
      expect(JSON.stringify(out)).not.toContain("—");
    });
  }
});
