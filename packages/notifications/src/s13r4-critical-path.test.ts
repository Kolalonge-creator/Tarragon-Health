/**
 * S13 R4 (CMO Q10, Q12; OQ-91, OQ-92): the pure parts of the critical path. SMS goes only to a clinician by role (never because a row
 * is critical), the red templates say the same fixed thing whatever they are given (safety case 20 style: real clinical values go
 * in, none come out), the push carries urgency fields only for safety rows and "critical" only once the entitlement is switched on,
 * and the document email carries a signed link instead of an attachment.
 */
import "./support/deno.ts";
import { createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "@jest/globals";
import {
  decide, describeViolations, expoUrgencyFields, isClinicianPageRow, isSafetyCritical, lintRenderFn, lintText, pushEnvelope,
  signDocumentLink, URGENT_CHANNEL_ID, URGENT_TTL_SECONDS, withDocumentLink, type DecideInput,
} from "./index.ts";
import { TEMPLATE_MAP } from "../../../supabase/functions/send-pending-notifications/templates.ts";
import { describe as describeInApp } from "../../../apps/web/src/lib/notifications/describe-in-app.ts";

const ctx = { notificationId: "n", recipientId: "r" };
const base: DecideInput = {
  channel: "sms", priority: "critical", nowMs: Date.UTC(2026, 9, 13, 21, 0), quiet: { enabled: false, start: "21:00", end: "07:00" },
  routinePushSentToday: 0, routinePushPerDay: 4, wordingViolations: [], isClinicianPage: false,
};
const REDS = ["red_event_guidance_waiting", "red_event_outreach_task", "test_alert"] as const;

describe("Q10 / OQ-92: SMS is decided by who the recipient is", () => {
  it("a critical row to a patient is not sent by SMS", () => {
    expect(decide({ ...base, isClinicianPage: isClinicianPageRow("patient", "emergency_event_clinician_alert") })).toEqual({ action: "suppress", reason: "sms_not_allowed" });
  });
  it("a clinician may be paged by SMS for any row, as before", () => {
    expect(decide({ ...base, priority: "routine", isClinicianPage: isClinicianPageRow("clinician", "on_call_page", "routine") })).toEqual({ action: "send" });
    expect(decide({ ...base, isClinicianPage: isClinicianPageRow("clinician", "on_call_page", "critical") })).toEqual({ action: "send" });
  });
  it("the paging roles (admin, care coordinator) only for a critical row", () => {
    for (const role of ["admin", "care_coordinator"]) {
      expect(isClinicianPageRow(role, "on_call_escalation", "critical")).toBe(true);
      expect(isClinicianPageRow(role, "ops_all_clear", "routine")).toBe(false);
    }
  });
  it("every other role never gets an SMS, critical or not (finance, analyst, pharmacist, lab, payer staff)", () => {
    for (const role of ["finance", "analyst", "pharmacist", "lab_partner", "lab_liaison", "hmo_admin", "corporate_admin", "payer_admin", "provider_org_staff", "ngo_admin"]) {
      expect(isClinicianPageRow(role, "ops_alert", "critical")).toBe(false);
      expect(decide({ ...base, isClinicianPage: isClinicianPageRow(role, "ops_alert", "critical") })).toEqual({ action: "suppress", reason: "sms_not_allowed" });
    }
  });
  it("an unknown role (a failed lookup) is not a clinician", () => {
    expect(isClinicianPageRow(undefined, "on_call_page")).toBe(false);
    expect(isClinicianPageRow(null, "on_call_page")).toBe(false);
  });
  it("a failed profile lookup leaves an SMS row for the next pass instead of settling it", () => {
    const src = readFileSync("../../supabase/functions/send-pending-notifications/index.ts", "utf8");
    expect(src).toContain('if (row.channel === "sms" && profilesError) continue;');
  });
  it("priority alone no longer opens the door (the old rule did)", () => {
    expect(decide({ ...base, priority: "critical", isClinicianPage: isClinicianPageRow("patient", "free_red_guidance") }).action).toBe("suppress");
  });
  it("the one named exception is the emergency contact alert, which this change does not decide", () => {
    expect(isClinicianPageRow("patient", "emergency_contact_alert")).toBe(true);
  });
  it("the sender uses the role rule and not the priority", () => {
    const src = readFileSync("../../supabase/functions/send-pending-notifications/index.ts", "utf8");
    expect(src).toContain("isClinicianPage: isClinicianPageRow(roleById.get(row.recipient_id), row.template, row.priority)");
    expect(src).not.toMatch(/isClinicianPage:\s*row\.priority === "critical"/);
  });
});

describe("Q12: reds keep generic wording on every surface", () => {
  const real = {
    systolic: 182, diastolic: 112, reading: "182/112", glucose: 2.4, condition: "hypertension", drug_name: "amlodipine",
    patient_name: "Ada Obi", details: "BP 182/112 with headache", result: "positive", vital_type: "blood_pressure", source_label: "bp reading",
  };
  const secrets = ["182", "112", "2.4", "hypertension", "amlodipine", "Ada", "Obi", "headache", "positive", "blood", "bp"];
  for (const key of REDS) {
    it(`${key}: real values in, none out, on SMS text, email subject, html and text`, () => {
      const r = TEMPLATE_MAP[key]!(real, ctx);
      const out = [r.smsText, r.email?.subject, r.email?.html, r.email?.text].filter(Boolean).join(" ").toLowerCase();
      for (const s of secrets) expect({ key, leaked: out.includes(s.toLowerCase()) ? s : null }).toEqual({ key, leaked: null });
      expect(out).not.toContain("—");
    });
    it(`${key}: passes the INV-07 lint with canary values`, () => {
      expect(describeViolations(lintRenderFn((p) => TEMPLATE_MAP[key]!(p, ctx)))).toEqual([]);
    });
    it(`${key}: the in-app line is fixed, lint-clean and ignores the payload`, () => {
      const a = describeInApp({ template: key, payload: real }).text;
      const b = describeInApp({ template: key, payload: {} }).text;
      expect(a).toBe(b);
      expect(a).not.toBe(describeInApp({ template: "unknown_template_zz", payload: {} }).text);
      expect(describeViolations(lintText(a))).toEqual([]);
    });
  }
  it("the red notice and the outreach alert are treated as safety rows (never held, never capped, generic when discreet)", () => {
    expect(isSafetyCritical("red_event_guidance_waiting")).toBe(true);
    expect(isSafetyCritical("red_event_outreach_task")).toBe(true);
  });
  it("a red push lock screen is the fixed words even with discreet mode off, and the urgent form when discreet is on", () => {
    const body = TEMPLATE_MAP["red_event_guidance_waiting"]!(real, ctx).smsText;
    expect(pushEnvelope(false, body, 160, true).body).toBe(body);
    expect(describeViolations(lintText(`${pushEnvelope(false, body, 160, true).title} ${body}`))).toEqual([]);
    expect(pushEnvelope(true, body, 160, true)).toEqual({ title: "Urgent message", body: "Open the app now." });
  });
  it("control: the lint would catch a leak", () => {
    expect(lintText("Your blood pressure reading is 182/112").length).toBeGreaterThan(0);
  });
});

describe("delivery reliability fields", () => {
  it("a routine push adds nothing", () => {
    expect(expoUrgencyFields(false, true)).toEqual({});
  });
  it("a safety push is high priority on the urgent channel, kept a day, time-sensitive on iPhone", () => {
    expect(expoUrgencyFields(true, false)).toEqual({ priority: "high", channelId: URGENT_CHANNEL_ID, ttl: URGENT_TTL_SECONDS, interruptionLevel: "time-sensitive", sound: "default" });
  });
  it("a phone that has not created the urgent channel is sent high priority on the default channel, never to a channel it lacks", () => {
    const f = expoUrgencyFields(true, false, false);
    expect(f.channelId).toBeUndefined();
    expect(f.priority).toBe("high");
  });
  it("the sender names the channel only for an Android phone that said it is ready, and the app says so at registration", () => {
    const src = readFileSync("../../supabase/functions/send-pending-notifications/index.ts", "utf8");
    expect(src).toContain('sub.platform !== "android" || sub.urgent_channel_ready === true');
    expect(readFileSync("../../apps/mobile/src/lib/push-registration.ts", "utf8")).toContain("urgent_channel_ready: urgentChannelReady");
  });
  it("critical is sent only when the entitlement switch is on", () => {
    expect(expoUrgencyFields(true, true).interruptionLevel).toBe("critical");
    expect(expoUrgencyFields(true, false).interruptionLevel).not.toBe("critical");
  });
  it("the channel id matches the one the app creates", () => {
    const app = readFileSync("../../apps/mobile/src/lib/notification-channels.ts", "utf8");
    expect(app).toContain(`URGENT_CHANNEL_ID = "${URGENT_CHANNEL_ID}"`);
  });
  it("no full-screen intent anywhere in the app config or channel code (Play restricts it to calls and alarms)", () => {
    const cfg = readFileSync("../../apps/mobile/app.json", "utf8") + readFileSync("../../apps/mobile/src/lib/notification-channels.ts", "utf8");
    expect(cfg).not.toMatch(/USE_FULL_SCREEN_INTENT|fullScreenIntent/i);
  });
});

describe("the migration and the sender agree (no template the database queues is missing from a renderer)", () => {
  const dir = "../../supabase/migrations";
  const file = readdirSync(dir).find((f) => f.endsWith("_s13r4_critical_ladder_and_red_outreach.sql"))!;
  const sql = readFileSync(`${dir}/${file}`, "utf8");
  const queued = [...new Set([...sql.matchAll(/'(red_event_guidance_waiting|red_event_outreach_task|test_alert)'/g)].map((m) => m[1] as string))];
  it("finds the templates the migration queues", () => {
    expect(queued.sort()).toEqual(["red_event_guidance_waiting", "red_event_outreach_task", "test_alert"]);
  });
  for (const key of queued) {
    it(`${key} has a sender renderer, an inbox line and a critical display tier where it is a red`, () => {
      expect(TEMPLATE_MAP[key]).toBeDefined();
      expect(describeInApp({ template: key, payload: {} }).text).not.toBe(describeInApp({ template: "unknown_template_zz", payload: {} }).text);
    });
  }
  it("the patient ladder never lists sms or voice after the filter, whatever the configuration says (source scan of the function)", () => {
    expect(sql).toContain("c in ('sms', 'voice', 'in_app')");
    expect(sql).toContain("v_channels := private.patient_critical_channels(r.recipient_id, v_channels)");
  });
});

describe("OQ-91: a signed link instead of an attachment", () => {
  const email = { subject: "Your care plan has been updated", html: "<div><p>Hi</p></div>", text: "Hi" };
  it("signs kind.id.expiry with HMAC-SHA256 and carries no name or test", async () => {
    const link = await signDocumentLink("s3cret", "lab-request", "11111111-1111-4111-8111-111111111111", 1_800_000_000_000);
    const expected = createHmac("sha256", "s3cret").update("lab-request.11111111-1111-4111-8111-111111111111.1800000000000").digest("hex");
    expect(link).toBe(`lab-request/11111111-1111-4111-8111-111111111111?e=1800000000000&s=${expected}`);
  });
  it("a different secret, id, kind or expiry gives a different signature", async () => {
    const a = await signDocumentLink("a", "care-plan", "x", 1);
    expect(await signDocumentLink("b", "care-plan", "x", 1)).not.toBe(a);
    expect(await signDocumentLink("a", "lab-request", "x", 1)).not.toBe(a);
    expect(await signDocumentLink("a", "care-plan", "y", 1)).not.toBe(a);
    expect(await signDocumentLink("a", "care-plan", "x", 2)).not.toBe(a);
  });
  it("adds one link line to the html and text and leaves the subject alone", () => {
    const [subject, html, text] = withDocumentLink(email, "fallback", "https://app.example/d/care-plan/x?e=1&s=2");
    expect(subject).toBe(email.subject);
    expect(html).toContain('<a href="https://app.example/d/care-plan/x?e=1&s=2">Sign in to open it</a></p></div>');
    expect(text).toBe("Hi\n\nSign in to open it: https://app.example/d/care-plan/x?e=1&s=2");
  });
  it("falls back to appending when the html has no closing div, and to the fallback text when there is none", () => {
    const [, html, text] = withDocumentLink({ subject: "s", html: "<p>Hi</p>" }, "plain", "https://x/y");
    expect(html).toBe('<p>Hi</p><p><a href="https://x/y">Sign in to open it</a></p>');
    expect(text.startsWith("plain")).toBe(true);
  });
  it("the two document templates no longer say anything is attached", () => {
    for (const key of ["lab_order_requested_patient", "preventive_care_plan_updated"]) {
      const r = TEMPLATE_MAP[key]!({ order_number: "T-1", self_booked: true, patient_name: "Ada" }, ctx);
      expect(`${r.smsText} ${r.email?.html} ${r.email?.text}`).not.toMatch(/attach/i);
    }
  });
});
