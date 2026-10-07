import { z } from "zod";

/**
 * Parsers for the two privacy RPCs (S66). The functions return jsonb, so the shape is checked here: a reply that does not match is a
 * failure the screen reports, never silently read as "nothing there".
 */

const accessRowSchema = z.object({ at: z.string(), result: z.enum(["success", "denied"]), reader: z.string() });
export type AccessRow = z.infer<typeof accessRowSchema>;

export function parseAccessLog(raw: unknown): AccessRow[] | "failed" {
  const parsed = z.array(accessRowSchema).safeParse(raw);
  return parsed.success ? parsed.data : "failed";
}

const countsSchema = z.object({
  menstrual_cycles: z.number(),
  menstrual_daily_logs: z.number(),
  menopause_logs_deleted: z.number(),
  menopause_logs_sealed: z.number(),
  reminders: z.number(),
});
const receiptSchema = z.object({
  menstrual_cycles_deleted: z.number(),
  menstrual_daily_logs_deleted: z.number(),
  menopause_logs_deleted: z.number(),
  menopause_logs_sealed_kept: z.number(),
  reminders_deleted: z.number(),
});
const statusSchema = z.object({
  pending: z.object({ execute_after: z.string(), requested_at: z.string() }).nullable(),
  last_receipt: z.object({ completed_at: z.string(), receipt: receiptSchema }).nullable(),
  counts: countsSchema,
});

export interface DeletionStatus {
  pending: { execute_after: string; requested_at: string } | null;
  lastReceipt: { completed_at: string; receipt: z.infer<typeof receiptSchema> } | null;
  counts: z.infer<typeof countsSchema>;
}

export function parseDeletionStatus(raw: unknown): DeletionStatus | "failed" {
  const parsed = statusSchema.safeParse(raw);
  if (!parsed.success) return "failed";
  return { pending: parsed.data.pending, lastReceipt: parsed.data.last_receipt, counts: parsed.data.counts };
}
