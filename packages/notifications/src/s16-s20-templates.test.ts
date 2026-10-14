/**
 * S16-S20 D2: the escalation notices to the clinical lead pass the INV-07 lint, are fixed neutral wording that never echoes the
 * payload, are mapped for the in-app bell, and the escalation alert is treated as safety-critical (never held for quiet hours).
 */
import "./support/deno.ts";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "@jest/globals";
import { describeViolations, lintRenderFn, lintText } from "./index.ts";
import { isSafetyCritical } from "../../../supabase/functions/_shared/notifications/delivery.ts";
import { TEMPLATE_MAP } from "../../../supabase/functions/send-pending-notifications/templates.ts";
import { describe as describeInApp } from "../../../apps/web/src/lib/notifications/describe-in-app.ts";

const ctx = { notificationId: "n", recipientId: "r" };
const payload = { task_id: "c0ffee", reading: "BP 180/110", condition: "diabetes", drug_name: "metformin", patient_name: "Ada Obi", body: "secret" };
const LEAK = /180|diabetes|metformin|ada|obi|secret|c0ffee/i;
const SENDER_KEYS = ["task_escalation_alert", "queue_backlog_digest"] as const;
const IN_APP_KEYS = ["task_escalation_alert", "queue_backlog_notice", "queue_backlog_digest"] as const;

describe("S16-S20 escalation templates", () => {
  for (const key of SENDER_KEYS) {
    it(`${key}: the sender renderer passes the lint and never echoes the payload`, () => {
      const fn = TEMPLATE_MAP[key];
      expect(fn).toBeDefined();
      expect(describeViolations(lintRenderFn((p) => fn!(p, ctx)))).toEqual([]);
      const out = fn!(payload, ctx);
      expect([out.smsText, out.email?.subject, out.email?.text, out.email?.html].join(" ")).not.toMatch(LEAK);
      expect([out.smsText, out.email?.subject, out.email?.text].join(" ")).not.toMatch(/—/);
    });
  }

  for (const key of IN_APP_KEYS) {
    it(`${key}: the in-app line is mapped, passes the lint and never echoes the payload`, () => {
      const out = describeInApp({ template: key, payload });
      expect(out.text).not.toBe(describeInApp({ template: "unknown_template_zz", payload }).text);
      expect(describeViolations(lintText(out.text))).toEqual([]);
      expect(out.text).not.toMatch(LEAK);
      expect(out.href).toBe("/clinician/queue");
    });
  }

  it("the immediate alert is safety-critical (sent at once, quiet hours do not hold it); the digest and the notice are not", () => {
    expect(isSafetyCritical("task_escalation_alert")).toBe(true);
    expect(isSafetyCritical("queue_backlog_digest")).toBe(false);
    expect(isSafetyCritical("queue_backlog_notice")).toBe(false);
  });

  it("the migration writes only ids and the clinical lead's own address into the payload, and never an sms or whatsapp row", () => {
    const sql = readFileSync(new URL("../../../supabase/migrations/20261014222123_s16_s20_task_layer.sql", import.meta.url), "utf8");
    expect(sql).toContain("jsonb_strip_nulls(jsonb_build_object('task_id', t.id, 'to_email', v_email))");
    expect(sql).not.toMatch(/'sms'|'whatsapp'/);
  });
});
