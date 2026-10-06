/**
 * S24: the three care plan change templates pass the INV-07 lint (no condition, reading, result or medicine),
 * the sender renderers and in-app copy are neutral and never echo the payload, the payload carries ids only,
 * and the seeded locale text in the migration is clean in every locale.
 */
import "./support/deno.ts";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "@jest/globals";
import { describeViolations, lintRenderFn, lintText } from "./index.ts";
import { TEMPLATE_MAP } from "../../../supabase/functions/send-pending-notifications/templates.ts";
import { describe as describeInApp } from "../../../apps/web/src/lib/notifications/describe-in-app.ts";

const KEYS = ["care_change_ready_patient", "care_change_declined_staff", "care_change_expired_staff"] as const;

const ctx = { notificationId: "n", recipientId: "r" };
const payload = { care_plan_change_id: "c0ffee", drug_name: "metformin", reading: "BP 180/110", body: "secret", condition: "diabetes" };
const LEAK = /metformin|180|diabetes|secret|c0ffee/i;

describe("S24 notification templates", () => {
  for (const key of KEYS) {
    it(`${key}: sender renderer passes the lint and never echoes the payload`, () => {
      const fn = TEMPLATE_MAP[key];
      expect(fn).toBeDefined();
      expect(describeViolations(lintRenderFn((p) => fn!(p, ctx)))).toEqual([]);
      const out = fn!(payload, ctx);
      expect(out.smsText).not.toMatch(LEAK);
    });
    it(`${key}: in-app copy is mapped, passes the lint and never echoes the payload`, () => {
      const out = describeInApp({ template: key, payload });
      expect(out.text).not.toBe(describeInApp({ template: "unknown_template_zz", payload }).text);
      expect(describeViolations(lintText(out.text))).toEqual([]);
      expect(out.text).not.toMatch(LEAK);
    });
  }

  it("the patient notice reads as agreed and opens the Medicines area", () => {
    expect(describeInApp({ template: "care_change_ready_patient", payload: {} })).toEqual({
      text: "Your care team has a change for you",
      href: "/patient/medications",
    });
  });

  it("the seeded locale text is lint-clean, has no em dash, and the payload built by the SQL is ids only", () => {
    const sql = readFileSync(new URL("../../../supabase/migrations/20261006162420_s24_care_plan_changes_signed_prescribing.sql", import.meta.url), "utf8");
    const block = sql.slice(sql.indexOf("insert into public.notification_template_locales"));
    const rows = [...block.matchAll(/\('(care_change_[a-z_]+)', '([a-z]+)', '([a-z_]+)', '([^']*)', '([^']*)'\)/g)];
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const [, , , , subject, body] of rows) {
      for (const text of [subject!, body!]) {
        expect(text).not.toMatch(/—/);
        expect(describeViolations(lintText(text))).toEqual([]);
      }
    }
    const notifyCalls = [...sql.matchAll(/'(care_change_[a-z_]+)', jsonb_build_object\(([^)]*)\)/g)];
    expect(notifyCalls.length).toBeGreaterThan(0);
    for (const [, , args] of notifyCalls) {
      const keys = [...args!.matchAll(/'([a-z_]+)',/g)].map((m) => m[1]);
      for (const k of keys) expect(["care_plan_change_id", "reason"]).toContain(k);
    }
  });

  it("the lint would catch a leak (control)", () => {
    expect(lintText("Your care team changed your blood pressure medicine").length).toBeGreaterThan(0);
  });
});
