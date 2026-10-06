import { z } from "zod";

/**
 * S36j: the payout approval queue the Chief Medical Officer sees (founder decision 2026-10-06). Parsers and the page model only; no
 * server-only imports so the page, the action and the tests share one definition. The queue carries no bank data (the database
 * function never returns any). Money is integer kobo.
 */
export const approvalRowSchema = z.object({
  id: z.string().uuid(),
  period_start: z.string(),
  period_end: z.string(),
  amount_kobo: z.number().int(),
  line_count: z.number().int(),
  clinician_name: z.string().nullable(),
  bank_ready: z.boolean(),
  state: z.string(),
  created_at: z.string(),
});
export const approvalRowsSchema = z.array(approvalRowSchema);
export type ApprovalRow = z.infer<typeof approvalRowSchema>;

export type ApprovalLoad = { ok: true; rows: ApprovalRow[] } | { ok: false };

export type ApprovalRowModel = ApprovalRow & { canApprove: boolean; blockedReason: "guard_off" | "no_bank" | null };

/** What the page shows. The Approve button is disabled when approval is switched off or the payee has no verified bank. The database checks both again. */
export function buildApprovalModel(rows: ApprovalRow[], guardOpen: boolean): ApprovalRowModel[] {
  return rows.map((r) => {
    const blockedReason = !guardOpen ? "guard_off" : !r.bank_ready ? "no_bank" : null;
    return { ...r, canApprove: blockedReason === null, blockedReason };
  });
}
