/**
 * S59c: the follow-up-after-a-symptom-check templates pass the INV-07 lint (shared-phone safe), the sender renderers and the in-app copy match
 * the neutral wording, and neither echoes anything from the payload (no symptom, no result, no name).
 */
import "./support/deno.ts";
import { describe, expect, it } from "@jest/globals";
import { describeViolations, lintRenderFn, lintText } from "./index.ts";
import { TEMPLATE_MAP } from "../../../supabase/functions/send-pending-notifications/templates.ts";
import { describe as describeInApp } from "../../../apps/web/src/lib/notifications/describe-in-app.ts";

const KEYS = ["symptom_checkback_due", "symptom_checkback_nudge"] as const;
const ctx = { notificationId: "n", recipientId: "r" };
const payload = { checkback_id: "11111111-1111-1111-1111-111111111111", result: "urgent", complaint: "chest pain", progress: "worse", details: "HbA1c 9" };

describe("S59c notification templates", () => {
  for (const key of KEYS) {
    it(`${key}: sender renderer passes the lint and never echoes the payload`, () => {
      const fn = TEMPLATE_MAP[key];
      expect(fn).toBeDefined();
      expect(describeViolations(lintRenderFn((p) => fn!(p, ctx)))).toEqual([]);
      const out = fn!(payload, ctx);
      // the words people read (not the in-app link, whose path names the page)
      const { pushUrl: _link, ...words } = out;
      void _link;
      expect(JSON.stringify(words)).not.toMatch(/chest|HbA1c|worse|urgent|symptom/i);
      expect(out.pushUrl).toBe(`/patient/symptom-checkback/${payload.checkback_id}`);
      expect(JSON.stringify(out)).not.toContain("—");
    });
    it(`${key}: in-app copy passes the lint and links to the follow-up`, () => {
      const d = describeInApp({ template: key, payload });
      expect(d.text).not.toBe(describeInApp({ template: "unknown_template_zz", payload }).text);
      expect(describeViolations(lintText(d.text))).toEqual([]);
      expect(d.text).not.toMatch(/chest|HbA1c|worse|urgent|symptom/i);
      expect(d.href).toBe(`/patient/symptom-checkback/${payload.checkback_id}`);
    });
  }
});
