/**
 * S19c (P1): the page email never delivered because the sender took the address only from payload.to_email, which the page
 * functions never set. These tests exercise the real resolution path the sender uses (Auth user -> verified address ->
 * email row) with a fake Auth client, not row counts: a page notice reaches the recipient's own verified address, ignores any
 * address in the payload, and fails visibly (no address) rather than going anywhere else.
 */
import "./support/deno.ts";
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import {
  addressRuleFor, audienceFor, AUDIENCE_OVERRIDES, isSafetyCritical, OWN_ADDRESS_ONLY_TEMPLATES, resolveEmailAddress, verifiedAddressOf, type AuthEmailUser,
} from "./index.ts";
import { TEMPLATE_MAP } from "../../../supabase/functions/send-pending-notifications/templates.ts";

/** A fake of supabase.auth.admin.getUserById, wired exactly as the sender wires it. */
function fakeAuth(users: Record<string, AuthEmailUser>) {
  const calls: string[] = [];
  const lookupFor = (recipientId: string) => async (): Promise<string | undefined> => {
    calls.push(recipientId);
    return verifiedAddressOf(users[recipientId]);
  };
  return { calls, lookupFor };
}

const ACK_TIMEOUT_TEMPLATES = ["clinician_alert_ack_timeout_backup", "clinician_alert_ack_timeout_senior", "clinician_alert_ack_timeout_admin"];
// Queued by private.ops_alert_notify() with only the contact's profile id (no address in the payload).
const OPS_ALERT_TEMPLATES = ["ops_alert", "ops_all_clear"];
const PAGE_TEMPLATES = ["on_call_page", "on_call_test_page", "on_call_escalation", "on_call_unfinished", "on_call_expired", "on_call_ops_desk", "on_call_ops_desk_uncovered", "on_call_ops_desk_roster", "on_call_ops_desk_dead_letter"];

describe("which rule applies", () => {
  it("page, on-call, credential and care-team notices use the recipient's own address only", () => {
    for (const t of [...PAGE_TEMPLATES, "credential_notice", "care_team_notice", "care_message_safety_flag", ...OPS_ALERT_TEMPLATES, ...ACK_TIMEOUT_TEMPLATES]) expect(addressRuleFor(t)).toBe("own_only");
    expect(OWN_ADDRESS_ONLY_TEMPLATES.size).toBe(PAGE_TEMPLATES.length + 3 + OPS_ALERT_TEMPLATES.length + ACK_TIMEOUT_TEMPLATES.length);
  });
  it("everything not listed takes the payload address first and the recipient's own verified address otherwise", () => {
    expect(addressRuleFor("security.new_device_signin")).toBe("payload_then_own");
    expect(addressRuleFor("booking_reminder")).toBe("payload_then_own");
    expect(addressRuleFor("a_template_nobody_has_listed_yet")).toBe("payload_then_own");
    expect(addressRuleFor(null)).toBe("payload_then_own");
    expect(addressRuleFor(undefined)).toBe("payload_then_own");
  });
  it("every page template has a renderer, an email body and is safety critical (so quiet hours never hold it)", () => {
    for (const t of PAGE_TEMPLATES) {
      const render = TEMPLATE_MAP[t]?.({}, { notificationId: "n", recipientId: "r" });
      expect(render?.email?.subject).toBeTruthy();
      expect(isSafetyCritical(t)).toBe(true);
    }
  });
});

describe("operations alert emails", () => {
  it("reach the contact's own verified address although the payload carries none", async () => {
    const auth = fakeAuth({ admin1: { email: "ops@example.com", email_confirmed_at: "2026-01-01T00:00:00Z" } });
    const payload = { alert_id: "a", rule: "payment_webhooks_unprocessed", severity: "sev2" };
    for (const t of OPS_ALERT_TEMPLATES) {
      const r = await resolveEmailAddress(t, (payload as Record<string, unknown>).to_email, auth.lookupFor("admin1"));
      expect(r).toEqual({ address: "ops@example.com", source: "auth" });
    }
  });
  it("an unverified contact still fails visibly instead of going anywhere else", async () => {
    const auth = fakeAuth({ admin1: { email: "ops@example.com", email_confirmed_at: null } });
    const r = await resolveEmailAddress("ops_alert", "attacker@example.com", auth.lookupFor("admin1"));
    expect(r.address).toBeUndefined();
    expect(r.source).toBe("none");
  });
});

describe("audienceFor", () => {
  it("keeps what the database says, and treats care_team_notice as patient mail when the database has no row", () => {
    expect(audienceFor("care_team_notice", undefined)).toBe("patient");
    expect(audienceFor("care_team_notice", null)).toBe("patient");
    expect(audienceFor("care_team_notice", "lead")).toBe("lead");
    expect(audienceFor("booking_reminder", undefined)).toBeUndefined();
    expect(audienceFor("booking_reminder", "patient")).toBe("patient");
    expect(audienceFor(null, null)).toBeNull();
    expect(Object.keys(AUDIENCE_OVERRIDES)).toEqual(["care_team_notice"]);
  });
});

describe("verifiedAddressOf", () => {
  it("returns a confirmed address and nothing else", () => {
    expect(verifiedAddressOf({ email: "a@x.test", email_confirmed_at: "2026-10-01T00:00:00Z" })).toBe("a@x.test");
    expect(verifiedAddressOf({ email: "a@x.test", email_confirmed_at: null })).toBeUndefined();
    expect(verifiedAddressOf({ email: null, email_confirmed_at: "2026-10-01T00:00:00Z" })).toBeUndefined();
    expect(verifiedAddressOf({})).toBeUndefined();
    expect(verifiedAddressOf(null)).toBeUndefined();
    expect(verifiedAddressOf(undefined)).toBeUndefined();
  });
});

describe("resolveEmailAddress (the sender's real path)", () => {
  const auth = fakeAuth({
    doc: { email: "doctor@clinic.test", email_confirmed_at: "2026-10-01T00:00:00Z" },
    unverified: { email: "new@clinic.test", email_confirmed_at: null },
  });

  it("a page goes to the verified sign-in address when the payload has none (the P1 case)", async () => {
    const r = await resolveEmailAddress("on_call_page", undefined, auth.lookupFor("doc"));
    expect(r).toEqual({ address: "doctor@clinic.test", source: "auth" });
  });

  it("a page ignores an address in the payload: it cannot be redirected to a third party", async () => {
    const r = await resolveEmailAddress("on_call_page", "stranger@evil.test", auth.lookupFor("doc"));
    expect(r).toEqual({ address: "doctor@clinic.test", source: "auth" });
    const c = await resolveEmailAddress("care_team_notice", "stranger@evil.test", auth.lookupFor("doc"));
    expect(c.address).toBe("doctor@clinic.test");
  });

  it("an unverified or unknown account yields no address, and never falls back to the payload for a page", async () => {
    expect(await resolveEmailAddress("on_call_page", "stranger@evil.test", auth.lookupFor("unverified"))).toEqual({ address: undefined, source: "none" });
    expect(await resolveEmailAddress("on_call_page", undefined, auth.lookupFor("nobody"))).toEqual({ address: undefined, source: "none" });
  });

  it("a failing Auth lookup is reported as a failed lookup (retry), not as 'no address', and never falls back to the payload", async () => {
    const r = await resolveEmailAddress("on_call_page", "stranger@evil.test", async () => { throw new Error("auth down"); });
    expect(r).toEqual({ address: undefined, source: "lookup_failed" });
  });

  it("security notices: an explicit payload address wins, otherwise the verified Auth address", async () => {
    expect(await resolveEmailAddress("security.new_device_signin", "me@x.test", auth.lookupFor("doc"))).toEqual({ address: "me@x.test", source: "payload" });
    expect(await resolveEmailAddress("security.new_device_signin", "", auth.lookupFor("doc"))).toEqual({ address: "doctor@clinic.test", source: "auth" });
  });

  it("other templates use an explicit payload address with no Auth lookup", async () => {
    const before = auth.calls.length;
    expect(await resolveEmailAddress("booking_reminder", "p@x.test", auth.lookupFor("doc"))).toEqual({ address: "p@x.test", source: "payload" });
    expect(auth.calls.length).toBe(before);
  });

  it("an unlisted template whose payload names no address goes to the recipient's own verified address, never anywhere else", async () => {
    expect(await resolveEmailAddress("a_template_nobody_has_listed_yet", undefined, auth.lookupFor("doc"))).toEqual({ address: "doctor@clinic.test", source: "auth" });
    expect(await resolveEmailAddress("booking_reminder", 42, auth.lookupFor("doc"))).toEqual({ address: "doctor@clinic.test", source: "auth" });
    expect(await resolveEmailAddress("booking_reminder", undefined, auth.lookupFor("unverified"))).toEqual({ address: undefined, source: "none" });
    expect(await resolveEmailAddress("booking_reminder", undefined, async () => { throw new Error("auth down"); })).toEqual({ address: undefined, source: "lookup_failed" });
  });
});

describe("the sender is wired to the rule", () => {
  const sender = readFileSync(new URL("../../../supabase/functions/send-pending-notifications/index.ts", import.meta.url), "utf8");
  it("resolves the address with resolveEmailAddress before the privacy decision, and no longer takes it from the payload alone", () => {
    expect(sender).toContain("resolveEmailAddress(row.template");
    expect(sender.indexOf("resolveEmailAddress(row.template")).toBeLessThan(sender.indexOf("const privacy = privacyFor("));
    expect(sender).not.toMatch(/let toEmail = typeof payload\.to_email/);
  });
  it("reads critical rows before routine ones and refuses SMS or voice for on_call templates", () => {
    expect(sender).toContain('.eq("priority", "critical")');
    expect(sender).toContain('row.template.startsWith("on_call_")');
  });
  it("retries a row whose Auth lookup failed instead of failing it for good, and logs the lookup error", () => {
    expect(sender).toContain('resolvedEmail?.source === "lookup_failed"');
    expect(sender).toContain("await markRetry(");
    expect(sender).toContain("throw error;");
  });
  it("fails a page row at once for an error a retry cannot fix, and retries the rest", () => {
    expect(sender).toContain("PERMANENT_PAGE_ERRORS");
    expect(sender).toContain("no active push subscription|no email address|address suppressed");
    expect(sender).toContain("permanentPageFailure");
  });
  it("lets a page row be retried rather than failed on the first error (pages no longer have the legacy ladder behind them)", () => {
    expect(sender).toContain("isPageRow");
  });
});

describe("unacknowledged-alert ladder email (backup, senior, admin)", () => {
  // Live, 8 admin-rung emails failed with "template has no email rendering" and 942 more with "recipient has no email address":
  // the ladder writes push, email and in-app (SMS is refused, INV-08), so both halves must hold or an admin without push is never reached.
  for (const template of ACK_TIMEOUT_TEMPLATES) {
    it(`${template} renders an email that escapes the message`, () => {
      const render = TEMPLATE_MAP[template]?.({ message: "You have a new <urgent> alert & more" }, { notificationId: "n", recipientId: "r" });
      expect(render.email?.subject).toBeTruthy();
      expect(render.email?.html).toContain("&lt;urgent&gt; alert &amp; more");
      expect(render.email?.html).not.toContain("<urgent>");
      expect(render.email?.text).toContain("You have a new <urgent> alert & more");
    });

    it(`${template} goes to the recipient's own verified address, never a payload address`, async () => {
      const auth = fakeAuth({ clin: { email: "clin@example.test", email_confirmed_at: "2026-01-01T00:00:00Z" } });
      const r = await resolveEmailAddress(template, "stranger@evil.test", auth.lookupFor("clin"));
      expect(r).toEqual({ address: "clin@example.test", source: "auth" });
    });
  }
});
