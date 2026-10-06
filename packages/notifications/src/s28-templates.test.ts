/**
 * S28: the three pharmacy collection templates pass the INV-07 lint (no medicine, person, reading or collection code), the
 * sender renderers match the neutral wording, none of them is an SMS (INV-08), and none echoes its payload.
 */
import "./support/deno.ts";
import { describe, expect, it } from "@jest/globals";
import { describeViolations, lintRenderFn, lintText } from "./index.ts";
import { TEMPLATE_MAP } from "../../../supabase/functions/send-pending-notifications/templates.ts";
import { describe as describeInApp } from "../../../apps/web/src/lib/notifications/describe-in-app.ts";

const KEYS = ["pharmacy_collection_waiting", "pharmacy_collection_update", "pharmacy_collection_question"] as const;
const ctx = { notificationId: "n", recipientId: "r" };
const payload = { drug_name: "Amlodipine", collection_code: "K7M2QX9P", patient_name: "Ada Obi", prescription_id: "abc", body: "secret" };

describe("S28 notification templates", () => {
  for (const key of KEYS) {
    it(`${key}: sender renderer passes the lint and never echoes the payload`, () => {
      const fn = TEMPLATE_MAP[key];
      expect(fn).toBeDefined();
      expect(describeViolations(lintRenderFn((p) => fn!(p, ctx)))).toEqual([]);
      const out = fn!(payload, ctx);
      expect(out.smsText).not.toMatch(/amlodipine|K7M2QX9P|Ada|Obi|secret/i);
    });
    it(`${key}: in-app copy passes the lint and never echoes the payload`, () => {
      const text = describeInApp({ template: key, payload }).text;
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toBe(describeInApp({ template: "unknown_template_zz", payload }).text);
      expect(describeViolations(lintText(text))).toEqual([]);
      expect(text).not.toMatch(/amlodipine|K7M2QX9P|Ada|Obi|secret/i);
    });
  }
});
