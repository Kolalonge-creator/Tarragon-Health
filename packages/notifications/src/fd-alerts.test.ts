/**
 * Front Desk M4: handoff alerts to the founder and the founder's replies to visitors (F11, F12). The decisions (who is owed an alert, urgent
 * first, retries) are proved in packages/db/tests/fd_m4_chat_receptionist.sql; this proves the emails are right and the delivery loop is safe.
 */
import "./support/deno.ts";
import { describe, expect, it } from "@jest/globals";
import { createMockEmail } from "../../../supabase/functions/_shared/integrations/email-mock.ts";
import { deliverAlerts, deliverReplies, renderAlert, verifyUnsubscribeToken, type ClaimedAlert, type ClaimedReply } from "../../../supabase/functions/_shared/frontdesk/index.ts";
import { handleDispatch } from "../../../supabase/functions/fd-followup-dispatcher/handler.ts";

const APP = "https://app.tarragonhealth.ng";
const SECRET = "unsub-secret-that-is-long-enough-for-tests-0123456789";
const CONTACT = "11111111-1111-4111-8111-111111111111";

const alert = (o: Partial<ClaimedAlert> = {}): ClaimedAlert => ({
  handoff_id: "h1", urgency: "normal", reason: "cannot_answer", summary: "Asked about corporate plans for 500 staff.", suggested_reply: "Hello, thanks for asking.",
  conversation_id: "c1", contact_name: "Ada Obi", contact_email: "ada@example.invalid", contact_phone: null,
  transcript: [{ role: "visitor", content: "Do you do corporate plans?" }, { role: "assistant", content: "I will pass that on." }], attempts: 1, ...o,
});

describe("renderAlert", () => {
  it("an urgent alert says URGENT in the subject and leads with the emergency fact", () => {
    const m = renderAlert(alert({ urgency: "urgent", reason: "emergency", summary: "Emergency wording matched: chest_pain." }), APP);
    expect(m.subject).toMatch(/^URGENT: website chat, a visitor used emergency wording/);
    expect(m.text.split("\n")[0]).toMatch(/^URGENT\./);
    expect(m.text).toMatch(/nearest hospital/);
  });
  it("a normal alert carries who, the summary, the suggested reply, the recent messages and the inbox link", () => {
    const m = renderAlert(alert(), APP);
    expect(m.subject).toBe("Website chat: a visitor the assistant could not answer");
    for (const part of ["Ada Obi, ada@example.invalid", "corporate plans for 500 staff", "Hello, thanks for asking.", "Visitor: Do you do corporate plans?", "Assistant: I will pass that on.", `${APP}/admin/inbox`]) {
      expect(m.text).toContain(part);
    }
  });
  it("copes with a visitor who left no details and no transcript", () => {
    const m = renderAlert(alert({ contact_name: null, contact_email: null, summary: null, suggested_reply: null, transcript: null }), APP);
    expect(m.text).toContain("No contact details left yet");
    expect(m.text).toContain("(none)");
  });
  it("escapes anything the visitor typed in the HTML part", () => {
    const m = renderAlert(alert({ transcript: [{ role: "visitor", content: "<img src=x onerror=alert(1)>" }], summary: "<b>hi</b>" }), APP);
    expect(m.html).not.toContain("<img");
    expect(m.html).not.toContain("<b>hi</b>");
    expect(m.html).toContain("&lt;img");
  });
});

describe("deliverAlerts", () => {
  const mk = (alerts: ClaimedAlert[]) => {
    const mock = createMockEmail();
    const finished: { id: string; ok: boolean; err: string | null }[] = [];
    return { mock, finished, deps: { email: mock, to: "founder@example.invalid", appBaseUrl: APP, claim: async () => ({ ok: true as const, alerts }), finish: async (id: string, ok: boolean, err: string | null) => void finished.push({ id, ok, err }) } };
  };
  it("sends each alert to the founder as staff mail, with an idempotency key per handoff and urgency, and records it", async () => {
    const h = mk([alert({ handoff_id: "h1", urgency: "urgent", reason: "emergency" }), alert({ handoff_id: "h2" })]);
    expect(await deliverAlerts(h.deps)).toEqual({ claimed: 2, sent: 2, failed: 0, unrecorded: 0 });
    expect(h.mock.outbox.map((o) => o.to)).toEqual(["founder@example.invalid", "founder@example.invalid"]);
    expect(h.mock.outbox[0]).toMatchObject({ audience: "staff", idempotencyKey: "fd-alert-h1-urgent" });
    expect(h.mock.outbox[1]?.idempotencyKey).toBe("fd-alert-h2-normal");
    expect(h.finished.every((f) => f.ok)).toBe(true);
  });
  it("an escalation to urgent sends a NEW alert (the key includes the urgency)", async () => {
    const h = mk([alert({ urgency: "normal" })]);
    await deliverAlerts(h.deps);
    const h2 = { ...h, deps: { ...h.deps, claim: async () => ({ ok: true as const, alerts: [alert({ urgency: "urgent" })] }) } };
    await deliverAlerts(h2.deps);
    expect(h.mock.outbox).toHaveLength(2);
  });
  it("records a provider failure and carries on", async () => {
    const h = mk([alert({ handoff_id: "a" }), alert({ handoff_id: "b" })]);
    h.mock.failNextCall();
    expect(await deliverAlerts(h.deps)).toEqual({ claimed: 2, sent: 1, failed: 1, unrecorded: 0 });
    expect(h.finished[0]).toMatchObject({ ok: false });
  });
  it("counts a delivered-but-unrecorded alert and does not record it as a failure", async () => {
    const h = mk([alert()]);
    const oks: boolean[] = [];
    expect(await deliverAlerts({ ...h.deps, finish: async (_i, ok) => { oks.push(ok); throw new Error("db down"); } })).toEqual({ claimed: 1, sent: 0, failed: 0, unrecorded: 1 });
    expect(oks).toEqual([true]);
  });
  it("returns the claim error and sends nothing", async () => {
    const h = mk([]);
    expect(await deliverAlerts({ ...h.deps, claim: async () => ({ ok: false as const, error: "boom" }) })).toEqual({ error: "boom" });
  });
});

describe("deliverReplies", () => {
  const reply = (o: Partial<ClaimedReply> = {}): ClaimedReply => ({ handoff_id: "h1", contact_id: CONTACT, email: "ada@example.invalid", first_name: "Ada", reply: "Hello Ada,\n\nYes, parents can each join.\n\nThe team", attempts: 1, ...o });
  const mk = (replies: ClaimedReply[]) => {
    const mock = createMockEmail();
    const finished: { id: string; ok: boolean; msg: string | null }[] = [];
    return { mock, finished, deps: { email: mock, appBaseUrl: APP, unsubscribeSecret: SECRET, claim: async () => ({ ok: true as const, replies }), finish: async (id: string, ok: boolean, msg: string | null) => void finished.push({ id, ok, msg }) } };
  };
  it("sends the founder's words unchanged with an unsubscribe link that verifies and the one-click headers", async () => {
    const h = mk([reply()]);
    expect(await deliverReplies(h.deps)).toEqual({ claimed: 1, sent: 1, failed: 0, unrecorded: 0 });
    const sent = h.mock.outbox[0]!;
    expect(sent.text).toContain("Yes, parents can each join.");
    expect(sent.audience).toBe("staff");
    expect(sent.idempotencyKey).toBe("fd-reply-h1");
    expect(sent.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const m = /c=([0-9a-f-]{36})&t=([0-9a-f]{40})/.exec(sent.text);
    expect(await verifyUnsubscribeToken(SECRET, m![1] as string, m![2] as string)).toBe(true);
    expect(h.finished[0]).toMatchObject({ ok: true });
  });
  it("escapes markup in the HTML part and keeps paragraphs", async () => {
    const h = mk([reply({ reply: "First paragraph.\n\n<script>alert(1)</script>" })]);
    await deliverReplies(h.deps);
    expect(h.mock.outbox[0]?.html).not.toContain("<script>");
    expect(h.mock.outbox[0]?.html?.match(/<p /g)?.length).toBeGreaterThanOrEqual(3);
  });
  it("records failures and unrecorded sends correctly", async () => {
    const h = mk([reply({ handoff_id: "a" }), reply({ handoff_id: "b" })]);
    h.mock.failNextCall();
    expect(await deliverReplies(h.deps)).toEqual({ claimed: 2, sent: 1, failed: 1, unrecorded: 0 });
  });
});

describe("handleDispatch with alerts and replies", () => {
  const req = (secret = "s3cret") => new Request("https://x.invalid/fd", { method: "POST", headers: { "x-fd-followup-secret": secret } });
  const base = (o: Record<string, unknown> = {}) => {
    const mock = createMockEmail();
    return {
      mock,
      deps: {
        secret: "s3cret", unsubscribeSecret: SECRET as string | null, email: mock, appBaseUrl: APP, siteUrl: "https://tarragonhealth.ng",
        claim: async () => ({ ok: true as const, runs: [] }), finish: async () => undefined,
        founderEmail: "founder@example.invalid" as string | null,
        alerts: { claim: async () => ({ ok: true as const, alerts: [alert({ urgency: "urgent", reason: "emergency" })] }), finish: async () => undefined },
        replies: { claim: async () => ({ ok: true as const, replies: [] as ClaimedReply[] }), finish: async () => undefined },
        ...o,
      },
    };
  };
  it("sends the alert even when the unsubscribe secret is missing (an emergency alert must not wait on the follow-up setup)", async () => {
    const b = base({ unsubscribeSecret: null });
    const res = await handleDispatch(req(), b.deps);
    expect(res.status).toBe(200);
    expect(b.mock.outbox).toHaveLength(1);
    expect(b.mock.outbox[0]?.subject).toMatch(/^URGENT/);
  });
  it("leaves alerts pending and says why when the founder address is not set", async () => {
    let claimed = 0;
    const b = base({ founderEmail: null, alerts: { claim: async () => { claimed += 1; return { ok: true as const, alerts: [] }; }, finish: async () => undefined } });
    const res = await handleDispatch(req(), b.deps);
    expect(((await res.json()) as { alerts: unknown }).alerts).toEqual({ skipped: "founder_alert_email_missing" });
    expect(claimed).toBe(0);
  });
  it("answers 500 when the alert queue cannot be read, so the failure is visible", async () => {
    const b = base({ alerts: { claim: async () => ({ ok: false as const, error: "boom" }), finish: async () => undefined } });
    expect((await handleDispatch(req(), b.deps)).status).toBe(500);
  });
  it("still refuses a wrong secret", async () => {
    expect((await handleDispatch(req("nope"), base().deps)).status).toBe(401);
  });
});
