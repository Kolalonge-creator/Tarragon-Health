import { z } from "zod";

/**
 * S36f: payout drafts and approval (spec 7.7). Every answer is parsed here. The database decides who may prepare, who may approve
 * (an admin, a different person from the preparer, with a note) and what an approved payout can never do again; this file only
 * shapes what the screens show. Nothing here sends money: sending is a later piece, behind the payouts_enabled go-live guard.
 */
export const payoutRowSchema = z.object({
  id: z.string().uuid(),
  clinician_id: z.string().uuid(),
  clinician_name: z.string().nullable(),
  period_start: z.string(),
  period_end: z.string(),
  amount_kobo: z.number().int(),
  line_count: z.number().int(),
  state: z.enum(["draft", "approved", "sent", "succeeded", "failed", "reversed", "cancelled"]),
  fee_schedule_versions: z.array(z.number().int()),
  prepared_by: z.string().uuid(),
  prepared_by_name: z.string().nullable(),
  prepared_at: z.string(),
  approved_by_name: z.string().nullable(),
  approved_at: z.string().nullable(),
  approval_note: z.string().nullable(),
  cancel_reason: z.string().nullable(),
  can_approve: z.boolean().nullable(),
});
export type PayoutRow = z.infer<typeof payoutRowSchema>;
export const payoutRowsSchema = z.array(payoutRowSchema);

export const unpaidRowSchema = z.object({
  clinician_id: z.string().uuid(),
  full_name: z.string().nullable(),
  lines: z.number().int(),
  unpaid_kobo: z.number().int(),
  waiting_for_correction: z.number().int(),
});
export type UnpaidRow = z.infer<typeof unpaidRowSchema>;
export const unpaidRowsSchema = z.array(unpaidRowSchema);

export const NOTICES = ["prepared", "approved", "cancelled", "prepare_failed", "approve_failed", "same_person", "cancel_failed"] as const;
export type Notice = (typeof NOTICES)[number];
export const asNotice = (v: unknown): Notice | null => ((NOTICES as readonly unknown[]).includes(v) ? (v as Notice) : null);

/** A database refusal turned into one of the fixed notices (a link can never put its own words on the page). */
export function approveFailureNotice(message: string | undefined): Notice {
  return message?.includes("payout_same_person") ? "same_person" : "approve_failed";
}

export const PATHS = { admin: "/admin/payouts", ops: "/admin/ops/payouts" } as const;
export type Viewer = keyof typeof PATHS;
export const asViewer = (v: unknown): Viewer => (v === "ops" ? "ops" : "admin");

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const periodSchema = z
  .object({ start: z.string().regex(ISO_DATE), end: z.string().regex(ISO_DATE) })
  .refine((p) => p.start <= p.end && !Number.isNaN(Date.parse(p.start)) && !Number.isNaN(Date.parse(p.end)));

/**
 * The last full Monday to Sunday week in Lagos, as the form's starting suggestion only (spec 7.7 says weekly). Whoever prepares
 * can change either date; the database requires only that the period is over.
 */
export function lastFullWeek(now: Date): { start: string; end: string } {
  const lagos = new Date(now.getTime() + 60 * 60 * 1000); // Africa/Lagos is UTC+1, no daylight saving
  const day = lagos.getUTCDay(); // 0 Sunday
  const sinceMonday = (day + 6) % 7;
  const end = new Date(Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate() - sinceMonday - 1));
  const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}
