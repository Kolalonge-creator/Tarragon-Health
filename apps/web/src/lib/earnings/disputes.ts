import { z } from "zod";

/**
 * Earnings disputes, pay status, withholding and pilot-minimum holds (S30b). Input schemas, plain-words errors and parsers for what the
 * database returns, shared by the actions, the pages and the tests. Money is integer kobo (INV-15). Nothing here calculates tax (D-09):
 * a withholding amount is typed in by a person and stored.
 */

export const DISPUTE_NOTE_MAX = 1000;
export const RESOLUTION_NOTE_MIN = 10;

export const REASON_CODES = ["wrong_amount", "missing_work", "duplicate", "wrong_type", "other"] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const REASON_LABEL: Record<ReasonCode, string> = {
  wrong_amount: "The amount looks wrong",
  missing_work: "Work I did is missing",
  duplicate: "This line is a duplicate",
  wrong_type: "This is the wrong kind of line",
  other: "Something else",
};

export const PAY_STATUS = ["pending", "approved", "paid", "failed", "disputed"] as const;
export type PayStatus = (typeof PAY_STATUS)[number];

export const PAY_STATUS_LABEL: Record<PayStatus, string> = {
  pending: "Waiting for the next payout",
  approved: "In a payout being sent",
  paid: "Paid",
  failed: "Payout failed, being retried",
  disputed: "On hold while we look at your question",
};

export function payStatusVariant(status: PayStatus): "green" | "amber" | "red" | "grey" {
  if (status === "paid") return "green";
  if (status === "failed") return "red";
  if (status === "approved" || status === "disputed") return "amber";
  return "grey";
}

const ERROR_WORDS: Record<string, string> = {
  dispute_bad_reason: "Please choose one of the reasons.",
  dispute_note_too_long: `Please keep the note under ${DISPUTE_NOTE_MAX.toLocaleString("en-GB")} characters.`,
  dispute_unknown_line: "That line could not be found on your statement.",
  dispute_window_closed: "That line is too old to question here. Please contact operations.",
  dispute_already_open: "You already have a question open on that line.",
  dispute_unknown: "That question could not be found.",
  dispute_not_open: "That question has already been answered or withdrawn.",
  dispute_bad_resolution: "Please choose whether to add a correction or turn the question down.",
  dispute_rejection_has_no_amount: "Turning a question down does not take an amount.",
  earnings_bad_amount: "Please enter an amount that is not zero.",
  earnings_reason_needed: `Please give a reason of at least ${RESOLUTION_NOTE_MIN} characters.`,
  earnings_not_contracted: "This is for contracted clinicians. Employed doctors are paid by salary.",
  payout_unknown: "That payout could not be found.",
  payout_not_a_draft: "Withholding can be entered only while a payout is a draft.",
  payout_bad_withholding: "The withholding must be zero or more, and less than the payout.",
  payout_withholding_undecided: "This payout has a withholding amount, and how it is paid and recorded is not decided yet, so it cannot be sent.",
  hold_bad_decision: "Please choose release or deny.",
  hold_unknown: "That hold could not be found.",
  hold_already_decided: "That hold has already been decided.",
  fee_not_authorised: "You do not have access to this.",
  payout_not_authorised: "You do not have access to this.",
};

export function describeDisputeError(
  error: { message?: string | null } | null | undefined,
  fallback = "Something went wrong. Please try again.",
): string {
  const message = error?.message ?? "";
  for (const key of Object.keys(ERROR_WORDS)) {
    if (message.includes(key)) return ERROR_WORDS[key] as string;
  }
  return fallback;
}

export const openDisputeSchema = z.object({
  ledgerId: z.string().uuid(),
  reasonCode: z.enum(REASON_CODES),
  note: z.string().trim().max(DISPUTE_NOTE_MAX, `Please keep the note under ${DISPUTE_NOTE_MAX.toLocaleString("en-GB")} characters.`).optional(),
  requestId: z.string().uuid(),
});

export const withdrawDisputeSchema = z.object({ disputeId: z.string().uuid() });

const resolutionNote = z.string().trim().min(RESOLUTION_NOTE_MIN, `Please give a reason of at least ${RESOLUTION_NOTE_MIN} characters.`).max(1000);

export const resolveDisputeSchema = z.discriminatedUnion("resolution", [
  z.object({ resolution: z.literal("adjusted"), disputeId: z.string().uuid(), direction: z.enum(["add", "take_away"]), note: resolutionNote }),
  z.object({ resolution: z.literal("rejected"), disputeId: z.string().uuid(), note: resolutionNote }),
]);

export const holdDecisionSchema = z.object({ holdId: z.string().uuid(), decision: z.enum(["released", "denied"]), note: resolutionNote });

export const withholdingNoteSchema = z.string().trim().max(1000);

export const myLineSchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  amount_kobo: z.number().int(),
  earned_at: z.string(),
  payout_id: z.string().nullable(),
  calculation: z.record(z.string(), z.unknown()),
  pay_status: z.enum(PAY_STATUS),
  dispute_id: z.string().uuid().nullable(),
  dispute_state: z.enum(["open", "adjusted", "rejected", "withdrawn"]).nullable(),
  dispute_due_at: z.string().nullable(),
});
export type MyLine = z.infer<typeof myLineSchema>;
export const myLinesSchema = z.array(myLineSchema);

export const adminDisputeRowSchema = z.object({
  id: z.string().uuid(),
  ledger_id: z.string().uuid(),
  clinician_id: z.string().uuid(),
  clinician_name: z.string().nullable(),
  reason_code: z.string(),
  note: z.string().nullable(),
  state: z.enum(["open", "adjusted", "rejected", "withdrawn"]),
  opened_at: z.string(),
  response_due_at: z.string(),
  overdue: z.boolean(),
  resolved_at: z.string().nullable(),
  resolution_note: z.string().nullable(),
  line_kind: z.string(),
  line_amount_kobo: z.number().int(),
  line_earned_at: z.string(),
  task_type: z.string().nullable(),
  adjustment_ledger_id: z.string().nullable(),
});
export type AdminDisputeRow = z.infer<typeof adminDisputeRowSchema>;
export const adminDisputeRowsSchema = z.array(adminDisputeRowSchema);

export const HOLD_REASON_WORDS: Record<string, string> = {
  no_claims_while_work_waited: "They took no task during these hours while tasks were waiting.",
  expired_claims_and_no_completed: "They took tasks that timed out and finished none during these hours.",
};

export const topupHoldRowSchema = z.object({
  id: z.string().uuid(),
  clinician_id: z.string().uuid(),
  clinician_name: z.string().nullable(),
  run_start: z.string(),
  run_end: z.string(),
  reason: z.string(),
  evidence: z.record(z.string(), z.unknown()),
  state: z.enum(["held", "released", "denied"]),
  decided_at: z.string().nullable(),
  decision_note: z.string().nullable(),
});
export type TopupHoldRow = z.infer<typeof topupHoldRowSchema>;
export const topupHoldRowsSchema = z.array(topupHoldRowSchema);

export const statementSchema = z.object({
  payout_id: z.string().uuid(),
  clinician_name: z.string().nullable(),
  tin: z.string().nullable(),
  period_start: z.string(),
  period_end: z.string(),
  state: z.string(),
  reference: z.string().nullable(),
  gross_kobo: z.number().int(),
  withholding_kobo: z.number().int(),
  withholding_note: z.string().nullable(),
  net_kobo: z.number().int(),
  lines: z.array(
    z.object({
      id: z.string().uuid(),
      kind: z.string(),
      earned_at: z.string(),
      amount_kobo: z.number().int(),
      task_type: z.string().nullable(),
      pay_status: z.enum(PAY_STATUS),
    }),
  ),
});
export type PayoutStatement = z.infer<typeof statementSchema>;

/** A question can be opened on a line only when none is already open on it. The database also checks the age of the line. */
export function canDispute(line: Pick<MyLine, "dispute_state">): boolean {
  return line.dispute_state !== "open";
}
