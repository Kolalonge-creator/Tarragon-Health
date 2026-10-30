/**
 * E8 of the events harness. packages/db/tests/events_lab_order_to_specimen_notices.sql drives a lab order through payment and a
 * rejected sample, and requires every push or email it queues to be on its `E8_TS_RENDERED` line or to have an active locale row.
 * This is the other half: each listed template must really render from the sender's code map, as an email as well as a push line,
 * and the one added by E8 (lab_sample_rejected) must pass the wording lint and echo nothing from the payload.
 */
import "./support/deno.ts";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "@jest/globals";
import { describeViolations, lintRenderFn } from "./index.ts";
import { TEMPLATE_MAP } from "../../../supabase/functions/send-pending-notifications/templates.ts";

const ctx = { notificationId: "n", recipientId: "r" };
const sql = readFileSync(new URL("../../db/tests/events_lab_order_to_specimen_notices.sql", import.meta.url), "utf8");
const listed = /^-- E8_TS_RENDERED:\s*(.+)$/m.exec(sql)?.[1]?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
const inArray = [...(/v_ts_rendered text\[\] := array\[([^\]]+)\]/.exec(sql)?.[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]);

const payload = {
  patient_name: "Ada Obi", order_number: "LO-1", test_name: "Annual panel", lab_name: "EV8 Lab", self_booked: true,
  reason: "Label did not match the request", patient_number: "TH-1", facility_name: "", to_email: "x@example.invalid",
};

describe("E8: templates the lab order path queues as push and email", () => {
  it("the proof lists them, and its comment line is the same list as the array it checks", () => {
    expect(listed.length).toBeGreaterThanOrEqual(4);
    expect([...inArray].sort()).toEqual([...listed].sort());
  });

  for (const key of listed) {
    it(`${key} renders a message and an email from the code map`, () => {
      const fn = TEMPLATE_MAP[key];
      expect(fn).toBeDefined();
      const out = fn!(payload, ctx);
      expect(out.smsText.length).toBeGreaterThan(0);
      expect(out.email?.subject.length).toBeGreaterThan(0);
      expect(out.email?.html.length).toBeGreaterThan(0);
    });
  }

  it("lab_sample_rejected passes the wording lint and never echoes the reason", () => {
    const fn = TEMPLATE_MAP["lab_sample_rejected"]!;
    expect(describeViolations(lintRenderFn((p) => fn(p, ctx)))).toEqual([]);
    const out = fn(payload, ctx);
    expect([out.smsText, out.email?.subject, out.email?.text, out.email?.html].join(" ")).not.toMatch(/Label did not match|Annual panel|LO-1/);
    expect([out.smsText, out.email?.subject, out.email?.text].join(" ")).not.toMatch(/—/);
    expect(out.pushUrl).toBe("/patient/labs");
  });
});
