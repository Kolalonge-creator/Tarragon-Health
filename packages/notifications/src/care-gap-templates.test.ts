/**
 * S90: the care gap engine's two patient templates pass the INV-07 lint (every payload key read back as a canary), the sender renderers, the in-app previews,
 * the i18n catalogue and the database locale rows all carry the same neutral words, and none echoes anything from the payload.
 */
import "./support/deno.ts";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@jest/globals";
import { describeViolations, lintRenderFn, lintText } from "./index.ts";
import { TEMPLATE_MAP } from "../../../supabase/functions/send-pending-notifications/templates.ts";
import { describe as describeInApp } from "../../../apps/web/src/lib/notifications/describe-in-app.ts";
import { careGapCopy } from "../../i18n/src/care-gap-copy.ts";

const KEYS = ["care_gap_checkin", "care_gap_checkin_followup"] as const;
const ctx = { notificationId: "n", recipientId: "r" };
const payload = { copy_variant: "b", gap_type: "missed_reading", condition: "hypertension", reading: "150/95", details: "HbA1c 9", result: "high" };
const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "supabase", "migrations");
const migration = readFileSync(join(MIGRATIONS, readdirSync(MIGRATIONS).find((f) => f.endsWith("_s90_care_gap_rule_engine.sql")) as string), "utf8");

describe("care gap notification templates", () => {
  for (const key of KEYS) {
    it(`${key}: the sender renderer passes the lint and never echoes the payload`, () => {
      const fn = TEMPLATE_MAP[key];
      expect(fn).toBeDefined();
      expect(describeViolations(lintRenderFn((p) => fn!(p, ctx)))).toEqual([]);
      for (const variant of ["a", "b", undefined]) {
        const out = fn!({ ...payload, copy_variant: variant }, ctx);
        const all = JSON.stringify(out);
        expect(all).not.toMatch(/missed_reading|hypertension|150|HbA1c|high|reading/i);
        expect(out.pushUrl).toBe("/patient");
        expect(all).not.toContain("—");
      }
    });

    it(`${key}: the in-app copy passes the lint, links to the dashboard and echoes nothing`, () => {
      for (const variant of ["a", "b"]) {
        const d = describeInApp({ template: key, payload: { ...payload, copy_variant: variant } });
        expect(d.text).not.toBe(describeInApp({ template: "unknown_template_zz", payload }).text);
        expect(describeViolations(lintText(d.text))).toEqual([]);
        expect(d.text).not.toMatch(/missed|hypertension|150|HbA1c|reading/i);
        expect(d.href).toBe("/patient");
      }
    });
  }

  it("the wording is the same in the sender, the in-app preview, the catalogue and the database rows", () => {
    const first = TEMPLATE_MAP.care_gap_checkin!({ copy_variant: "a" }, ctx);
    expect(first.email?.text).toBe(careGapCopy["patient.first.email.body"]);
    expect(first.smsText).toBe(careGapCopy["patient.first.sms"]);
    expect(first.email?.subject).toBe(careGapCopy["patient.first.email.subject"]);
    const firstB = TEMPLATE_MAP.care_gap_checkin!({ copy_variant: "b" }, ctx);
    expect(firstB.email?.text).toBe(careGapCopy["patient.variant_b.email.body"]);
    const follow = TEMPLATE_MAP.care_gap_checkin_followup!({}, ctx);
    expect(follow.email?.text).toBe(careGapCopy["patient.followup.email.body"]);
    expect(follow.smsText).toBe(careGapCopy["patient.followup.sms"]);
    expect(follow.email?.subject).toBe(careGapCopy["patient.followup.email.subject"]);
    expect(describeInApp({ template: "care_gap_checkin", payload: {} }).text).toBe(careGapCopy["patient.first.in_app"]);
    expect(describeInApp({ template: "care_gap_checkin", payload: { copy_variant: "b" } }).text).toBe(careGapCopy["patient.variant_b.in_app"]);
    // the database rows (the default copy, variant a)
    for (const k of ["patient.first.in_app", "patient.first.push", "patient.followup.email.body", "patient.followup.email.subject"] as const) {
      expect(migration).toContain(careGapCopy[k]);
    }
  });

  it("every catalogue string a patient could read passes the same lint the sender enforces", () => {
    for (const [k, v] of Object.entries(careGapCopy)) {
      if (k.startsWith("patient.")) expect({ key: k, violations: describeViolations(lintText(v)) }).toEqual({ key: k, violations: [] });
    }
  });

  it("the lint would catch a leak (control)", () => {
    expect(lintText("A short step about your blood pressure is waiting").length).toBeGreaterThan(0);
  });
});
