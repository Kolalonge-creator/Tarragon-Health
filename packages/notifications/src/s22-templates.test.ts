/**
 * S22: every written-question and note-release template passes the INV-07 lint (no condition, reading, result or
 * medicine, no question text), the sender renderers match the neutral wording, and the retired SMS template is gone (INV-08).
 */
import "./support/deno.ts";
import { describe, expect, it } from "@jest/globals";
import { describeViolations, lintRenderFn, lintText } from "./index.ts";
import { TEMPLATE_MAP } from "../../../supabase/functions/send-pending-notifications/templates.ts";
import { describe as describeInApp } from "../../../apps/web/src/lib/notifications/describe-in-app.ts";

const KEYS = [
  "written_question_received",
  "written_question_answered",
  "written_question_info_needed",
  "written_question_window_missed",
  "written_question_call_planned",
  "written_question_staff_notice",
  "note_release_requested",
  "note_correction_requested",
  "note_released",
  "note_release_declined",
  "note_correction_answered",
  "note_unsigned_reminder",
  "lab_result_ready",
] as const;

const ctx = { notificationId: "n", recipientId: "r" };
const payload = { question: "my chest hurts", question_text: "my chest hurts", details: "HbA1c 9", body: "secret" };

describe("S22 notification templates", () => {
  for (const key of KEYS) {
    it(`${key}: sender renderer passes the lint and never echoes the payload`, () => {
      const fn = TEMPLATE_MAP[key];
      expect(fn).toBeDefined();
      expect(describeViolations(lintRenderFn((p) => fn!(p, ctx)))).toEqual([]);
      const out = fn!(payload, ctx);
      expect(out.smsText).not.toMatch(/chest|HbA1c|secret/i);
    });
    it(`${key}: in-app copy passes the lint and never echoes the payload`, () => {
      const text = describeInApp({ template: key, payload }).text;
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toBe(describeInApp({ template: "unknown_template_zz", payload }).text);
      expect(describeViolations(lintText(text))).toEqual([]);
      expect(text).not.toMatch(/chest|HbA1c|secret/i);
    });
  }

  it("the retired async_consult_answered SMS template is gone", () => {
    expect(TEMPLATE_MAP["async_consult_answered"]).toBeUndefined();
  });

  it("the lint would catch a leak (control)", () => {
    expect(lintText("Your care team replied about your blood pressure").length).toBeGreaterThan(0);
  });
});
