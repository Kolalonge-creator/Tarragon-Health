/**
 * S87 (OQ-727, no SMS): the sponsor is told in the app that a paid reservation's claim link is ready to share. The notice
 * passes the INV-07 lint and echoes nothing from the payload (no recipient name, phone, service, price or token).
 */
import "./support/deno.ts";
import { describe, expect, it } from "@jest/globals";
import { describeViolations, lintRenderFn, lintText } from "./index.ts";
import { TEMPLATE_MAP } from "../../../supabase/functions/send-pending-notifications/templates.ts";
import { describe as describeInApp } from "../../../apps/web/src/lib/notifications/describe-in-app.ts";

const KEY = "sponsored_reservation_ready";
const ctx = { notificationId: "n", recipientId: "r" };
const payload = { recipient_first_name: "Amaka", recipient_phone: "+2348012345678", service_name: "Diabetes check", amount_kobo: 500000, invite_token: "tok123", condition: "diabetes" };
const LEAK = /Amaka|2348012345678|Diabetes|5,?000|tok123/i;

describe("S87 sponsor reservation-ready notice", () => {
  it("sender renderer passes the lint and never echoes the payload", () => {
    const fn = TEMPLATE_MAP[KEY];
    expect(fn).toBeDefined();
    expect(describeViolations(lintRenderFn((p) => fn!(p, ctx)))).toEqual([]);
    expect(JSON.stringify(fn!(payload, ctx))).not.toMatch(LEAK);
    expect(JSON.stringify(fn!(payload, ctx))).not.toContain("/claim/");
  });

  it("in-app copy is registered (not the unknown-template fallback), passes the lint and echoes nothing", () => {
    const text = describeInApp({ template: KEY, payload }).text;
    expect(text).not.toBe(describeInApp({ template: "unknown_template_zz", payload }).text);
    expect(describeViolations(lintText(text))).toEqual([]);
    expect(text).not.toMatch(LEAK);
    expect(describeInApp({ template: KEY, payload }).href).toBe("/patient/supporting");
  });

  it("says plainly that the person is not texted, and has no em dash", () => {
    expect(TEMPLATE_MAP[KEY]!(payload, ctx).email?.text).toMatch(/We do not text them/);
    expect(JSON.stringify(TEMPLATE_MAP[KEY]!(payload, ctx))).not.toContain("—");
    expect(describeInApp({ template: KEY, payload }).text).not.toContain("—");
  });

  it("the lint would catch a leak (control)", () => {
    expect(lintText("Amaka's diabetes check is ready, blood pressure 150/95").length).toBeGreaterThan(0);
  });
});
