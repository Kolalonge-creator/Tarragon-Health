import type { EmailProvider } from "../integrations/email.ts";
import type { DeliveryResult } from "./alerts.ts";
import { escapeHtml } from "./followup-render.ts";

type N = number | string | null | undefined;
type Counted = readonly { readonly topic: string; readonly count: number }[];

/** The shape of private.fd_week_metrics (migration fd_m5). Every field is optional: an older or partial row must still render. */
export interface WeekMetrics {
  readonly conversations?: {
    readonly total?: N; readonly visitor_messages?: N; readonly ai_resolved?: N; readonly handed_off?: N; readonly emergency?: N;
    readonly abandoned?: N; readonly unsettled?: N; readonly ai_resolved_pct?: N; readonly median_first_response_seconds?: N;
  };
  readonly handoffs?: {
    readonly total?: N; readonly urgent?: N; readonly replied?: N; readonly alerts_failed?: N; readonly median_reply_minutes?: N; readonly open_now?: N;
    readonly by_reason?: Readonly<Record<string, number>>;
  };
  readonly topics?: Counted;
  readonly unanswered?: Counted;
  readonly leads?: { readonly total?: N; readonly by_source?: Readonly<Record<string, number>> };
  readonly funnel?: { readonly events?: Readonly<Record<string, number>>; readonly enquiry_to_account_pct?: N; readonly account_to_paid_pct?: N };
  readonly review?: { readonly pending?: N; readonly ok?: N; readonly wrong?: N; readonly unsafe?: N; readonly incidents_open?: N; readonly incidents_opened?: N };
  readonly spend?: { readonly cost_usd?: N; readonly calls?: N; readonly daily_cap_usd?: N };
  readonly followups?: { readonly sent?: N; readonly held_by_dry_run?: N; readonly failed?: N };
  readonly switches?: {
    readonly assistant_enabled?: boolean | null; readonly followups_enabled?: boolean | null;
    readonly followups_dry_run?: boolean | null; readonly prelaunch_mode?: boolean | null;
  };
}

/** One weekly report the database says must be sent (service_fd_claim_reports). */
export interface ClaimedReport {
  readonly report_id: string;
  readonly week_start: string; // YYYY-MM-DD, the first London day reported
  readonly week_end: string | null; // YYYY-MM-DD, the Friday the report is made on (not part of the week)
  readonly metrics: WeekMetrics;
  readonly prev_metrics: WeekMetrics | null;
  readonly attempts: number;
}

/** A number from jsonb, or null when it is missing or not a finite number. Never NaN, never a silent 0. */
function num(v: N): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
const n0 = (v: N): number => num(v) ?? 0;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "6 Mar 2026" from YYYY-MM-DD, without any locale or timezone dependence. */
export function fmtDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}
/** The last day of the week reported: the day before the Friday the report is made on. */
function lastDay(r: ClaimedReport): string {
  if (!r.week_end) return r.week_start;
  const d = new Date(`${r.week_end}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function topicLabel(t: string): string {
  const s = t.replace(/_/g, " ").trim();
  return s.length === 0 ? "Other" : s.charAt(0).toUpperCase() + s.slice(1);
}

const REASON: Readonly<Record<string, string>> = {
  visitor_asked: "asked for a person", cannot_answer: "the assistant could not answer", ai_unavailable: "the assistant was unavailable",
  clinical_request: "asked for medical advice", emergency: "used emergency wording", complaint: "made a complaint", form_fallback: "left a message on the form",
};
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const usd = (v: number): string => `$${v.toFixed(2)}`;
/** " (last week 3)" when there is a week to compare with, else nothing. */
const vs = (cur: number | null, prev: number | null, unit = ""): string => (prev === null || cur === null ? "" : ` (last week ${prev}${unit})`);

export interface Narrative {
  readonly headlines: readonly string[];
  readonly actions: readonly string[];
}

/**
 * The words of the report, from rules. Plain facts first, then what needs the founder, most important first. It never repeats what a visitor
 * wrote: topics are names, counts are counts. (An AI-written narrative is a later, separately governed step; this is always produced.)
 */
export function buildNarrative(m: WeekMetrics, prev: WeekMetrics | null): Narrative {
  const c = m.conversations ?? {};
  const h = m.handoffs ?? {};
  const rv = m.review ?? {};
  const total = n0(c.total);
  const headlines: string[] = [];
  const actions: string[] = [];

  if (total === 0) {
    headlines.push("No one used the website chat this week.");
  } else {
    const pct = num(c.ai_resolved_pct);
    headlines.push(
      `${plural(total, "conversation")}.` +
        (pct === null ? " None has finished yet, so there is no share to report." : ` ${pct}% finished without needing you${vs(pct, num(prev?.conversations?.ai_resolved_pct), "%")}.`),
    );
    const median = num(c.median_first_response_seconds);
    if (median !== null) headlines.push(`Median time to a first reply: ${median} seconds${median < 60 ? ", inside the one-minute target" : ", slower than the one-minute target"}.`);
    if (n0(c.emergency) > 0) headlines.push(`${plural(n0(c.emergency), "visitor")} used emergency wording and ${n0(c.emergency) === 1 ? "was" : "were"} told to go to the nearest hospital.`);
  }
  if (n0(h.total) > 0) {
    const wait = num(h.median_reply_minutes);
    headlines.push(`${plural(n0(h.total), "handoff")} (${n0(h.urgent)} urgent).` + (wait === null ? " None has been replied to yet." : ` Median wait for your reply: ${wait} minutes.`));
  }
  const leads = n0(m.leads?.total);
  const ev = m.funnel?.events ?? {};
  if (leads > 0 || n0(ev["account_created"]) > 0 || n0(ev["paid"]) > 0) {
    headlines.push(`${plural(leads, "new enquiry", "new enquiries")}, ${plural(n0(ev["account_created"]), "account")} started, ${n0(ev["paid"])} paid${vs(leads, num(prev?.leads?.total), " enquiries")}.`);
  }
  const topics = m.topics ?? [];
  if (topics.length > 0) headlines.push(`Most asked about: ${topics.slice(0, 3).map((t) => `${topicLabel(t.topic)} (${t.count})`).join(", ")}.`);
  const cost = num(m.spend?.cost_usd);
  if (cost !== null && cost > 0) {
    const cap = num(m.spend?.daily_cap_usd);
    headlines.push(`Assistant spend: ${usd(cost)} for the week${cap !== null ? `, against a daily cap of ${usd(cap)}` : ""}.`);
  }
  if (n0(rv.ok) + n0(rv.wrong) + n0(rv.unsafe) > 0) {
    headlines.push(`Reviewed this week: ${n0(rv.ok)} fine, ${n0(rv.wrong)} wrong, ${n0(rv.unsafe)} unsafe.`);
  }

  // Actions, most important first.
  if (n0(rv.incidents_open) > 0) actions.push(`Close ${plural(n0(rv.incidents_open), "open safety incident")}: record which rule or wording you tightened.`);
  if (n0(rv.unsafe) > 0 && n0(rv.incidents_open) === 0) actions.push("An answer was marked unsafe this week. Check that the rules were tightened as the incident says.");
  if (n0(c.emergency) > 0) actions.push("Read the emergency conversations in the inbox and confirm each visitor was reached or reassured.");
  if (n0(h.open_now) > 0) actions.push(`Reply to ${plural(n0(h.open_now), "open handoff")} in the inbox.`);
  if (n0(h.alerts_failed) > 0) actions.push(`${plural(n0(h.alerts_failed), "alert email")} failed to send. Check the email sender and FOUNDER_ALERT_EMAIL.`);
  if (n0(rv.pending) > 0) actions.push(`Review ${plural(n0(rv.pending), "conversation")} waiting in the review queue.`);
  const top = (m.unanswered ?? [])[0];
  if (top) actions.push(`Add approved wording for "${topicLabel(top.topic)}": ${plural(top.count, "question")} the assistant could not answer.`);
  if (m.switches?.assistant_enabled === false) actions.push("The assistant is switched OFF, so visitors see the contact form. Turn it back on when you are ready.");
  if (m.switches?.followups_dry_run === true && n0(m.followups?.held_by_dry_run) > 0) {
    actions.push(`${plural(n0(m.followups?.held_by_dry_run), "follow-up email")} ${n0(m.followups?.held_by_dry_run) === 1 ? "is" : "are"} held back by dry-run. When you are happy with the wording, go live from the follow-ups page.`);
  }
  if (n0(m.followups?.failed) > 0) actions.push(`${plural(n0(m.followups?.failed), "follow-up email")} failed to send. Open the follow-ups page.`);
  if (total === 0 && m.switches?.assistant_enabled !== false) actions.push("Check that the chat button shows on the website.");
  if (actions.length === 0) actions.push("Nothing needs you this week.");
  return { headlines, actions };
}

export interface RenderedReport {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  /** The narrative stored with the report (headlines then actions), plain text. */
  readonly narrative: string;
}

export function renderWeeklyReport(r: ClaimedReport, appBaseUrl: string): RenderedReport {
  const m = r.metrics ?? {};
  const nar = buildNarrative(m, r.prev_metrics);
  const range = `${fmtDay(r.week_start)} to ${fmtDay(lastDay(r))}`;
  const link = `${appBaseUrl}/admin/front-desk`;
  const c = m.conversations ?? {};
  const h = m.handoffs ?? {};
  const byReason = Object.entries(h.by_reason ?? {}).map(([k, v]) => `${REASON[k] ?? k}: ${v}`);
  const facts: [string, string][] = [
    ["Conversations", String(n0(c.total))],
    ["Finished without you", num(c.ai_resolved_pct) === null ? "none finished yet" : `${num(c.ai_resolved_pct)}%`],
    ["Median first reply", num(c.median_first_response_seconds) === null ? "none" : `${num(c.median_first_response_seconds)} seconds`],
    ["Handoffs", `${n0(h.total)} (${n0(h.urgent)} urgent)`],
    ["New enquiries", String(n0(m.leads?.total))],
    ["Accounts started", String(n0(m.funnel?.events?.["account_created"]))],
    ["Paid", String(n0(m.funnel?.events?.["paid"]))],
    ["Assistant spend", usd(n0(m.spend?.cost_usd))],
    ["Follow-up emails sent", String(n0(m.followups?.sent))],
    ["Waiting for review", String(n0(m.review?.pending))],
  ];
  const lines = [
    `Front Desk, ${range}`,
    "",
    ...nar.headlines,
    "",
    "What needs you:",
    ...nar.actions.map((a) => `- ${a}`),
    "",
    "The numbers:",
    ...facts.map(([k, v]) => `${k}: ${v}`),
    ...(byReason.length > 0 ? ["", `Why people were handed to you: ${byReason.join("; ")}`] : []),
    ...((m.unanswered ?? []).length > 0 ? ["", `Questions the assistant could not answer: ${(m.unanswered ?? []).map((t) => `${topicLabel(t.topic)} (${t.count})`).join(", ")}`] : []),
    "",
    `Open the dashboard: ${link}`,
  ];
  const html =
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;max-width:600px">` +
    `<h2 style="margin:0 0 12px;font-size:18px">Front Desk, ${escapeHtml(range)}</h2>` +
    nar.headlines.map((l) => `<p style="margin:0 0 8px">${escapeHtml(l)}</p>`).join("") +
    `<p style="margin:16px 0 6px"><strong>What needs you</strong></p><ul style="margin:0 0 12px;padding-left:20px">` +
    nar.actions.map((a) => `<li>${escapeHtml(a)}</li>`).join("") +
    `</ul><p style="margin:16px 0 6px"><strong>The numbers</strong></p>` +
    `<table style="border-collapse:collapse;width:100%">` +
    facts.map(([k, v]) => `<tr><td style="padding:3px 0;color:#5b6b68">${escapeHtml(k)}</td><td style="padding:3px 0;text-align:right"><strong>${escapeHtml(v)}</strong></td></tr>`).join("") +
    `</table>` +
    (byReason.length > 0 ? `<p style="margin:12px 0 0;font-size:13px;color:#5b6b68">Why people were handed to you: ${escapeHtml(byReason.join("; "))}</p>` : "") +
    `<p style="margin:16px 0 0"><a href="${escapeHtml(link)}">Open the dashboard</a></p></div>`;
  return {
    subject: `Front Desk weekly report: ${range}`,
    text: lines.join("\n"),
    html,
    narrative: [...nar.headlines, "", "What needs you:", ...nar.actions.map((a) => `- ${a}`)].join("\n"),
  };
}

export interface ReportDeps {
  readonly email: EmailProvider;
  readonly to: string;
  readonly appBaseUrl: string;
  readonly claim: (limit: number) => Promise<{ ok: true; reports: readonly ClaimedReport[] } | { ok: false; error: string }>;
  readonly finish: (reportId: string, ok: boolean, narrative: string | null, recipient: string | null, error: string | null) => Promise<void>;
}

/** Sends each claimed weekly report to the founder. Never throws. One report per week: the idempotency key is the week. */
export async function deliverReports(deps: ReportDeps): Promise<DeliveryResult | { error: string }> {
  const claimed = await deps.claim(1);
  if (!claimed.ok) return { error: claimed.error };
  let sent = 0;
  let failed = 0;
  let unrecorded = 0;
  for (const r of claimed.reports) {
    let delivered = false;
    try {
      const mail = renderWeeklyReport(r, deps.appBaseUrl);
      const res = await deps.email.send({
        to: deps.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        audience: "staff",
        idempotencyKey: `fd-weekly-report-${r.week_start}`,
        tags: { source: "front_desk", kind: "weekly_report" },
      });
      if (res.ok) {
        delivered = true;
        await deps.finish(r.report_id, true, mail.narrative, deps.to, null);
        sent += 1;
      } else {
        await deps.finish(r.report_id, false, null, null, `${res.error.code}: ${res.error.message}`);
        failed += 1;
      }
    } catch (e) {
      if (delivered) unrecorded += 1;
      else {
        await deps.finish(r.report_id, false, null, null, e instanceof Error ? e.message : "unknown").catch(() => undefined);
        failed += 1;
      }
    }
  }
  return { claimed: claimed.reports.length, sent, failed, unrecorded };
}
