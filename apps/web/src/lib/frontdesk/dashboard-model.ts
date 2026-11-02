/**
 * The Front Desk dashboard's display model (the read is public.fd_dashboard, admin only). Pure functions, no I/O. The rule it enforces: a number
 * that is not known is shown as not known, never as 0 (no finished conversation is "no share yet", not "0% resolved").
 */
type N = number | string | null | undefined;
type Counted = readonly { readonly topic: string; readonly count: number }[];

export interface DashMetrics {
  readonly conversations?: { readonly total?: N; readonly ai_resolved?: N; readonly handed_off?: N; readonly emergency?: N; readonly abandoned?: N; readonly unsettled?: N; readonly ai_resolved_pct?: N; readonly median_first_response_seconds?: N };
  readonly handoffs?: { readonly total?: N; readonly urgent?: N; readonly alerts_failed?: N; readonly median_reply_minutes?: N; readonly open_now?: N; readonly by_reason?: Readonly<Record<string, number>> };
  readonly topics?: Counted;
  readonly unanswered?: Counted;
  readonly leads?: { readonly total?: N };
  readonly funnel?: { readonly events?: Readonly<Record<string, number>>; readonly enquiry_to_account_pct?: N; readonly account_to_paid_pct?: N };
  readonly review?: { readonly pending?: N; readonly ok?: N; readonly wrong?: N; readonly unsafe?: N; readonly incidents_open?: N };
  readonly spend?: { readonly cost_usd?: N; readonly calls?: N; readonly daily_cap_usd?: N };
  readonly followups?: { readonly sent?: N; readonly held_by_dry_run?: N; readonly failed?: N };
  readonly switches?: { readonly assistant_enabled?: boolean | null; readonly followups_enabled?: boolean | null; readonly followups_dry_run?: boolean | null; readonly prelaunch_mode?: boolean | null };
}

export interface DashReport {
  readonly id: string; readonly week_start: string; readonly week_end: string | null; readonly status: "pending" | "sending" | "sent" | "failed";
  readonly sent_at: string | null; readonly recipient: string | null; readonly last_error: string | null; readonly attempts: number;
}
export interface DashIncident { readonly id: string; readonly opened_at: string; readonly opened_note: string; readonly conversation_id: string | null }
export interface Dashboard {
  readonly current: DashMetrics;
  readonly previous: DashMetrics;
  readonly spend_today_usd: N;
  readonly reports: readonly DashReport[];
  readonly incidents: readonly DashIncident[];
  readonly review_sample_percent: N;
}

export type Tone = "green" | "amber" | "red" | "grey";
export interface KpiTile { readonly label: string; readonly value: string; readonly sub: string | null; readonly tone: Tone }

export function num(v: N): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
const n0 = (v: N): number => num(v) ?? 0;

export const fmtPct = (v: N): string => (num(v) === null ? "Not yet" : `${num(v)}%`);
export const fmtSeconds = (v: N): string => (num(v) === null ? "None yet" : `${num(v)} s`);
export const fmtUsd = (v: N): string => `$${n0(v).toFixed(2)}`;
export const topicLabel = (t: string): string => {
  const s = t.replace(/_/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Other";
};
/** "last week 9" when there is something to compare with. */
const was = (prev: N, suffix = ""): string | null => (num(prev) === null ? null : `last week ${num(prev)}${suffix}`);

/** The headline tiles for the last 7 days against the 7 before. Tone says whether it needs you: green fine, amber look, red act. */
export function buildTiles(d: Dashboard): KpiTile[] {
  const c = d.current, p = d.previous;
  const median = num(c.conversations?.median_first_response_seconds);
  const incidents = n0(c.review?.incidents_open);
  const openHandoffs = n0(c.handoffs?.open_now);
  const pending = n0(c.review?.pending);
  const cap = num(c.spend?.daily_cap_usd);
  const today = num(d.spend_today_usd);
  return [
    { label: "Conversations (7 days)", value: String(n0(c.conversations?.total)), sub: was(p.conversations?.total), tone: "grey" },
    { label: "Finished without you", value: fmtPct(c.conversations?.ai_resolved_pct), sub: was(p.conversations?.ai_resolved_pct, "%"), tone: "grey" },
    { label: "Median first reply", value: fmtSeconds(median), sub: "target: under 60 s", tone: median === null ? "grey" : median < 60 ? "green" : "amber" },
    { label: "Handoffs waiting for you", value: String(openHandoffs), sub: `${n0(c.handoffs?.total)} this week, ${n0(c.handoffs?.urgent)} urgent`, tone: openHandoffs > 0 ? "amber" : "green" },
    { label: "Enquiries to accounts to paid", value: `${n0(c.leads?.total)} / ${n0(c.funnel?.events?.["account_created"])} / ${n0(c.funnel?.events?.["paid"])}`, sub: was(p.leads?.total, " enquiries"), tone: "grey" },
    { label: "Assistant spend (7 days)", value: fmtUsd(c.spend?.cost_usd), sub: today === null ? null : cap === null ? `${fmtUsd(today)} today` : `${fmtUsd(today)} today of ${fmtUsd(cap)} a day`, tone: today !== null && cap !== null && today >= cap ? "red" : "grey" },
    { label: "Conversations to review", value: String(pending), sub: `${n0(c.review?.ok)} fine, ${n0(c.review?.wrong)} wrong, ${n0(c.review?.unsafe)} unsafe this week`, tone: pending > 0 ? "amber" : "green" },
    { label: "Open safety incidents", value: String(incidents), sub: incidents > 0 ? "close each with the rule you tightened" : null, tone: incidents > 0 ? "red" : "green" },
  ];
}

export const REASON_LABEL: Readonly<Record<string, string>> = {
  visitor_asked: "Asked for a person", cannot_answer: "The assistant could not answer", ai_unavailable: "The assistant was unavailable",
  clinical_request: "Asked for medical advice", emergency: "Used emergency wording", complaint: "Made a complaint", form_fallback: "Left a message on the form",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "6 Mar 2026" from YYYY-MM-DD, without any locale or timezone dependence. */
export function fmtDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}
