import { z } from "zod";

/**
 * One row of public.coordination_work_items (CC-4): an open piece of coordination work from any of the four sources, already scoped
 * by the caller's own RLS. Everything here is pure so it can be tested without a database.
 */
export const WORK_SOURCES = ["outreach", "support", "programme", "queue"] as const;
export type WorkSource = (typeof WORK_SOURCES)[number];

export const WORK_STATUSES = ["open", "in_progress", "awaiting_patient", "awaiting_external", "awaiting_clinician"] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

export const workItemSchema = z.object({
  source: z.enum(WORK_SOURCES),
  item_id: z.string().min(1),
  organisation_id: z.string().min(1),
  patient_id: z.string().min(1),
  patient_name: z.string().nullable(),
  patient_number: z.string().nullable(),
  category: z.enum(["outreach", "follow_up", "support", "programme", "queue"]),
  kind: z.string(),
  priority: z.number().int().min(1).max(3),
  due_at: z.string().nullable(),
  status: z.enum(WORK_STATUSES),
  raw_status: z.string(),
  assigned_to: z.string().min(1).nullable(),
  assigned_name: z.string().nullable(),
  assigned_is_coordinator: z.boolean().nullable(),
  auto_assigned: z.boolean(),
  created_at: z.string(),
  last_activity_at: z.string().nullable(),
});
export type WorkItem = z.infer<typeof workItemSchema>;
export type WorkCategory = WorkItem["category"];

export const CATEGORY_LABEL: Record<WorkCategory, string> = {
  outreach: "Outreach",
  follow_up: "Result follow-up",
  support: "Support request",
  programme: "Programme task",
  queue: "Queue task",
};

export const STATUS_LABEL: Record<WorkStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  awaiting_patient: "Awaiting patient",
  awaiting_external: "Awaiting provider",
  awaiting_clinician: "Awaiting doctor",
};

export const PRIORITY_LABEL: Record<1 | 2 | 3, string> = { 1: "Act first", 2: "Normal", 3: "When there is time" };

/** Where the coordinator does the work. Each link is a page that already exists; nothing here is a new workflow. */
export function workItemHref(item: Pick<WorkItem, "source" | "category" | "item_id">): string {
  switch (item.source) {
    case "outreach":
      return item.category === "follow_up" ? "/dashboard/care-coordinator/follow-ups" : "/dashboard/care-coordinator/outreach";
    case "support":
      return "/dashboard/care-coordinator/support-requests";
    case "programme":
      return "/dashboard/care-coordinator/programme-tasks";
    case "queue":
      return `/clinician/tasks/${item.item_id}`;
  }
}

/** Only these sources carry an `assigned_to` a person may take by hand; a queue task is claimed through the queue's own rules. */
export function canTakeOver(item: Pick<WorkItem, "source">): boolean {
  return item.source !== "queue";
}

export const TAKE_OVER_TABLE: Record<Exclude<WorkSource, "queue">, string> = {
  outreach: "care_outreach_tasks",
  support: "navigation_requests",
  programme: "chronic_programme_coordinator_tasks",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar day in Lagos, as YYYY-MM-DD, so "due today" means today where the patient and the care team are. */
export function lagosDay(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function isOverdue(item: Pick<WorkItem, "due_at">, now: Date): boolean {
  return item.due_at !== null && new Date(item.due_at).getTime() < now.getTime();
}

export function isDueToday(item: Pick<WorkItem, "due_at">, now: Date): boolean {
  return item.due_at !== null && !isOverdue(item, now) && lagosDay(new Date(item.due_at)) === lagosDay(now);
}

/** How long an item has been waiting, in whole days (0 on its first day). */
export function daysWaiting(item: Pick<WorkItem, "created_at">, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(item.created_at).getTime()) / DAY_MS));
}

/** An item has waited "too long" after 3 days with no due date of its own. Shown as a fact, never turned into clinical urgency. */
export const STALE_AFTER_DAYS = 3;

export const SAVED_VIEWS = [
  { id: "mine", label: "My tasks" },
  { id: "due_today", label: "Due today" },
  { id: "overdue", label: "Overdue" },
  { id: "awaiting_patient", label: "Awaiting patient" },
  { id: "awaiting_other", label: "Awaiting doctor or provider" },
  { id: "unassigned", label: "Unassigned" },
  { id: "all", label: "Everyone's" },
] as const;
export type SavedViewId = (typeof SAVED_VIEWS)[number]["id"];

export function isSavedViewId(v: string | null | undefined): v is SavedViewId {
  return SAVED_VIEWS.some((s) => s.id === v);
}

export function applySavedView(items: readonly WorkItem[], view: SavedViewId, me: string, now: Date): WorkItem[] {
  switch (view) {
    case "mine":
      return items.filter((i) => i.assigned_to === me);
    case "due_today":
      return items.filter((i) => isDueToday(i, now));
    case "overdue":
      return items.filter((i) => isOverdue(i, now));
    case "awaiting_patient":
      return items.filter((i) => i.status === "awaiting_patient");
    case "awaiting_other":
      return items.filter((i) => i.status === "awaiting_clinician" || i.status === "awaiting_external");
    case "unassigned":
      return items.filter((i) => i.assigned_to === null);
    case "all":
      return [...items];
  }
}

export type WorkFilters = {
  search: string;
  category: WorkCategory | "all";
  status: WorkStatus | "all";
};

export function applyFilters(items: readonly WorkItem[], f: WorkFilters): WorkItem[] {
  const q = f.search.trim().toLowerCase();
  return items.filter(
    (i) =>
      (f.category === "all" || i.category === f.category) &&
      (f.status === "all" || i.status === f.status) &&
      (q === "" ||
        (i.patient_name ?? "").toLowerCase().includes(q) ||
        (i.patient_number ?? "").toLowerCase().includes(q) ||
        (i.assigned_name ?? "").toLowerCase().includes(q)),
  );
}

export type SortKey = "priority" | "due" | "waiting" | "patient";

/** Default order: overdue first, then priority, then soonest due, then longest waiting. Stable on ties by id. */
export function sortItems(items: readonly WorkItem[], key: SortKey, now: Date): WorkItem[] {
  const due = (i: WorkItem) => (i.due_at ? new Date(i.due_at).getTime() : Number.POSITIVE_INFINITY);
  const created = (i: WorkItem) => new Date(i.created_at).getTime();
  const cmp: Record<SortKey, (a: WorkItem, b: WorkItem) => number> = {
    priority: (a, b) =>
      Number(isOverdue(b, now)) - Number(isOverdue(a, now)) || a.priority - b.priority || due(a) - due(b) || created(a) - created(b),
    due: (a, b) => due(a) - due(b) || a.priority - b.priority,
    waiting: (a, b) => created(a) - created(b),
    patient: (a, b) => (a.patient_name ?? "").localeCompare(b.patient_name ?? ""),
  };
  return [...items].sort((a, b) => cmp[key](a, b) || a.item_id.localeCompare(b.item_id));
}

/**
 * "Needs your attention": the caller's own items (or unassigned ones) that are overdue, marked act-first, or waiting longer than
 * STALE_AFTER_DAYS. The reason shown is the fact that put it here, not an inferred clinical urgency.
 */
export type AttentionReason = "overdue" | "act_first" | "waiting";
export function attentionReason(item: WorkItem, now: Date): AttentionReason | null {
  if (isOverdue(item, now)) return "overdue";
  if (item.priority === 1) return "act_first";
  if (item.due_at === null && daysWaiting(item, now) >= STALE_AFTER_DAYS) return "waiting";
  return null;
}

export const ATTENTION_LABEL: Record<AttentionReason, string> = {
  overdue: "Past its due date",
  act_first: "Marked act first",
  waiting: `Waiting ${STALE_AFTER_DAYS}+ days`,
};

export function needsAttention(items: readonly WorkItem[], me: string, now: Date): { item: WorkItem; reason: AttentionReason }[] {
  return sortItems(
    items.filter((i) => i.assigned_to === me || i.assigned_to === null),
    "priority",
    now,
  )
    .map((item) => ({ item, reason: attentionReason(item, now) }))
    .filter((x): x is { item: WorkItem; reason: AttentionReason } => x.reason !== null);
}

export type CoordinationKpis = {
  myOpen: number;
  dueToday: number;
  overdue: number;
  awaitingPatient: number;
  openSupport: number;
  resultFollowUps: number;
  unassigned: number;
  heldByDoctors: number;
};

/** Counts for the command centre. "Mine" counts are the caller's; the rest are what the caller can see (their organisation). */
export function computeKpis(items: readonly WorkItem[], me: string, now: Date): CoordinationKpis {
  const mine = items.filter((i) => i.assigned_to === me);
  return {
    myOpen: mine.length,
    dueToday: mine.filter((i) => isDueToday(i, now)).length,
    overdue: mine.filter((i) => isOverdue(i, now)).length,
    awaitingPatient: mine.filter((i) => i.status === "awaiting_patient").length,
    openSupport: items.filter((i) => i.source === "support").length,
    resultFollowUps: items.filter((i) => i.category === "follow_up").length,
    unassigned: items.filter((i) => i.assigned_to === null).length,
    heldByDoctors: items.filter((i) => i.assigned_to !== null && i.assigned_is_coordinator === false).length,
  };
}

/** Counts per category, for the "where the work is" strip. Every category appears, zero included, in a fixed order. */
export function countByCategory(items: readonly WorkItem[]): { category: WorkCategory; count: number }[] {
  const order: WorkCategory[] = ["outreach", "follow_up", "support", "programme", "queue"];
  return order.map((category) => ({ category, count: items.filter((i) => i.category === category).length }));
}

export const PAGE_SIZE = 25;

export function paginate<T>(rows: readonly T[], page: number, size = PAGE_SIZE): { rows: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(1, page), pages);
  return { rows: rows.slice((p - 1) * size, p * size), page: p, pages };
}

// ---- recent activity and roster ----

export const activitySchema = z.object({
  kind: z.enum(["contact_logged", "outreach_resolved", "support_resolved", "programme_done"]),
  event_id: z.string().min(1),
  patient_id: z.string().min(1),
  patient_name: z.string().nullable(),
  occurred_at: z.string(),
  actor_id: z.string().min(1).nullable(),
  actor_name: z.string().nullable(),
  detail: z.string().nullable(),
});
export type ActivityEvent = z.infer<typeof activitySchema>;

export const ACTIVITY_LABEL: Record<ActivityEvent["kind"], string> = {
  contact_logged: "Contact logged",
  outreach_resolved: "Outreach closed",
  support_resolved: "Support request resolved",
  programme_done: "Programme task done",
};

export const rosterRowSchema = z.object({
  patient_id: z.string().min(1),
  full_name: z.string().nullable(),
  patient_number: z.string().nullable(),
  clinician_id: z.string().min(1).nullable(),
  clinician_name: z.string().nullable(),
  coordinator_id: z.string().min(1).nullable(),
  coordinator_name: z.string().nullable(),
  open_items: z.number().int(),
  overdue_items: z.number().int(),
  next_appointment_at: z.string().nullable(),
  last_contact_at: z.string().nullable(),
});
export type RosterRow = z.infer<typeof rosterRowSchema>;

/** "No contact in 30 days" is the roster's one judgement, and it is about contact, not health. */
export const NO_CONTACT_DAYS = 30;
export function contactIsStale(row: Pick<RosterRow, "last_contact_at">, now: Date): boolean {
  return row.last_contact_at === null || now.getTime() - new Date(row.last_contact_at).getTime() > NO_CONTACT_DAYS * DAY_MS;
}
