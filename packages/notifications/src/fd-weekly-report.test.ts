/**
 * Front Desk M5: the weekly report email (F15). When a report is made, what it contains and how often are proved in
 * packages/db/tests/fd_m5_reporting_and_review.sql; this proves the words and the delivery loop: the right facts, the actions most important
 * first, nothing a visitor typed, safe HTML, one email per week, and a failure that is recorded rather than lost.
 */
import "./support/deno.ts";
import { describe, expect, it } from "@jest/globals";
import { createMockEmail } from "../../../supabase/functions/_shared/integrations/email-mock.ts";
import { buildNarrative, deliverReports, fmtDay, renderWeeklyReport, topicLabel, type ClaimedReport, type WeekMetrics } from "../../../supabase/functions/_shared/frontdesk/index.ts";
import { handleDispatch } from "../../../supabase/functions/fd-followup-dispatcher/handler.ts";

const APP = "https://app.tarragonhealth.ng";

const busy: WeekMetrics = {
  conversations: { total: 12, visitor_messages: 40, ai_resolved: 8, handed_off: 3, emergency: 1, abandoned: 0, unsettled: 0, ai_resolved_pct: 66.7, median_first_response_seconds: 4.2 },
  handoffs: { total: 3, urgent: 1, replied: 2, alerts_failed: 0, median_reply_minutes: 22, open_now: 1, by_reason: { cannot_answer: 2, emergency: 1 } },
  topics: [{ topic: "pricing", count: 5 }, { topic: "how_it_works", count: 3 }, { topic: "launch", count: 2 }, { topic: "privacy", count: 1 }],
  unanswered: [{ topic: "employer_plans", count: 2 }],
  leads: { total: 6, by_source: { chat: 2, website_form: 4 } },
  funnel: { events: { account_created: 3, paid: 1 }, enquiry_to_account_pct: 50, account_to_paid_pct: 33.3 },
  review: { pending: 4, ok: 5, wrong: 1, unsafe: 0, incidents_open: 0, incidents_opened: 0 },
  spend: { cost_usd: 1.234, calls: 80, daily_cap_usd: 5 },
  followups: { sent: 0, held_by_dry_run: 7, failed: 0 },
  switches: { assistant_enabled: true, followups_enabled: true, followups_dry_run: true, prelaunch_mode: true },
};
const report = (o: Partial<ClaimedReport> = {}): ClaimedReport => ({ report_id: "r1", week_start: "2026-03-06", week_end: "2026-03-13", metrics: busy, prev_metrics: null, attempts: 1, ...o });

describe("dates and labels", () => {
  it("formats a day without any locale or timezone", () => {
    expect(fmtDay("2026-03-06")).toBe("6 Mar 2026");
    expect(fmtDay("2026-12-31")).toBe("31 Dec 2026");
    expect(fmtDay("not a date")).toBe("not a date");
  });
  it("turns a topic key into words", () => {
    expect(topicLabel("how_it_works")).toBe("How it works");
    expect(topicLabel("")).toBe("Other");
  });
});

describe("buildNarrative", () => {
  it("states the share, the speed against the one-minute target and what was asked about", () => {
    const n = buildNarrative(busy, null);
    const all = n.headlines.join("\n");
    expect(all).toContain("12 conversations.");
    expect(all).toContain("66.7% finished without needing you.");
    expect(all).toContain("Median time to a first reply: 4.2 seconds, inside the one-minute target.");
    expect(all).toContain("Most asked about: Pricing (5), How it works (3), Launch (2).");
    expect(all).toContain("1 visitor used emergency wording and was told to go to the nearest hospital.");
  });
  it("compares with the week before when there is one, and says nothing when there is not", () => {
    const prev: WeekMetrics = { conversations: { total: 9, ai_resolved_pct: 55 }, leads: { total: 2 } };
    expect(buildNarrative(busy, prev).headlines.join("\n")).toContain("66.7% finished without needing you (last week 55%).");
    expect(buildNarrative(busy, null).headlines.join("\n")).not.toContain("last week");
  });
  it("says a slow first reply is slow", () => {
    const slow = { ...busy, conversations: { ...busy.conversations, median_first_response_seconds: 95 } };
    expect(buildNarrative(slow, null).headlines.join("\n")).toContain("slower than the one-minute target");
  });
  it("never reports a share when no conversation has finished (null is not 0%)", () => {
    const m: WeekMetrics = { conversations: { total: 3, ai_resolved_pct: null } };
    const all = buildNarrative(m, null).headlines.join("\n");
    expect(all).toContain("None has finished yet");
    expect(all).not.toContain("0%");
  });
  it("puts safety first in the actions, then people waiting, then wording, then switches", () => {
    const m: WeekMetrics = {
      ...busy,
      review: { pending: 4, ok: 0, wrong: 0, unsafe: 1, incidents_open: 2, incidents_opened: 1 },
      handoffs: { ...busy.handoffs, alerts_failed: 1, open_now: 3 },
      switches: { ...busy.switches, assistant_enabled: false },
    };
    const a = buildNarrative(m, null).actions;
    expect(a[0]).toBe("Close 2 open safety incidents: record which rule or wording you tightened.");
    const order = ["Read the emergency", "Reply to 3 open handoffs", "failed to send. Check the email sender", "Review 4 conversations", 'Add approved wording for "Employer plans"', "switched OFF", "held back by dry-run"];
    const at = order.map((frag) => a.findIndex((x) => x.includes(frag)));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
  });
  it("tells a quiet week to check the button, and a clear week it is clear", () => {
    const quiet = buildNarrative({ conversations: { total: 0 }, switches: { assistant_enabled: true } }, null);
    expect(quiet.headlines[0]).toBe("No one used the website chat this week.");
    expect(quiet.actions).toContain("Check that the chat button shows on the website.");
    const clear = buildNarrative({ conversations: { total: 2, ai_resolved_pct: 100, median_first_response_seconds: 3 }, switches: { assistant_enabled: true } }, null);
    expect(clear.actions).toEqual(["Nothing needs you this week."]);
  });
  it("copes with an empty or partial metrics object", () => {
    expect(() => buildNarrative({}, null)).not.toThrow();
    expect(buildNarrative({}, null).headlines[0]).toBe("No one used the website chat this week.");
  });
  it("ignores values that are not numbers instead of printing NaN", () => {
    const m = { conversations: { total: "x", median_first_response_seconds: "abc" } } as unknown as WeekMetrics;
    const all = buildNarrative(m, null).headlines.join("\n");
    expect(all).not.toContain("NaN");
  });
});

describe("renderWeeklyReport", () => {
  it("names the week reported (the day before the Friday it is made on) and links the dashboard", () => {
    const m = renderWeeklyReport(report(), APP);
    expect(m.subject).toBe("Front Desk weekly report: 6 Mar 2026 to 12 Mar 2026");
    expect(m.text).toContain(`Open the dashboard: ${APP}/admin/front-desk`);
    expect(m.html).toContain(`${APP}/admin/front-desk`);
  });
  it("shows the numbers a founder checks first", () => {
    const m = renderWeeklyReport(report(), APP);
    for (const line of ["Conversations: 12", "Finished without you: 66.7%", "Median first reply: 4.2 seconds", "Handoffs: 3 (1 urgent)", "New enquiries: 6", "Accounts started: 3", "Paid: 1", "Assistant spend: $1.23", "Waiting for review: 4"]) {
      expect(m.text).toContain(line);
    }
    expect(m.text).toContain("the assistant could not answer: 2");
    expect(m.text).toContain("Questions the assistant could not answer: Employer plans (2)");
  });
  it("carries no visitor words: topics and counts only", () => {
    const m = renderWeeklyReport(report(), APP);
    expect(`${m.subject}${m.text}${m.html}${m.narrative}`).not.toMatch(/chest|symptom|my name|@example/i);
  });
  it("escapes markup that reached a topic name", () => {
    const m = renderWeeklyReport(report({ metrics: { ...busy, unanswered: [{ topic: "<script>alert(1)</script>", count: 1 }] } }), APP);
    expect(m.html).not.toContain("<script>");
  });
  it("stores a plain-text narrative (headlines then actions) with the report", () => {
    const m = renderWeeklyReport(report(), APP);
    expect(m.narrative).toContain("12 conversations.");
    expect(m.narrative).toContain("What needs you:");
    expect(m.narrative.startsWith("<")).toBe(false);
  });
  it("renders a report with no end date (an older row) without throwing", () => {
    expect(renderWeeklyReport(report({ week_end: null, metrics: {} }), APP).subject).toBe("Front Desk weekly report: 6 Mar 2026 to 6 Mar 2026");
  });
});

describe("deliverReports", () => {
  const mk = (reports: ClaimedReport[]) => {
    const mock = createMockEmail();
    const finished: { id: string; ok: boolean; narrative: string | null; to: string | null; err: string | null }[] = [];
    return {
      mock, finished,
      deps: {
        email: mock, to: "founder@example.invalid", appBaseUrl: APP,
        claim: async () => ({ ok: true as const, reports }),
        finish: async (id: string, ok: boolean, narrative: string | null, to: string | null, err: string | null) => void finished.push({ id, ok, narrative, to, err }),
      },
    };
  };
  it("sends the report to the founder as staff mail, once per week, and records the narrative and recipient", async () => {
    const h = mk([report()]);
    expect(await deliverReports(h.deps)).toEqual({ claimed: 1, sent: 1, failed: 0, unrecorded: 0 });
    expect(h.mock.outbox[0]).toMatchObject({ to: "founder@example.invalid", audience: "staff", idempotencyKey: "fd-weekly-report-2026-03-06" });
    expect(h.finished[0]).toMatchObject({ id: "r1", ok: true, to: "founder@example.invalid" });
    expect(h.finished[0]?.narrative).toContain("12 conversations.");
  });
  it("records a provider failure with its reason and no narrative, so it is retried", async () => {
    const h = mk([report()]);
    h.mock.failNextCall();
    expect(await deliverReports(h.deps)).toEqual({ claimed: 1, sent: 0, failed: 1, unrecorded: 0 });
    expect(h.finished[0]).toMatchObject({ ok: false, narrative: null, to: null });
    expect(h.finished[0]?.err).toBeTruthy();
  });
  it("counts a delivered-but-unrecorded report and does not call it a failure (so it is not sent twice by us)", async () => {
    const h = mk([report()]);
    const oks: boolean[] = [];
    expect(await deliverReports({ ...h.deps, finish: async (_i, ok) => { oks.push(ok); throw new Error("db down"); } })).toEqual({ claimed: 1, sent: 0, failed: 0, unrecorded: 1 });
    expect(oks).toEqual([true]);
  });
  it("returns the claim error and sends nothing", async () => {
    const h = mk([]);
    expect(await deliverReports({ ...h.deps, claim: async () => ({ ok: false as const, error: "boom" }) })).toEqual({ error: "boom" });
    expect(h.mock.outbox).toHaveLength(0);
  });
  it("sends nothing when no report is waiting", async () => {
    const h = mk([]);
    expect(await deliverReports(h.deps)).toEqual({ claimed: 0, sent: 0, failed: 0, unrecorded: 0 });
  });
});

describe("handleDispatch with the weekly report", () => {
  const req = () => new Request("https://x.invalid/fd", { method: "POST", headers: { "x-fd-followup-secret": "s3cret" } });
  const base = (o: Record<string, unknown> = {}) => {
    const mock = createMockEmail();
    return {
      mock,
      deps: {
        secret: "s3cret", unsubscribeSecret: null as string | null, email: mock, appBaseUrl: APP, siteUrl: "https://tarragonhealth.ng",
        claim: async () => ({ ok: true as const, runs: [] }), finish: async () => undefined,
        founderEmail: "founder@example.invalid" as string | null,
        reports: { claim: async () => ({ ok: true as const, reports: [report()] }), finish: async () => undefined },
        ...o,
      },
    };
  };
  it("sends the weekly report even when the unsubscribe secret is missing (it needs only the founder's address)", async () => {
    const b = base();
    const res = await handleDispatch(req(), b.deps);
    expect(res.status).toBe(200);
    expect(b.mock.outbox).toHaveLength(1);
    expect(b.mock.outbox[0]?.subject).toMatch(/^Front Desk weekly report/);
    expect(((await res.json()) as { reports: { sent: number } }).reports.sent).toBe(1);
  });
  it("claims nothing and says why when the founder's address is missing", async () => {
    let claimed = 0;
    const b = base({ founderEmail: null, reports: { claim: async () => { claimed += 1; return { ok: true as const, reports: [report()] }; }, finish: async () => undefined } });
    const res = await handleDispatch(req(), b.deps);
    expect(claimed).toBe(0);
    expect(b.mock.outbox).toHaveLength(0);
    expect(((await res.json()) as { reports: { skipped: string } }).reports.skipped).toBe("founder_alert_email_missing");
  });
  it("answers 500 when the report queue cannot be read, so a failed cron call is visible", async () => {
    const b = base({ reports: { claim: async () => ({ ok: false as const, error: "db down" }), finish: async () => undefined } });
    expect((await handleDispatch(req(), b.deps)).status).toBe(500);
  });
});
