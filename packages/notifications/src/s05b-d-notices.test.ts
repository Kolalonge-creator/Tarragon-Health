/**
 * S05b-d: the notice a patient gets when a clinician leaves her requested record change as it was. It is in-app only (INV-08: no SMS text
 * exists for it) and neutral (INV-07: no entry name, no value, no clinician note), and it opens the care-team messages.
 */
import "./support/deno.ts";
import { describe, expect, it } from "@jest/globals";
import { describeViolations, lintText } from "./index.ts";
import { TEMPLATE_MAP } from "../../../supabase/functions/send-pending-notifications/templates.ts";
import { describe as describeInApp } from "../../../apps/web/src/lib/notifications/describe-in-app.ts";

const KEY = "record_change_not_confirmed";
const payload = { request_id: "r1", allergen: "Peanut", reason: "I do not have this", decision_note: "Discuss at the visit", drug_name: "Amoxicillin" };

describe("S05b-d notice", () => {
  it("has its own in-app line that passes the lint and never echoes the payload", () => {
    const out = describeInApp({ template: KEY, payload });
    expect(out.text).not.toBe(describeInApp({ template: "unknown_template_zz", payload }).text);
    expect(describeViolations(lintText(out.text))).toEqual([]);
    expect(out.text).not.toMatch(/peanut|allerg|amoxicillin|discuss|visit/i);
    expect(out.href).toBe("/patient/messages");
  });
  it("has no SMS or email text (in-app only)", () => {
    expect((TEMPLATE_MAP as Record<string, unknown>)[KEY]).toBeUndefined();
  });
  it("the lint would catch a leak (control)", () => {
    expect(lintText("Your reading of 150/95 was left as it was").length).toBeGreaterThan(0);
  });
});
