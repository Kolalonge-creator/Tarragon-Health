/**
 * S04b-3: quiet hours and discreet mode in the one sender. The sender's decision is the pure `decide` plus the
 * envelope helpers, so these tests cover the whole rule: a reminder is held then released (and never then capped), a
 * red event never is, discreet mode produces generic words on push and email, and privacy is applied only to email
 * that really is the recipient's own.
 */
import "./support/deno.ts";
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import {
  decide, DISCREET_DOCUMENT_TEMPLATES, discreetEmail, FALLBACK_QUIET, isSafetyCritical, PATIENT_AUDIENCES, privacyFor, pushEnvelope,
  type DecideInput, type PrivacyInput, type QuietSettings,
} from "./index.ts";
import { TEMPLATE_MAP } from "../../../supabase/functions/send-pending-notifications/templates.ts";

const Q: QuietSettings = { enabled: true, start: "21:00", end: "07:00" };
const utc = (h: number, m = 0) => Date.UTC(2026, 9, 6, h, m); // Africa/Lagos is UTC+1
const DAY = 24 * 3600_000;
const night = utc(21); // 22:00 Lagos
const reminder: DecideInput = {
  channel: "push", priority: "routine", nowMs: night, quiet: Q, routinePushSentToday: 0, routinePushPerDay: 4,
  wordingViolations: [], isClinicianPage: false, safetyCritical: false,
};

describe("quiet hours", () => {
  it("are off when nothing says otherwise", () => {
    expect(FALLBACK_QUIET.enabled).toBe(false);
    expect(decide({ ...reminder, quiet: FALLBACK_QUIET })).toEqual({ action: "send" });
  });

  it("hold a reminder, then release it once the window ends (held, not dropped)", () => {
    const held = decide(reminder);
    expect(held.action).toBe("defer");
    const until = (held as { until: number }).until;
    expect(until).toBe(utc(6) + DAY); // 07:00 Lagos
    expect(decide({ ...reminder, nowMs: until - 1 }).action).toBe("defer");
    expect(decide({ ...reminder, nowMs: until })).toEqual({ action: "send" });
  });

  it("a released reminder is not then dropped by the daily push cap", () => {
    const until = (decide(reminder) as { until: number }).until;
    const capped = { ...reminder, nowMs: until, routinePushSentToday: 4 };
    expect(decide(capped)).toEqual({ action: "suppress", reason: "daily_cap" }); // a fresh reminder is capped
    expect(decide({ ...capped, previouslyHeld: true })).toEqual({ action: "send" }); // one that was held is sent
    expect(decide({ ...capped, previouslyHeld: false }).action).toBe("suppress");
  });

  it("hold email the same way", () => {
    expect(decide({ ...reminder, channel: "email" }).action).toBe("defer");
  });

  it("never hold a red event, by priority or by template, nor count it against the push cap", () => {
    expect(decide({ ...reminder, priority: "critical" })).toEqual({ action: "send" });
    expect(decide({ ...reminder, safetyCritical: true })).toEqual({ action: "send" });
    expect(decide({ ...reminder, nowMs: utc(10), safetyCritical: true, routinePushSentToday: 99 })).toEqual({ action: "send" });
    expect(decide({ ...reminder, channel: "email", safetyCritical: true })).toEqual({ action: "send" });
  });
});

describe("safety templates", () => {
  // The exact list the rule must cover, kept in one place with the rule (delivery.ts).
  const SAFETY_KEYS = [
    "emergency_followup", "emergency_contact_alert", "emergency_event_clinician_alert", "vitals_monitoring_escalated",
    "on_call_page", "on_call_escalation", "vitals_red_flag_clinician_alert", "abnormal_result_clinician_alert",
    "critical_notification_escalation_exhausted", "screening_escalated", "vaccination_escalated", "triage_recheck_due",
    "consult_join_ready", "video_call_requested", "security.new_device_signin",
  ];
  const NOT_SAFETY = ["booking_reminder", "daily_digest", "credential_notice", "emergency_card_viewed", "emergency_card_expiring_soon", "reputation_review_request_trustpilot", "", null, undefined];

  it("are recognised, and ordinary reminders are not", () => {
    for (const t of SAFETY_KEYS) expect(isSafetyCritical(t)).toBe(true);
    for (const t of NOT_SAFETY) expect(isSafetyCritical(t)).toBe(false);
  });

  it("cover every sender template whose key says emergency, escalation, paging, a red flag, an abnormal result or a live consult", () => {
    const suggestsSafety = /(^|_)(emergency|escalat|red_flag|red_event|on_call|clinician_alert|abnormal|triage_recheck|consult_join|video_call|critical)|^security\./;
    const keys = Object.keys(TEMPLATE_MAP);
    const flagged = keys.filter((k) => suggestsSafety.test(k));
    expect(flagged.length).toBeGreaterThan(8); // the scan cannot pass by finding nothing
    const notCovered = flagged.filter((k) => !isSafetyCritical(k));
    // The only keys that sound urgent but are routine information are the emergency card notices.
    expect(notCovered.sort()).toEqual(keys.filter((k) => /^emergency_card_/.test(k)).sort());
  });
});

describe("privacyFor", () => {
  const email: PrivacyInput = { role: "patient", discreetFlag: true, known: true, channel: "email", audience: "patient", toEmailIsOwn: true };
  const none = { quietApplies: false, discreet: false };

  it("applies a patient's quiet hours and discreet wording to their own email", () => {
    expect(privacyFor(email)).toEqual({ quietApplies: true, discreet: true });
    expect(privacyFor({ ...email, discreetFlag: false })).toEqual({ quietApplies: true, discreet: false });
    expect(privacyFor({ ...email, audience: "sponsor", role: "patient" }).discreet).toBe(true);
  });

  it("applies nothing to lab, pharmacy, specialist, emergency-contact, broadcast or other third-party audiences", () => {
    for (const audience of ["partner_lab", "partner_pharmacy", "partner_specialist", "patient_emergency_contact", "patient_or_partner", "admin", "clinician", "lead", "pharmacy"]) {
      expect(privacyFor({ ...email, audience })).toEqual(none);
    }
  });

  it("fails safe: no audience, a failed audience lookup, or an address that is not the recipient's own applies nothing", () => {
    expect(privacyFor({ ...email, audience: undefined })).toEqual(none); // template has no registry row
    expect(privacyFor({ ...email, audience: null })).toEqual(none); // lookup failed
    expect(privacyFor({ ...email, toEmailIsOwn: false })).toEqual(none); // addressed to someone else
    expect(privacyFor({ ...email, toEmailIsOwn: null })).toEqual(none); // could not check
    // even when the settings lookup also failed
    expect(privacyFor({ ...email, known: false, audience: "partner_lab" })).toEqual(none);
    expect(privacyFor({ ...email, known: false, toEmailIsOwn: false })).toEqual(none);
  });

  it("the allow-list is positive and short", () => {
    expect([...PATIENT_AUDIENCES].sort()).toEqual(["patient", "patient_or_sponsor", "patient_waitlisted", "sponsor", "sponsor_and_patient"]);
  });

  it("a push always goes to the recipient's own device, so it takes their choices whatever the audience", () => {
    const push: PrivacyInput = { ...email, channel: "push", audience: undefined, toEmailIsOwn: null };
    expect(privacyFor(push)).toEqual({ quietApplies: true, discreet: true });
    expect(privacyFor({ ...push, role: "clinician", discreetFlag: false })).toEqual(none);
    expect(privacyFor({ ...push, role: undefined, discreetFlag: undefined })).toEqual(none);
  });

  it("goes generic on a push when the settings could not be read, and holds nothing", () => {
    expect(privacyFor({ ...email, channel: "push", known: false, discreetFlag: undefined })).toEqual({ quietApplies: false, discreet: true });
  });
});

describe("discreet mode", () => {
  it("sends a push with no brand or topic, and an urgent one says only that it is urgent", () => {
    expect(pushEnvelope(true, "Your blood pressure is high")).toEqual({ title: "New message", body: "Open the app." });
    expect(pushEnvelope(true, "anything", 160, true)).toEqual({ title: "Urgent message", body: "Open the app now." });
    expect(pushEnvelope(false, "Hello", 160, true)).toEqual({ title: "Tarragon Health", body: "Hello" });
  });

  it("sends an email with no brand, topic or link", () => {
    expect(discreetEmail(false).subject).toBe("New message");
    expect(discreetEmail(true).subject).toBe("Urgent message");
    for (const m of [discreetEmail(false), discreetEmail(true), discreetEmail(false, true)]) {
      expect(`${m.subject} ${m.html} ${m.text}`).not.toMatch(/tarragon|http|result|medic|test|pressure|sugar|—/i);
    }
  });

  it("tells a patient a document is waiting in the app when the real email carried one", () => {
    expect(discreetEmail(false, true).text).toBe("You have a new document. Open the app to read it.");
    expect([...DISCREET_DOCUMENT_TEMPLATES].sort()).toEqual(["lab_order_requested_patient", "preventive_care_plan_updated"]);
  });

  it("the sender covers every template it attaches a document to, records the trace event, and does not send a review link", () => {
    const src = readFileSync("../../supabase/functions/send-pending-notifications/index.ts", "utf8");
    const attached = [...src.matchAll(/row\.template === "([a-z_]+)"[^\n]*\n\s+const pdf = await fetch/g)].map((m) => m[1]);
    const attachedElse = [...src.matchAll(/else if \(row\.template === "([a-z_]+)"\) \{\n\s+const pdf = await fetch/g)].map((m) => m[1]);
    expect([...new Set([...attached, ...attachedElse])].sort()).toEqual([...DISCREET_DOCUMENT_TEMPLATES].sort());
    expect(src).toContain('"discreet_document_in_app"');
    expect(src).toContain("pushedBackIds");
    expect(src).toMatch(/discreetMail && row\.template === "reputation_review_request_trustpilot"/);
  });
});
