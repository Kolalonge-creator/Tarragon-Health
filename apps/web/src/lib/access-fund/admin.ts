import { z } from "zod";

/**
 * Operations screens for the Community Access Fund (S72, 19.11). The database checks the caller (admin only), the reason and every limit again; these
 * schemas only keep the forms honest. Money is whole naira typed by a person and converted to integer kobo here (INV-15).
 */
const uuid = z.string().uuid();
const reason = z.string().trim().min(10, "Please give a reason in at least ten characters.").max(500);

export const confirmDonationSchema = z.object({
  id: uuid,
  bankReference: z.string().trim().min(4, "Enter the bank reference from the statement.").max(80),
  note: reason,
});

export const approveGrantSchema = z.object({
  patientId: uuid,
  itemCode: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/, "Choose an item."),
  naira: z.coerce.number().int("Enter whole naira.").positive("Enter an amount."),
  criterion: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/, "Choose one of the published reasons."),
  note: reason,
});

export const cancelGrantSchema = z.object({ id: uuid, reason });

export const nairaToKobo = (naira: number): number => naira * 100;

const MESSAGES: ReadonlyArray<readonly [string, string]> = [
  ["access_fund_not_open", "The Community Access Fund switch is off. Turn it on from Go-live guards once its conditions are met."],
  ["access_fund_not_authorised", "Only an admin can do this."],
  ["access_fund_reason_needed", "Please give a reason in at least ten characters."],
  ["bank_reference_needed", "Enter the bank reference from the statement."],
  ["criterion_not_published", "That reason is not one of the published reasons."],
  ["grant_amount_invalid", "That amount is not allowed. It must be above zero, within the maximum, and not more than the item's price."],
  ["grant_already_open", "This person already has an open grant for that item."],
  ["fund_pool_short", "The Fund does not hold enough received gifts for this grant."],
  ["item_not_available", "That item is not available."],
  ["unknown_patient", "That person was not found in your organisation."],
  ["unknown_donation", "That gift was not found."],
  ["unknown_grant", "That grant was not found."],
];

export function describeFundError(message: string | undefined): string {
  const m = MESSAGES.find(([code]) => message?.includes(code));
  return m ? m[1] : "Something went wrong. Please try again.";
}
