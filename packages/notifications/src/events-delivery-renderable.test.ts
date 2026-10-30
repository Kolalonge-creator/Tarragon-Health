/**
 * E7 of the events harness. packages/db/tests/events_notification_delivery_renderable.sql drives two real events (a patient's
 * emergency-keyword care message, an unacknowledged critical alert climbing the ladder) and proves every push or email row they
 * queue is either on its `E7_TS_RENDERED` line or has an active locale row. This test is the other half: every template on
 * that line must really render from the sender's code map, with a push line and a branded email, in neutral wording, and the
 * email must be addressable (a clinician page goes to the recipient's own verified address, never a payload address).
 * Without it the SQL line could name a template the sender cannot render and the proof would pass on a promise.
 */
import "./support/deno.ts";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "@jest/globals";
import { describeViolations, lintRenderFn, addressRuleFor } from "./index.ts";
import { TEMPLATE_MAP } from "../../../supabase/functions/send-pending-notifications/templates.ts";

const ctx = { notificationId: "n", recipientId: "r" };
// The exact line the enqueuing function writes for push and email copies (private.notify_clinician_alert).
const GENERIC_URGENT_LINE = "You have a new urgent alert on Tarragon Health -- please check your dashboard.";

const sql = readFileSync(new URL("../../db/tests/events_notification_delivery_renderable.sql", import.meta.url), "utf8");
const listed = /^-- E7_TS_RENDERED:\s*(.+)$/m.exec(sql)?.[1]?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];

// The proof checks the array in its DO block; this test checks the comment line. They must be the same list, or a template
// added to the array alone would pass the proof without ever being checked against the code map here.
const inArray = [...(/v_ts_rendered text\[\] := array\[([^\]]+)\]/.exec(sql)?.[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]);

describe("E7: templates the event machinery queues as push and email", () => {
  it("the proof lists the templates (the line is not silently missing)", () => {
    expect(listed.length).toBeGreaterThanOrEqual(4);
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("the comment line and the array the proof actually checks are the same list", () => {
    expect([...inArray].sort()).toEqual([...listed].sort());
  });

  for (const key of listed) {
    describe(key, () => {
      it("is in the sender's code map and renders a push line and a branded email", () => {
        const fn = TEMPLATE_MAP[key];
        expect(fn).toBeDefined();
        const out = fn!({ message: GENERIC_URGENT_LINE }, ctx);
        expect(out.smsText).toBe(GENERIC_URGENT_LINE);
        expect(out.pushUrl).toMatch(/^\/clinician\//);
        expect(out.email?.subject.length).toBeGreaterThan(0);
        expect(out.email?.html).toContain(GENERIC_URGENT_LINE);
        expect(out.email?.text).toContain(GENERIC_URGENT_LINE);
      });

      it("passes the wording lint (no condition, reading, medicine or result in a push or email)", () => {
        const fn = TEMPLATE_MAP[key]!;
        expect(describeViolations(lintRenderFn((p) => fn(p, ctx)))).toEqual([]);
      });

      it("never echoes anything in the payload other than its message", () => {
        const out = TEMPLATE_MAP[key]!({ message: GENERIC_URGENT_LINE, matched_phrases: ["chest pain"], thread_id: "c0ffee" }, ctx);
        expect([out.smsText, out.email?.subject, out.email?.html, out.email?.text].join(" ")).not.toMatch(/chest pain|c0ffee/i);
      });

      it("goes to the recipient's own verified address, never one named in the payload", () => {
        expect(addressRuleFor(key)).toBe("own_only");
      });
    });
  }
});
