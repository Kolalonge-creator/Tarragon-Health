import { z } from "zod";

/**
 * Weekly payouts (S31, spec 7.7, D-09): input schemas, the plain-words error mapping and the parsers for what the database returns.
 * No server-only imports so actions, pages and tests share one definition. Money is integer kobo (INV-15). No tax is calculated.
 */

export const STATE_LABEL: Record<string, string> = {
  draft: "Draft",
  approved: "Approved, not yet sent",
  sent: "Sent, waiting for the bank",
  succeeded: "Paid",
  failed: "Failed",
  reversed: "Returned by the bank, being sent again",
  cancelled: "Cancelled",
};

export function stateVariant(state: string): "green" | "amber" | "red" | "grey" {
  if (state === "succeeded") return "green";
  if (state === "failed" || state === "reversed") return "red";
  if (state === "approved" || state === "sent") return "amber";
  return "grey";
}

const ERROR_WORDS: Record<string, string> = {
  payout_not_authorised: "You do not have access to payouts.",
  payout_guard_off: "Payouts are not switched on yet. The founder switches them on from the go-live page once the conditions are met.",
  payout_unknown: "That payout could not be found.",
  payout_not_a_draft: "Only a draft can be approved or discarded.",
  payout_self_approval: "A payout cannot be approved by the person it is for.",
  payout_no_verified_bank: "This clinician has no verified bank account yet, so nothing can be sent.",
  payout_ledger_changed: "Their earnings changed after this draft was made. Rebuild the drafts and approve the new one.",
  payout_link_mismatch: "The earnings could not be matched to this payout, so nothing was approved. Rebuild the drafts.",
  payout_not_approved: "Only an approved payout can be sent.",
  payout_already_paid: "This payout has already been paid.",
  payout_test_account: "A test account is never paid.",
  payout_not_retryable: "Only a failed or returned payout can be tried again.",
  payout_not_a_contracted_clinician: "Payouts are for contracted clinicians. Employed doctors are paid by salary.",
  payout_bank_too_many_lookups: "You have checked bank accounts several times today. Please try again tomorrow.",
  payout_batch_required: "With the batch control on, a payout can be sent only from a released batch. Ask a second approver to release it.",
  payout_batch_control_off: "The batch control is not switched on.",
  payout_limit_payout: "This payout is over the per-payout limit. It cannot be sent until the limit is changed or the payout is split.",
  payout_limit_clinician: "Sending this would take this clinician over their limit for the last seven days.",
  payout_limit_batch_total: "The batch total is over the limit for one batch. Split it into two batches.",
  payout_limit_batch_count: "That is too many payouts for one batch. Split it into two batches.",
  payout_batch_self_release: "A batch must be released by a different person from the one who made it.",
  payout_batch_pays_the_checker: "A batch that pays the person releasing it must be released by someone else.",
  payout_batch_changed: "A payout in this batch has changed since it was made. Reject it and make a new batch.",
  payout_already_in_a_batch: "A payout in this list is already in a batch.",
  payout_batch_empty: "Choose at least one payout.",
  payout_batch_needs_reason: "Please give a reason of at least ten characters.",
  send_failed: "Paystack did not take the transfer. Nothing was paid. You can send it again.",
  not_configured: "Paystack is not set up for this environment.",
  account_not_resolved: "The bank could not find that account. Please check the bank and the number.",
  recipient_failed: "The account was found but could not be saved with Paystack. Please try again.",
  unknown_bank: "Please choose a bank from the list.",
  invalid_input: "Please check the bank and the ten digit account number.",
  tax_not_a_contracted_clinician: "Tax details are for contracted clinicians.",
};

export function describePayoutError(raw: string | null | undefined, fallback = "Something went wrong. Please try again."): string {
  const message = raw ?? "";
  for (const key of Object.keys(ERROR_WORDS)) {
    if (message.includes(key)) return ERROR_WORDS[key] as string;
  }
  return fallback;
}

export const payoutIdSchema = z.string().uuid();

export const taxProfileSchema = z.object({
  tin: z.string().trim().max(20).regex(/^[0-9A-Za-z-]{6,20}$/, "A tax identification number is 6 to 20 letters, digits or dashes.").or(z.literal("")),
  status: z.enum(["unknown", "individual", "company"]),
  registeredName: z.string().trim().max(200),
  vat: z.boolean(),
  note: z.string().trim().max(500),
});

export const bankFormSchema = z.object({
  bankCode: z.string().regex(/^\d{3,6}$/, "Please choose a bank."),
  accountNumber: z.string().regex(/^\d{10}$/, "An account number is ten digits."),
});

const kobo = z.number().int();

export const adminPayoutRowSchema = z.object({
  id: z.string().uuid(),
  clinician_id: z.string().uuid(),
  clinician_name: z.string().nullable(),
  period_start: z.string(),
  period_end: z.string(),
  amount_kobo: kobo,
  line_count: z.number().int(),
  state: z.string(),
  approved_at: z.string().nullable(),
  failure_reason: z.string().nullable(),
  bank_ready: z.boolean(),
  reference: z.string().nullable(),
  created_at: z.string(),
});
export const adminPayoutRowsSchema = z.array(adminPayoutRowSchema);
export type AdminPayoutRow = z.infer<typeof adminPayoutRowSchema>;

export const overviewSchema = z.object({
  bank: z
    .object({
      bank_name: z.string(),
      account_last4: z.string(),
      resolved_name: z.string(),
      name_match: z.string(),
      verified: z.boolean(),
      bank_verified_at: z.string().nullable(),
    })
    .nullable(),
  tax: z.object({ tin: z.string().nullable(), contractor_status: z.string(), registered_name: z.string().nullable(), vat_registered: z.boolean(), note: z.string().nullable() }).nullable(),
  payouts: z.array(
    z.object({
      id: z.string().uuid(),
      period_start: z.string(),
      period_end: z.string(),
      amount_kobo: kobo,
      line_count: z.number().int(),
      state: z.string(),
      approved_at: z.string().nullable(),
      /** S31x: when the bank last returned this payout, and whether it had been paid before that. Absent on an older reply. */
      reversed_at: z.string().nullable().optional(),
      paid_then_returned: z.boolean().optional(),
      reference: z.string().nullable(),
      lines: z.array(z.object({ id: z.string().uuid(), kind: z.string(), earned_at: z.string(), amount_kobo: kobo, task_type: z.string().nullable() })),
    }),
  ),
  next_payout_kobo: kobo,
  minimum_payout_kobo: kobo.nullable(),
});
export type PayoutOverview = z.infer<typeof overviewSchema>;

/** Which buttons an admin sees for a payout in this state. The database refuses anything else; this only hides what cannot work. */
export function adminActionsFor(row: Pick<AdminPayoutRow, "state" | "bank_ready">): readonly ("approve" | "discard" | "send" | "retry")[] {
  switch (row.state) {
    case "draft":
      return row.bank_ready ? ["approve", "discard"] : ["discard"];
    case "approved":
      return ["send"];
    case "failed":
    case "reversed":
      return ["retry"];
    default:
      return [];
  }
}

export const banksSchema = z.object({ banks: z.array(z.object({ code: z.string(), name: z.string() })) });

/**
 * The line shown under a clinician's payout when the bank returned it. Plain words, no blame, nothing for the clinician to do.
 * `paid_then_returned` is the case that matters most: they saw "Paid" and the money has since come back.
 */
export function returnedNote(p: { state: string; paid_then_returned?: boolean | undefined }): string | null {
  if (p.state !== "reversed") return null;
  return p.paid_then_returned
    ? "This payout was paid and then returned by your bank. The finance team has been told and will send it again. There is nothing for you to do."
    : "Your bank returned this payout before it reached you. The finance team has been told and will send it again. There is nothing for you to do.";
}
