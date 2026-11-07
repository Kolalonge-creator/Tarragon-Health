/**
 * Clinical Leadership Overview (CMO command centre, 2026-11-07).
 *
 * Pure helpers for the Chief Medical Officer's overview page: the reporting period, the "Requires executive attention" ranking,
 * and honest figures. Three rules run through every function here:
 *  - Unknown is not zero: a figure whose source failed is `null` and renders as "could not be loaded", never as 0.
 *  - A percentage always carries its numerator and denominator ("84%, 168 of 200").
 *  - A trend is only shown when the previous period is fully covered by data; otherwise there is no comparison to make.
 *
 * Nothing here invents a priority. Each tier comes from a governed field on the source record (alert level, incident severity,
 * safeguarding category) or from a fixed, stated rule (overdue against its SLA, unassigned).
 */
import { isOverdue, type DoctorWorklistRow, type WorklistSource } from "./doctor-worklist";

// ---------------------------------------------------------------------------
// Reporting period
// ---------------------------------------------------------------------------

export type LeadershipPeriod = "today" | "7d" | "30d" | "90d" | "ytd";

export const LEADERSHIP_PERIODS: readonly { key: LeadershipPeriod; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "ytd", label: "Year to date" },
];

export const DEFAULT_LEADERSHIP_PERIOD: LeadershipPeriod = "30d";

export function parseLeadershipPeriod(value: string | string[] | undefined): LeadershipPeriod {
  const v = Array.isArray(value) ? value[0] : value;
  return LEADERSHIP_PERIODS.some((p) => p.key === v) ? (v as LeadershipPeriod) : DEFAULT_LEADERSHIP_PERIOD;
}

export type PeriodBounds = {
  period: LeadershipPeriod;
  label: string;
  start: Date;
  end: Date;
  previousStart: Date;
  previousEnd: Date;
};

const DAY_MS = 86_400_000;
/** Africa/Lagos is UTC+1 all year (no daylight saving), so a Lagos calendar boundary is a fixed offset from UTC. */
const LAGOS_OFFSET_MS = 3_600_000;

function lagosMidnight(now: Date): Date {
  const local = new Date(now.getTime() + LAGOS_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - LAGOS_OFFSET_MS);
}

function lagosYearStart(year: number): Date {
  return new Date(Date.UTC(year, 0, 1) - LAGOS_OFFSET_MS);
}

/**
 * The selected period ends now. The previous period is the same length immediately before it, except today (compared with
 * yesterday up to the same time) and year to date (compared with 1 January to this date last year).
 */
export function leadershipPeriodBounds(period: LeadershipPeriod, now: Date): PeriodBounds {
  const label = LEADERSHIP_PERIODS.find((p) => p.key === period)?.label ?? period;
  const end = now;
  if (period === "ytd") {
    const year = new Date(now.getTime() + LAGOS_OFFSET_MS).getUTCFullYear();
    const start = lagosYearStart(year);
    const previousStart = lagosYearStart(year - 1);
    return { period, label, start, end, previousStart, previousEnd: new Date(previousStart.getTime() + (end.getTime() - start.getTime())) };
  }
  if (period === "today") {
    // Today so far against yesterday up to the same time of day, not the hours just before midnight.
    const start = lagosMidnight(now);
    return { period, label, start, end, previousStart: new Date(start.getTime() - DAY_MS), previousEnd: new Date(end.getTime() - DAY_MS) };
  }
  const start = new Date(now.getTime() - (period === "7d" ? 7 : period === "30d" ? 30 : 90) * DAY_MS);
  const span = end.getTime() - start.getTime();
  return { period, label, start, end, previousStart: new Date(start.getTime() - span), previousEnd: start };
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

export type LeadershipFigure = number | null;

/** "84%, 168 of 200". A zero denominator says so instead of dividing by zero; an unknown part makes the whole unknown. */
export function ratioText(
  numerator: LeadershipFigure,
  denominator: LeadershipFigure
): { pct: number | null; text: string; counts: string | null } {
  if (numerator === null || denominator === null) return { pct: null, text: "could not be loaded", counts: null };
  if (denominator === 0) return { pct: null, text: "none to measure yet", counts: null };
  const pct = Math.round((numerator / denominator) * 100);
  const counts = `${numerator.toLocaleString("en-NG")} of ${denominator.toLocaleString("en-NG")}`;
  return { pct, text: `${pct}%, ${counts}`, counts };
}

export type PeriodTrend = { direction: "up" | "down" | "flat"; text: string };

/**
 * Change against the previous period, or null when there is nothing honest to compare: either figure unknown, or the
 * previous period starts before the platform held any data (`comparable` false), so a rise would only show that we started.
 */
export function periodTrend(current: LeadershipFigure, previous: LeadershipFigure, comparable: boolean): PeriodTrend | null {
  if (!comparable || current === null || previous === null) return null;
  const diff = current - previous;
  if (diff === 0) return { direction: "flat", text: `Same as the previous period (${previous.toLocaleString("en-NG")})` };
  const word = diff > 0 ? "up" : "down";
  return {
    direction: diff > 0 ? "up" : "down",
    text: `${Math.abs(diff).toLocaleString("en-NG")} ${word} on the previous period (${previous.toLocaleString("en-NG")})`,
  };
}

/** True when the platform's earliest record is on or before the start of the previous period, so that period is fully covered. */
export function previousPeriodComparable(bounds: PeriodBounds, dataSince: string | null): boolean {
  if (!dataSince) return false;
  const t = Date.parse(dataSince);
  return !Number.isNaN(t) && t <= bounds.previousStart.getTime();
}

// ---------------------------------------------------------------------------
// Requires executive attention
// ---------------------------------------------------------------------------

/** Strongest first. Only "critical" gets the strongest warning treatment; ordinary overdue administrative work never does. */
export type AttentionTier = "critical" | "high" | "attention" | "routine";

export const ATTENTION_TIER_LABEL: Record<AttentionTier, string> = {
  critical: "Critical",
  high: "High priority",
  attention: "Requires attention",
  routine: "Routine",
};

const TIER_RANK: Record<AttentionTier, number> = { critical: 0, high: 1, attention: 2, routine: 3 };

export type ExecutiveAttentionItem = {
  key: string;
  tier: AttentionTier;
  /** What kind of record it is ("Escalation", "Clinical incident", ...). */
  kind: string;
  /** One line; never free-text clinical detail from a safeguarding record. */
  title: string;
  raisedAt: string | null;
  owner: string | null;
  status: string;
  nextAction: string;
  href: string;
};

export function rankExecutiveAttention(items: readonly ExecutiveAttentionItem[]): ExecutiveAttentionItem[] {
  const t = (iso: string | null) => (iso ? Date.parse(iso) || Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY);
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => TIER_RANK[a.item.tier] - TIER_RANK[b.item.tier] || t(a.item.raisedAt) - t(b.item.raisedAt) || a.index - b.index)
    .map((x) => x.item);
}

/** "45 minutes", "6 hours", "3 days". Null when the raised time is unknown. */
export function timeOutstanding(raisedAt: string | null, now: Date): string | null {
  if (!raisedAt) return null;
  const t = Date.parse(raisedAt);
  if (Number.isNaN(t)) return null;
  const mins = Math.max(0, Math.floor((now.getTime() - t) / 60_000));
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

const TEAM_SOURCES: readonly WorklistSource[] = ["escalation", "alert"];

/**
 * Team clinical work (escalations and clinical alerts) that needs the CMO: critical by governed level; overdue against its SLA
 * (high: a missed clinical SLA is a safety matter); unassigned (requires attention: routing failed). Everything else is the
 * owning doctor's to handle and stays off this panel. Patient number only, never the name: this is an executive summary.
 */
export function attentionFromWorklist(rows: readonly DoctorWorklistRow[], now: Date): ExecutiveAttentionItem[] {
  const out: ExecutiveAttentionItem[] = [];
  for (const row of rows) {
    if (!TEAM_SOURCES.includes(row.source)) continue;
    const overdue = isOverdue(row, now);
    const tier: AttentionTier | null =
      row.priority === "critical" ? "critical" : overdue ? "high" : row.unassigned ? "attention" : null;
    if (!tier) continue;
    const reason = row.priority === "critical" ? "Critical" : overdue ? "Past its response time" : "Not assigned to a doctor";
    // An escalation's issue is the doctor's free-text reason (clinical narrative), so it stays on the case page; an alert's issue
    // is its system-generated title ("Missing expected pulse readings"), which is safe to summarise.
    const what = row.source === "escalation" ? "clinical escalation" : row.issue;
    out.push({
      key: row.key,
      tier,
      kind: row.source === "escalation" ? "Clinical escalation" : "Clinical alert",
      title: `${reason}: ${what}${row.patientNumber ? ` (${row.patientNumber})` : ""}`,
      raisedAt: row.receivedAt,
      owner: row.unassigned ? null : row.assignedName,
      status: row.status,
      nextAction: row.unassigned ? "Assign a doctor" : overdue ? "Check with the assigned doctor" : row.nextAction,
      href: row.href,
    });
  }
  return out;
}

export type IncidentRow = {
  id: string;
  category: string;
  severity: string;
  status: string;
  reported_at: string;
  reviewer_name: string | null;
};

const INCIDENT_NEXT: Record<string, string> = {
  open: "Start the review",
  under_review: "Agree the corrective action",
  action_planned: "Confirm the action and close",
};

export function humanise(code: string): string {
  const s = code.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Open clinical incidents: tier from the reported severity (critical, high; medium needs attention; low and near miss routine). */
export function attentionFromIncidents(rows: readonly IncidentRow[]): ExecutiveAttentionItem[] {
  return rows
    .filter((r) => r.status !== "closed")
    .map((r) => ({
      key: `incident:${r.id}`,
      tier: (r.severity === "critical" ? "critical" : r.severity === "high" ? "high" : r.severity === "medium" ? "attention" : "routine") as AttentionTier,
      kind: "Clinical incident",
      title: `${humanise(r.severity)} severity: ${humanise(r.category)}`,
      raisedAt: r.reported_at,
      owner: r.reviewer_name,
      status: humanise(r.status),
      nextAction: INCIDENT_NEXT[r.status] ?? "Review",
      href: "/clinician/safety-incidents",
    }));
}

export type SafeguardingRow = { id: string; concern_category: string; status: string; reported_at: string; reviewer_name: string | null };

/** Open safeguarding concerns are always at least high priority; an immediate safety risk is critical. Category only, no detail. */
export function attentionFromSafeguarding(rows: readonly SafeguardingRow[]): ExecutiveAttentionItem[] {
  return rows
    .filter((r) => r.status !== "closed")
    .map((r) => ({
      key: `safeguarding:${r.id}`,
      tier: (r.concern_category === "immediate_safety_risk" ? "critical" : "high") as AttentionTier,
      kind: "Safeguarding",
      title: `Safeguarding concern: ${humanise(r.concern_category).toLowerCase()}`,
      raisedAt: r.reported_at,
      owner: r.reviewer_name,
      status: humanise(r.status),
      nextAction: r.status === "open" ? "Start the review" : "Record the outcome and close",
      href: "/clinician/safeguarding",
    }));
}

export type ComplaintRow = { id: string; category: string; status: string; created_at: string; assignee_name: string | null };

/** A complaint older than this with no response yet needs the CMO's attention. */
export const COMPLAINT_ATTENTION_DAYS = 14;

/**
 * Complaints are governance work, not a safety signal, so they never go above "requires attention". A resolved complaint
 * waiting for governance review, or one with no response after 14 days, requires attention; the rest are routine.
 */
export function attentionFromComplaints(rows: readonly ComplaintRow[], now: Date): ExecutiveAttentionItem[] {
  const RESPONDED = new Set(["response_sent", "resolved", "governance_review"]);
  return rows
    .filter((r) => r.status !== "governance_review")
    .map((r) => {
      const age = (now.getTime() - Date.parse(r.created_at)) / DAY_MS;
      const awaitingGovernance = r.status === "resolved";
      const slow = !RESPONDED.has(r.status) && age > COMPLAINT_ATTENTION_DAYS;
      return {
        key: `complaint:${r.id}`,
        tier: (awaitingGovernance || slow ? "attention" : "routine") as AttentionTier,
        kind: "Complaint",
        title: `${humanise(r.category)} complaint${slow ? `, no response after ${COMPLAINT_ATTENTION_DAYS} days` : ""}`,
        raisedAt: r.created_at,
        owner: r.assignee_name,
        status: humanise(r.status),
        nextAction: awaitingGovernance ? "Complete the governance review" : r.assignee_name ? "Check progress with the owner" : "Assign an owner",
        href: `/clinician/complaints/${r.id}`,
      };
    });
}

/** One line for the sign-off hub, only when something is waiting. */
export function attentionFromSignoffs(waiting: number): ExecutiveAttentionItem[] {
  if (waiting <= 0) return [];
  return [
    {
      key: "signoffs",
      tier: "attention",
      kind: "Clinical governance",
      title: `${waiting} item${waiting === 1 ? "" : "s"} waiting for your signature`,
      raisedAt: null,
      owner: "You",
      status: "Waiting",
      nextAction: "Open the sign-off hub",
      href: "/clinician/clinical-signoff",
    },
  ];
}

export function countByTier(items: readonly ExecutiveAttentionItem[]): Record<AttentionTier, number> {
  const out: Record<AttentionTier, number> = { critical: 0, high: 0, attention: 0, routine: 0 };
  for (const i of items) out[i.tier] += 1;
  return out;
}
