import { z } from "zod";
import type { MessageKey } from "@tarragon/i18n";

/**
 * S36i: the speak-up (safety concern) screens over the S20 functions (docs/design/S20.md sections 2, 6 and 7).
 *
 * Hard rules this module serves (spec INV-07, S20 safety rules 1 and 4):
 *  - nothing here is ever put in an address, a notice, a log line or an error message: notices are the fixed tokens below,
 *    a concern is addressed by a form field in a request body, never by a link;
 *  - every answer from the database is parsed, and a parse failure is a load failure, never an empty list.
 */
export const CONCERN_STATES = ["new", "acknowledged", "responded", "closed"] as const;
export type ConcernState = (typeof CONCERN_STATES)[number];

const message = z.object({
  kind: z.string(),
  body: z.string().nullable(),
  author_id: z.string().uuid().nullable().optional(),
  mine: z.boolean().optional(),
  created_at: z.string(),
});
export type ConcernMessage = z.infer<typeof message>;

/** One row of `safety_concern_inbox` (the lead). Identity (`raised_by_name`) is shown to the lead and named backup readers only. */
export const inboxRowSchema = z.object({
  id: z.string().uuid(),
  raised_by: z.string().uuid(),
  raised_by_name: z.string().nullable(),
  category: z.string(),
  severity: z.string(),
  description: z.string(),
  screen: z.string().nullable(),
  task_id: z.string().uuid().nullable(),
  state: z.enum(CONCERN_STATES),
  created_at: z.string(),
  acknowledge_due_at: z.string(),
  respond_due_at: z.string(),
  overdue: z.boolean().nullable(),
  escalated_at: z.string().nullable(),
  incident_id: z.string().uuid().nullable(),
  messages: z.array(message),
});
export type InboxRow = z.infer<typeof inboxRowSchema>;
export const inboxRowsSchema = z.array(inboxRowSchema);

/** One row of `my_safety_concerns` (the raiser): only their own, and only the replies meant for them. */
export const myConcernSchema = z.object({
  id: z.string().uuid(),
  category: z.string(),
  severity: z.string(),
  description: z.string(),
  state: z.enum(CONCERN_STATES),
  created_at: z.string(),
  acknowledge_due_at: z.string(),
  respond_due_at: z.string(),
  acknowledged_at: z.string().nullable(),
  responded_at: z.string().nullable(),
  closed_at: z.string().nullable(),
  messages: z.array(message),
});
export type MyConcern = z.infer<typeof myConcernSchema>;
export const myConcernsSchema = z.array(myConcernSchema);

export const RETALIATION_OUTCOMES = ["no_link", "link_found", "needs_follow_up"] as const;
export const retaliationRowSchema = z.object({
  id: z.string().uuid(),
  clinician_id: z.string().uuid(),
  clinician_name: z.string().nullable(),
  trigger_kind: z.string(),
  state: z.enum(["open", "closed"]),
  outcome: z.string().nullable(),
  created_at: z.string(),
});
export type RetaliationRow = z.infer<typeof retaliationRowSchema>;
export const retaliationRowsSchema = z.array(retaliationRowSchema);

export const readerRowsSchema = z.array(z.object({ profile_id: z.string().uuid(), note: z.string().nullable(), created_at: z.string().nullable().optional() }));
export type ReaderRow = z.infer<typeof readerRowsSchema>[number];
export const staffRowsSchema = z.array(z.object({ profile_id: z.string().uuid(), full_name: z.string().nullable() }));
export type StaffRow = z.infer<typeof staffRowsSchema>[number];

export const INCIDENT_SEVERITIES = ["sev1", "sev2", "sev3", "sev4"] as const;

export type DeadlineState = "done" | "overdue" | "open";
export interface Deadlines {
  acknowledge: DeadlineState;
  respond: DeadlineState;
  /** Whole hours from now to the next open deadline; negative once overdue. Null when nothing is open. */
  hoursToNext: number | null;
}

/**
 * Acknowledge and response deadlines. The due times are set by the database from `quality_config` (48 hours and 14 days by
 * default, shorter for "cannot wait"); this only reads them against the clock and never invents a window of its own.
 */
export function deadlines(row: Pick<InboxRow | MyConcern, "state" | "acknowledge_due_at" | "respond_due_at">, now: number): Deadlines {
  const ack = Date.parse(row.acknowledge_due_at);
  const res = Date.parse(row.respond_due_at);
  const acknowledge: DeadlineState = row.state !== "new" ? "done" : ack < now ? "overdue" : "open";
  const respond: DeadlineState = row.state === "responded" || row.state === "closed" ? "done" : res < now ? "overdue" : "open";
  const next = acknowledge !== "done" ? ack : respond !== "done" ? res : null;
  return { acknowledge, respond, hoursToNext: next === null ? null : Math.floor((next - now) / 3_600_000) };
}

/** Open items first, overdue ahead of the rest, then the soonest deadline. Closed ones sink to the bottom. */
export function sortInbox(rows: InboxRow[], now: number): InboxRow[] {
  const rank = (r: InboxRow) => {
    if (r.state === "closed") return 3;
    const d = deadlines(r, now);
    return d.acknowledge === "overdue" || d.respond === "overdue" ? 0 : r.state === "new" ? 1 : 2;
  };
  return [...rows].sort((a, b) => rank(a) - rank(b) || Date.parse(a.acknowledge_due_at) - Date.parse(b.acknowledge_due_at));
}

/** "Reader" candidates: active staff who are not already readers and not the lead. */
export function readerCandidates(staff: StaffRow[], readers: ReaderRow[], selfId: string | null): StaffRow[] {
  const taken = new Set(readers.map((r) => r.profile_id));
  return staff.filter((s) => !taken.has(s.profile_id) && s.profile_id !== selfId);
}

/** The words a notice may show. A notice in an address is one of these tokens, so a link can never put its own words on the page. */
export const CONCERN_NOTICES = [
  "acknowledged",
  "responded",
  "closed",
  "incident_opened",
  "reader_added",
  "reader_removed",
  "review_closed",
  "added",
  "failed",
] as const;
export type ConcernNotice = (typeof CONCERN_NOTICES)[number];
export const asConcernNotice = (v: unknown): ConcernNotice | null => ((CONCERN_NOTICES as readonly unknown[]).includes(v) ? (v as ConcernNotice) : null);

export const idSchema = z.string().uuid();
export const textSchema = (min: number) => z.string().trim().min(min).max(4000);

/** A label key built from a value the database returned (category, severity, message kind). Known values all have a key. */
export const labelKey = (prefix: "concern.category" | "concern.severity" | "speakup.kind", value: string): MessageKey => `${prefix}.${value}` as MessageKey;
