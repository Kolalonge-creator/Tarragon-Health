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
  reversed: "Returned by the bank",
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
