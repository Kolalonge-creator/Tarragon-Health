/**
 * Front Desk M2: rendering, the unsubscribe token, the dispatcher and its handler (F8, F10). The decisions about WHO may be mailed live in the
 * database and are proved in packages/db/tests/fd_m2_followup_engine.sql; this proves that what is sent is well formed, safe and recorded.
 */
import "./support/deno.ts";
import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createMockEmail } from "../../../supabase/functions/_shared/integrations/email-mock.ts";
import { dispatchFollowups, displayName, linkFor, renderFollowup, unsubscribeToken, verifyUnsubscribeToken, type ClaimedRun } from "../../../supabase/functions/_shared/frontdesk/index.ts";
import { handleDispatch } from "../../../supabase/functions/fd-followup-dispatcher/handler.ts";

const APP = "https://app.tarragonhealth.ng";
const SITE = "https://tarragonhealth.ng";
const SECRET = "unsub-secret-that-is-long-enough-for-tests-0123456789";
const CONTACT = "11111111-1111-4111-8111-111111111111";

const base = {
  subject: "Your TarragonHealth account is nearly ready",
  bodyText: "Hello {{first_name}},\n\nPick up where you left off: {{link}}\n\nThe TarragonHealth team",
  firstName: "Ada",
  stepKey: "finish_signup_1",
  sequenceKey: "finish_signup",
  appBaseUrl: APP,
  siteUrl: SITE,
  unsubscribeUrl: `${APP}/api/frontdesk/unsubscribe?c=${CONTACT}&t=abc`,
};

describe("renderFollowup", () => {
  it("fills the name and the step's link, and appends the unsubscribe footer and one-click headers", () => {
    const m = renderFollowup(base);
    expect(m.text).toContain("Hello Ada,");
    expect(m.text).toContain(`${APP}/onboarding`);
    expect(m.text).toContain("Stop these emails:");
    expect(m.html).toContain('<a href="https://app.tarragonhealth.ng/onboarding">');
    expect(m.headers["List-Unsubscribe"]).toBe(`<${base.unsubscribeUrl}>`);
    expect(m.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("falls back to 'there' for a missing or implausible name, and never injects markup", () => {
    expect(displayName(null)).toBe("there");
    expect(displayName("")).toBe("there");
    expect(displayName("<script>alert(1)</script>")).toBe("there");
    expect(displayName("Chidi")).toBe("Chidi");
    expect(displayName("Mary-Ann")).toBe("Mary-Ann");
    expect(renderFollowup({ ...base, firstName: "<b>x</b>" }).html).not.toContain("<b>x</b>");
  });

  it("escapes markup that appears in the approved wording", () => {
    const m = renderFollowup({ ...base, bodyText: "Hello {{first_name}} <img src=x onerror=alert(1)> {{link}}" });
    expect(m.html).not.toContain("<img");
    expect(m.html).toContain("&lt;img");
  });

  it("sends each kind of step to a sensible place", () => {
    expect(linkFor("finish_signup_2", "finish_signup", APP, SITE)).toBe(`${APP}/onboarding`);
    expect(linkFor("welcome_3", "welcome", APP, SITE)).toBe(`${SITE}/pricing`);
    expect(linkFor("health_check_1", "health_check_interest", APP, SITE)).toBe(`${SITE}/annual-health-check`);
    expect(linkFor("post_enquiry_1", "post_enquiry", APP, SITE)).toBe(`${SITE}/pricing/how-it-works`);
    expect(linkFor("risk_check_1", "risk_check_nudge", APP, SITE)).toBe(APP);
  });
});

describe("every seeded step, fully rendered, is accepted by the patient email lint", () => {
  const dir = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
  const sql = readFileSync(dir + (readdirSync(dir).find((f) => f.endsWith("_fd_m1_front_desk_foundations.sql")) ?? "missing"), "utf8");
  const block = sql.slice(sql.indexOf("insert into public.fd_sequence_steps"), sql.indexOf("-- Knowledge drafts"));
  const rows = [...block.matchAll(/\('([a-z_0-9]+)', (\d+), '([a-z_0-9]+)', (\d+), '((?:[^']|'')*)',\s*E'((?:[^']|'')*)'\)/g)].map((m) => ({
    seq: m[1] as string,
    step: m[3] as string,
    subject: (m[5] as string).replace(/''/g, "'"),
    body: (m[6] as string).replace(/''/g, "'").replace(/\\n/g, "\n"),
  }));

  it("parsed all 15 steps", () => expect(rows.length).toBe(15));

  it("accepts each one (no condition, reading, result or medicine word anywhere in the full email, footer included)", async () => {
    const mock = createMockEmail();
    for (const r of rows) {
      const m = renderFollowup({ ...base, subject: r.subject, bodyText: r.body, stepKey: r.step, sequenceKey: r.seq });
      const res = await mock.send({ to: "ada@example.invalid", subject: m.subject, text: m.text, html: m.html, audience: "patient", idempotencyKey: `t-${r.step}`, headers: m.headers });
      expect({ step: r.step, ok: res.ok }).toEqual({ step: r.step, ok: true });
    }
  });
});

describe("unsubscribe token", () => {
  it("matches the shared vector that the database proof also asserts (TypeScript and SQL mint the same token)", async () => {
    expect(await unsubscribeToken("proof-unsub-secret-0123456789abcdef0123456789", CONTACT)).toBe("b546d680d7b00bf4f89a1166a07d08d8370fcadd");
  });
  it("verifies for the same contact and secret", async () => {
    const t = await unsubscribeToken(SECRET, CONTACT);
    expect(t).toMatch(/^[0-9a-f]{40}$/);
    expect(await verifyUnsubscribeToken(SECRET, CONTACT, t)).toBe(true);
  });
  it("is refused for another contact, another secret, a tampered token and malformed input", async () => {
    const t = await unsubscribeToken(SECRET, CONTACT);
    expect(await verifyUnsubscribeToken(SECRET, "22222222-2222-4222-8222-222222222222", t)).toBe(false);
    expect(await verifyUnsubscribeToken("another-secret-another-secret-another-secret", CONTACT, t)).toBe(false);
    expect(await verifyUnsubscribeToken(SECRET, CONTACT, t.replace(/.$/, t.endsWith("0") ? "1" : "0"))).toBe(false);
    expect(await verifyUnsubscribeToken(SECRET, "not-a-uuid", t)).toBe(false);
    expect(await verifyUnsubscribeToken(SECRET, CONTACT, "short")).toBe(false);
    expect(await verifyUnsubscribeToken("", CONTACT, t)).toBe(false);
  });
});

const run = (n: number): ClaimedRun => ({
  run_id: `00000000-0000-4000-8000-00000000000${n}`,
  contact_id: CONTACT,
  email: `ada${n}@example.invalid`,
  first_name: "Ada",
  sequence_key: "finish_signup",
  step_key: "finish_signup_1",
  subject: base.subject,
  body_text: base.bodyText,
  attempt: 1,
});

function harness(runs: ClaimedRun[]) {
  const mock = createMockEmail();
  const finished: { id: string; ok: boolean; msg: string | null; err: string | null }[] = [];
  const deps = {
    email: mock,
    claim: async () => ({ ok: true as const, runs }),
    finish: async (id: string, ok: boolean, msg: string | null, err: string | null) => void finished.push({ id, ok, msg, err }),
    unsubscribeSecret: SECRET,
    appBaseUrl: APP,
    siteUrl: SITE,
  };
  return { mock, finished, deps };
}

describe("dispatchFollowups", () => {
  it("sends each claimed run once, with the run id as the idempotency key and the unsubscribe headers, and records success", async () => {
    const h = harness([run(1), run(2)]);
    const r = await dispatchFollowups(h.deps);
    expect(r).toEqual({ claimed: 2, sent: 2, failed: 0, unrecorded: 0 });
    expect(h.mock.outbox.map((o) => o.idempotencyKey)).toEqual(["fd-run-00000000-0000-4000-8000-000000000001", "fd-run-00000000-0000-4000-8000-000000000002"]);
    expect(h.mock.outbox[0]?.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(h.mock.outbox[0]?.audience).toBe("patient");
    expect(h.finished.every((f) => f.ok && f.msg !== null)).toBe(true);
    // the unsubscribe link in the mail carries a token that verifies for that contact
    const url = /c=([0-9a-f-]{36})&t=([0-9a-f]{40})/.exec(h.mock.outbox[0]?.text ?? "");
    expect(url).not.toBeNull();
    expect(await verifyUnsubscribeToken(SECRET, url![1] as string, url![2] as string)).toBe(true);
  });

  it("records a provider failure as failed (the database retries it later) and carries on with the next run", async () => {
    const h = harness([run(1), run(2)]);
    h.mock.failNextCall();
    const r = await dispatchFollowups(h.deps);
    expect(r).toEqual({ claimed: 2, sent: 1, failed: 1, unrecorded: 0 });
    expect(h.finished[0]).toMatchObject({ ok: false, msg: null });
    expect(h.finished[0]?.err).toMatch(/network/);
    expect(h.finished[1]?.ok).toBe(true);
  });

  it("records a thrown error as failed and never throws", async () => {
    const h = harness([run(1)]);
    const boom = { ...h.deps, email: { ...h.mock, send: async () => { throw new Error("socket hang up"); } } };
    const r = await dispatchFollowups(boom);
    expect(r).toEqual({ claimed: 1, sent: 0, failed: 1, unrecorded: 0 });
    expect(h.finished[0]?.err).toBe("socket hang up");
  });

  it("returns the claim error and sends nothing when the database cannot be read", async () => {
    const h = harness([]);
    const r = await dispatchFollowups({ ...h.deps, claim: async () => ({ ok: false as const, error: "boom" }) });
    expect(r).toEqual({ error: "boom" });
    expect(h.mock.outbox).toHaveLength(0);
  });

  it("does not send to a suppressed address (the mock refuses it like the real adapter) and records it failed", async () => {
    const h = harness([run(1)]);
    h.mock.suppress("ada1@example.invalid");
    const r = await dispatchFollowups(h.deps);
    expect(r).toEqual({ claimed: 1, sent: 0, failed: 1, unrecorded: 0 });
  });

  it("when the email WENT OUT but recording it failed, it is counted unrecorded and NOT recorded as a failure (which would schedule a resend)", async () => {
    const h = harness([run(1)]);
    const calls: boolean[] = [];
    const r = await dispatchFollowups({ ...h.deps, finish: async (_id, ok) => { calls.push(ok); throw new Error("db down"); } });
    expect(r).toEqual({ claimed: 1, sent: 0, failed: 0, unrecorded: 1 });
    expect(h.mock.outbox).toHaveLength(1);
    expect(calls).toEqual([true]);
  });
});

describe("handleDispatch", () => {
  const req = (secret?: string) => new Request("https://x.invalid/fd", { method: "POST", headers: secret ? { "x-fd-followup-secret": secret } : {} });
  const mk = () => ({ ...harness([run(1)]).deps, secret: "s3cret" as string | null });

  it("fails closed without a configured secret", async () => {
    expect((await handleDispatch(req("s3cret"), { ...mk(), secret: null })).status).toBe(503);
  });
  it("refuses a missing or wrong secret and sends nothing", async () => {
    const d = harness([run(1)]);
    const deps = { ...d.deps, secret: "s3cret" };
    expect((await handleDispatch(req(), deps)).status).toBe(401);
    expect((await handleDispatch(req("wrong"), deps)).status).toBe(401);
    expect(d.mock.outbox).toHaveLength(0);
  });
  it("claims nothing when email or the unsubscribe secret is not configured (the runs wait for the next tick)", async () => {
    let claimed = 0;
    const claim = async () => { claimed += 1; return { ok: true as const, runs: [] }; };
    expect((await handleDispatch(req("s3cret"), { ...mk(), email: null, claim })).status).toBe(503);
    expect((await handleDispatch(req("s3cret"), { ...mk(), unsubscribeSecret: null, claim })).status).toBe(503);
    expect(claimed).toBe(0);
  });
  it("answers 500 when an email went out but could not be recorded, so the cron failure is visible", async () => {
    const d = harness([run(1)]);
    const res = await handleDispatch(req("s3cret"), { ...d.deps, secret: "s3cret", finish: async () => { throw new Error("db down"); } });
    expect(res.status).toBe(500);
    expect(((await res.json()) as { unrecorded: number }).unrecorded).toBe(1);
  });
  it("runs a batch with the right secret", async () => {
    const res = await handleDispatch(req("s3cret"), mk());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ claimed: 1, sent: 1, failed: 0, unrecorded: 0 });
  });
});
