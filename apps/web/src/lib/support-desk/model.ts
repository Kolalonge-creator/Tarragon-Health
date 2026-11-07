/**
 * Support desk (SUP-1): the pure model behind /clinician/support-desk. Rows come from public.support_work_items, one view
 * over the existing support stores; this module only labels, filters and sorts them. No data access here.
 */
import type { Tables } from "@tarragon/shared";

export type WorkItem = Tables<"support_work_items">;

export type WorkSource = "support_ticket" | "help_request" | "care_thread" | "complaint";
export type StatusGroup = "new" | "in_progress" | "awaiting_customer" | "awaiting_internal" | "escalated" | "resolved" | "closed";
export type SlaState = "breached" | "at_risk" | "on_track" | "paused" | "clinical" | "met" | "none";
export type Priority = "urgent" | "high" | "normal" | "low";

export const SOURCE_LABEL: Record<WorkSource, string> = {
  support_ticket: "Technical ticket",
  help_request: "Help request",
  care_thread: "Support message",
  complaint: "Complaint",
};

export const STATUS_LABEL: Record<StatusGroup, string> = {
  new: "New",
  in_progress: "In progress",
  awaiting_customer: "Waiting on customer",
  awaiting_internal: "With another team",
  escalated: "Escalated",
  resolved: "Resolved",
  closed: "Closed",
};

export const PRIORITY_LABEL: Record<Priority, string> = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };

export const SLA_LABEL: Record<SlaState, string> = {
  breached: "Past target",
  at_risk: "Due soon",
  on_track: "On track",
  paused: "Paused",
  clinical: "Clinical route",
  met: "Done",
  none: "No target",
};

export const CATEGORY_LABEL: Record<string, string> = {
  technical: "Technical",
  payments: "Payments",
  appointments: "Appointments",
  laboratory: "Laboratory",
  pharmacy: "Pharmacy",
  insurance: "Insurance",
  referral: "Referral",
  complaint: "Complaint",
  general: "General",
  medication: "Medicines",
  clinical: "Clinical",
  other: "Other",
};

export const HANDOFF_DESTINATION_LABEL: Record<string, string> = {
  finance: "Finance",
  technical_ops: "Technical Operations",
  provider_ops: "Provider Operations",
  membership_ops: "Membership Operations",
  senior_management: "Senior management",
};

export const QUEUE_TABS = [
  { key: "mine", label: "My open" },
  { key: "unassigned", label: "Unassigned" },
  { key: "open", label: "All open" },
  { key: "new", label: "New" },
  { key: "in_progress", label: "In progress" },
  { key: "awaiting_customer", label: "Waiting on customer" },
  { key: "awaiting_internal", label: "With another team" },
  { key: "escalated", label: "Escalated" },
  { key: "resolved", label: "Resolved" },
  { key: "closed", label: "Closed" },
] as const;

export type QueueTab = (typeof QUEUE_TABS)[number]["key"];

export function isQueueTab(value: string | undefined): value is QueueTab {
  return QUEUE_TABS.some((t) => t.key === value);
}

const isOpen = (i: WorkItem) => i.status_group !== "resolved" && i.status_group !== "closed";

export type QueueFilters = {
  source?: WorkSource | "all";
  priority?: Priority | "all";
  sla?: SlaState | "all";
  search?: string;
  includeTest?: boolean;
};

/** Items for a tab, after the filters. `me` is the signed-in staff member's profile id. */
export function filterQueue(items: readonly WorkItem[], tab: QueueTab, me: string, f: QueueFilters = {}): WorkItem[] {
  const q = (f.search ?? "").trim().toLowerCase();
  return items.filter((i) => {
    if (!f.includeTest && i.is_test) return false;
    switch (tab) {
      case "mine":
        if (!(isOpen(i) && i.assigned_to === me)) return false;
        break;
      case "unassigned":
        if (!(isOpen(i) && !i.assigned_to)) return false;
        break;
      case "open":
        if (!isOpen(i)) return false;
        break;
      default:
        if (i.status_group !== tab) return false;
    }
    if (f.source && f.source !== "all" && i.source !== f.source) return false;
    if (f.priority && f.priority !== "all" && i.priority !== f.priority) return false;
    if (f.sla && f.sla !== "all" && i.sla_state !== f.sla) return false;
    if (q) {
      const hay = `${i.reference ?? ""} ${i.subject ?? ""} ${i.customer_name ?? ""} ${i.category ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

const SLA_RANK: Record<string, number> = { breached: 0, at_risk: 1, on_track: 2, none: 3, paused: 4, clinical: 5, met: 6 };
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/** Most urgent first: past target, then due soon; within that, priority, then the earliest due time, then the oldest. */
export function sortByUrgency(items: readonly WorkItem[]): WorkItem[] {
  return [...items].sort((a, b) => {
    const s = (SLA_RANK[a.sla_state ?? "none"] ?? 9) - (SLA_RANK[b.sla_state ?? "none"] ?? 9);
    if (s !== 0) return s;
    const p = (PRIORITY_RANK[a.priority ?? "normal"] ?? 9) - (PRIORITY_RANK[b.priority ?? "normal"] ?? 9);
    if (p !== 0) return p;
    const da = a.next_due_at ? Date.parse(a.next_due_at) : Number.POSITIVE_INFINITY;
    const db = b.next_due_at ? Date.parse(b.next_due_at) : Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return Date.parse(a.received_at ?? "") - Date.parse(b.received_at ?? "");
  });
}

export type AttentionReason =
  | "past_target"
  | "due_soon"
  | "unassigned_high"
  | "unassigned"
  | "complaint_new"
  | "with_other_team";

/** What needs a person now, with the reason and the next action, most urgent first. Clinical items are not listed: they
 * run on the clinical route and are shown with that label in the queue instead. */
export function attentionItems(items: readonly WorkItem[], limit = 12): { item: WorkItem; reason: AttentionReason; next: string }[] {
  const out: { item: WorkItem; reason: AttentionReason; next: string }[] = [];
  for (const i of sortByUrgency(items)) {
    if (i.is_test || !isOpen(i) || i.is_clinical) continue;
    if (i.sla_state === "breached") out.push({ item: i, reason: "past_target", next: i.first_response_at ? "Resolve or update the customer" : "Reply to the customer" });
    else if (i.sla_state === "at_risk") out.push({ item: i, reason: "due_soon", next: i.first_response_at ? "Resolve or update the customer" : "Reply to the customer" });
    else if (!i.assigned_to && (i.priority === "urgent" || i.priority === "high")) out.push({ item: i, reason: "unassigned_high", next: "Assign an owner" });
    else if (i.source === "complaint" && i.status_group === "new") out.push({ item: i, reason: "complaint_new", next: "Acknowledge the complaint" });
    else if (!i.assigned_to && i.status_group !== "awaiting_customer") out.push({ item: i, reason: "unassigned", next: "Assign an owner" });
    else continue;
    if (out.length >= limit) break;
  }
  return out;
}

export const ATTENTION_LABEL: Record<AttentionReason, string> = {
  past_target: "Past target",
  due_soon: "Due soon",
  unassigned_high: "High priority, no owner",
  unassigned: "No owner",
  complaint_new: "New complaint",
  with_other_team: "With another team",
};

/** "45 min", "3 h 20 min", "2 d 4 h". A missing value reads "Not yet". */
export function formatMinutes(min: number | null | undefined): string {
  if (min === null || min === undefined || !Number.isFinite(min)) return "Not yet";
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) {
    const rest = m % 60;
    return rest ? `${h} h ${rest} min` : `${h} h`;
  }
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d} d ${rh} h` : `${d} d`;
}

/** Time to a due point, as words for a badge: "due in 2 h", "4 h late". */
export function describeDue(dueIso: string | null | undefined, now: Date): string | null {
  if (!dueIso) return null;
  const diff = (Date.parse(dueIso) - now.getTime()) / 60000;
  return diff >= 0 ? `due in ${formatMinutes(diff)}` : `${formatMinutes(-diff)} late`;
}

/** Workload per owner over open items. */
export function workloadByOwner(items: readonly WorkItem[]): { ownerId: string; name: string; open: number; late: number; waitingOnCustomer: number }[] {
  const map = new Map<string, { ownerId: string; name: string; open: number; late: number; waitingOnCustomer: number }>();
  for (const i of items) {
    if (i.is_test || !isOpen(i) || !i.assigned_to) continue;
    const row = map.get(i.assigned_to) ?? { ownerId: i.assigned_to, name: i.assigned_to_name ?? "Staff member", open: 0, late: 0, waitingOnCustomer: 0 };
    row.open += 1;
    if (i.sla_state === "breached") row.late += 1;
    if (i.status_group === "awaiting_customer") row.waitingOnCustomer += 1;
    map.set(i.assigned_to, row);
  }
  return [...map.values()].sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
}

/** Bulk assignment is allowed only where assign_support_work_item accepts the source; complaints are assigned in their own
 * workflow and a support message flagged for a doctor stays on the doctor route. Never bulk close or delete. */
export function canBulkAssign(i: WorkItem): boolean {
  if (!isOpen(i)) return false;
  if (i.source === "complaint") return false;
  if (i.source === "care_thread" && i.is_clinical) return false;
  return true;
}
