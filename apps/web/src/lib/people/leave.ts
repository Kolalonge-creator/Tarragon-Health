import { z } from "zod";
import { daysUntil, type AttentionItem } from "./attention";
import type { Loaded } from "./directory";

/**
 * HR Phase C: leave requests (decisions HR-03, HR-04). Requests are read through RLS (the person, their current line manager,
 * admins) or the decide/overview functions; the sickness reason is never part of these reads, only of its own audited function.
 */
interface Client {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  from(table: string): {
    select(cols: string): {
      eq(col: string, value: string): {
        order(col: string, o: { ascending: boolean }): PromiseLike<{ data: unknown; error: { message: string } | null }>;
      };
    };
  };
}

export const LEAVE_TYPES = ["annual", "sick", "study", "maternity", "paternity", "compassionate", "unpaid", "other"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];
export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  annual: "Annual leave",
  sick: "Sick leave",
  study: "Study leave",
  maternity: "Maternity leave",
  paternity: "Paternity leave",
  compassionate: "Compassionate leave",
  unpaid: "Unpaid leave",
  other: "Other leave",
};
export const LEAVE_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];
export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: "Waiting for a decision",
  approved: "Approved",
  rejected: "Not approved",
  cancelled: "Cancelled",
};
export const LEAVE_STATUS_BADGE: Record<LeaveStatus, "attention" | "normal" | "critical" | "inactive"> = {
  pending: "attention",
  approved: "normal",
  rejected: "critical",
  cancelled: "inactive",
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const myLeaveSchema = z.object({
  id: z.string().uuid(),
  leave_type: z.enum(LEAVE_TYPES),
  starts_on: isoDate,
  ends_on: isoDate,
  working_days: z.number(),
  note: z.string().nullable(),
  status: z.enum(LEAVE_STATUSES),
  decision_note: z.string().nullable(),
  requested_at: z.string(),
});
export type MyLeave = z.infer<typeof myLeaveSchema>;

export const toDecideSchema = z.object({
  request_id: z.string().uuid(),
  profile_id: z.string().uuid(),
  full_name: z.string().nullable(),
  leave_type: z.enum(LEAVE_TYPES),
  starts_on: isoDate,
  ends_on: isoDate,
  working_days: z.number(),
  note: z.string().nullable(),
  requested_at: z.string(),
  is_clinician: z.boolean(),
});
export type ToDecide = z.infer<typeof toDecideSchema>;

export const adminLeaveSchema = z.object({
  request_id: z.string().uuid(),
  profile_id: z.string().uuid(),
  full_name: z.string().nullable(),
  leave_type: z.enum(LEAVE_TYPES),
  starts_on: isoDate,
  ends_on: isoDate,
  working_days: z.number(),
  status: z.enum(LEAVE_STATUSES),
  requested_at: z.string(),
  decided_by_name: z.string().nullable(),
  decided_at: z.string().nullable(),
  is_clinician: z.boolean(),
  has_sickness_reason: z.boolean(),
});
export type AdminLeave = z.infer<typeof adminLeaveSchema>;

function parsed<T>(schema: z.ZodType<T>, data: unknown, what: string): Loaded<T> {
  const r = schema.safeParse(data);
  return r.success ? { ok: true, value: r.data } : { ok: false, message: `The ${what} came back in an unexpected shape.` };
}

export async function loadMyLeave(client: unknown, profileId: string): Promise<Loaded<MyLeave[]>> {
  const { data, error } = await (client as Client)
    .from("staff_leave_requests")
    .select("id, leave_type, starts_on, ends_on, working_days, note, status, decision_note, requested_at")
    .eq("profile_id", profileId)
    .order("starts_on", { ascending: false });
  if (error) return { ok: false, message: "Your leave could not be loaded." };
  return parsed(z.array(myLeaveSchema), data, "leave list");
}

export async function loadLeaveToDecide(client: unknown): Promise<Loaded<ToDecide[]>> {
  const { data, error } = await (client as Client).rpc("leave_requests_to_decide");
  if (error) return { ok: false, message: "The requests waiting for you could not be loaded." };
  return parsed(z.array(toDecideSchema), data, "requests to decide");
}

export async function loadAllLeave(client: unknown, from?: string): Promise<Loaded<AdminLeave[]>> {
  const { data, error } = await (client as Client).rpc("people_leave_requests", from ? { p_from: from } : {});
  if (error) return { ok: false, message: "The leave requests could not be loaded." };
  return parsed(z.array(adminLeaveSchema), data, "leave requests");
}

/** How many booked appointments approving would cancel; null when it could not be worked out (approval is then not offered). */
export async function loadLeaveImpact(client: unknown, requestId: string): Promise<number | null> {
  const { data, error } = await (client as Client).rpc("leave_request_impact", { p_request: requestId });
  if (error) return null;
  const n = z.number().int().nonnegative().safeParse(data);
  return n.success ? n.data : null;
}

/** How many on-call shifts the person is rostered for during the leave; null when it could not be worked out. */
export async function loadLeaveRotaShifts(client: unknown, requestId: string): Promise<number | null> {
  const { data, error } = await (client as Client).rpc("leave_request_rota_shifts", { p_request: requestId });
  if (error) return null;
  const n = z.number().int().nonnegative().safeParse(data);
  return n.success ? n.data : null;
}

/** A YYYY-MM-DD date `days` before `today` (YYYY-MM-DD). */
export function daysBefore(today: string, days: number): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
}

/** Waiting requests older than this many days are raised on the HR overview. */
export const LEAVE_STALE_DAYS = 3;

/** Attention items: a pending request nobody has decided for a while (higher once its first day is near or past). */
export function leaveAttention(rows: AdminLeave[], today: string): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const r of rows) {
    if (r.status !== "pending") continue;
    const waited = -daysUntil(r.requested_at, today);
    const startsIn = daysUntil(r.starts_on, today);
    if (waited < LEAVE_STALE_DAYS && startsIn > 7) continue;
    items.push({
      kind: "leave_awaiting_decision",
      profileId: r.profile_id,
      name: r.full_name ?? "Unnamed account",
      department: null,
      priority: startsIn <= 2 ? "high" : startsIn <= 7 ? "medium" : "low",
      issue: startsIn < 0 ? "Leave started without a decision" : `Leave request waiting ${waited} ${waited === 1 ? "day" : "days"}`,
      due: r.starts_on,
      nextAction: "Decide the request",
      href: "/admin/people/leave",
    });
  }
  return items;
}

/** The dates of a request in plain words. */
export function leaveDates(startsOn: string, endsOn: string, fmt: (d: string) => string): string {
  return startsOn === endsOn ? fmt(startsOn) : `${fmt(startsOn)} to ${fmt(endsOn)}`;
}
