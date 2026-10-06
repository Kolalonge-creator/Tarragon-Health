// S31: the two actions that must talk to Paystack, kept free of Deno and Supabase types so Jest can run them against the fake vendor.
// Every rule that matters (who may send, whether the guard is on, name matching, the state machine) lives in the database; this
// file only carries a reply between the two. A failure here never changes a payout to a state Paystack did not confirm.
import { isValidBankCode, type PaymentProvider, type TransferStatus } from "../integrations/index.ts";

export interface RpcReply {
  readonly data: unknown;
  readonly error: { readonly message: string } | null;
}
export interface PayoutDeps {
  readonly payment: PaymentProvider;
  /** Runs as the signed-in person (their JWT): the database decides whether they may. */
  readonly asUser: (fn: string, args?: Record<string, unknown>) => Promise<RpcReply>;
  /** Runs with the service key: only the functions that record what Paystack said. */
  readonly asService: (fn: string, args: Record<string, unknown>) => Promise<RpcReply>;
  readonly userId: string;
}
export type HandlerResult = { readonly status: number; readonly body: Record<string, unknown> };

const NUBAN = /^\d{10}$/;
const refused = (message: string): HandlerResult => {
  const code = /^[a-z_]+$/.exec(message.trim())?.[0] ?? "refused";
  const status = code === "payout_bank_too_many_lookups" ? 429 : code.startsWith("payout_not_a") && code.endsWith("clinician") ? 403 : code.startsWith("payout_") ? 409 : 400;
  return { status, body: { error: code } };
};

export async function sendPayout(deps: PayoutDeps, payoutId: unknown): Promise<HandlerResult> {
  if (typeof payoutId !== "string" || !/^[0-9a-f-]{36}$/.test(payoutId)) return { status: 400, body: { error: "invalid_input" } };
  const prep = await deps.asUser("payout_prepare_send", { p_id: payoutId });
  if (prep.error) return refused(prep.error.message);
  const p = prep.data as { reference: string; amount_kobo: number; recipient_code: string; reason: string };
  const sent = await deps.payment.initiateTransfer({ reference: p.reference, amountKobo: p.amount_kobo, recipientCode: p.recipient_code, reason: p.reason });
  let status: TransferStatus | "error";
  let code: string | null = null;
  let message: string | null = null;
  if (sent.ok) {
    status = sent.data.status;
    code = sent.data.transferCode;
  } else if (sent.error.code === "conflict") {
    // The reference already exists at Paystack: an earlier call got through. Ask what became of it instead of sending again.
    const known = await deps.payment.verifyTransfer(p.reference);
    if (known.ok) {
      status = known.data.status;
      code = known.data.transferCode;
    } else {
      status = "error";
      message = known.error.message;
    }
  } else {
    status = "error";
    message = sent.error.message;
  }
  // Paystack's own words about failed or reversed arrive by webhook; here only the acceptance is recorded.
  const recorded = await deps.asService("payout_record_send", {
    p_reference: p.reference,
    p_status: status === "failed" || status === "reversed" ? "error" : status,
    p_transfer_code: code,
    p_error: message ?? (status === "failed" || status === "reversed" ? `transfer ${status} at once` : null),
  });
  if (recorded.error) return { status: 500, body: { error: "record_failed" } };
  if (status === "error") return { status: 502, body: { error: "send_failed", retryable: true } };
  return { status: 200, body: { ...(recorded.data as Record<string, unknown>), transfer_status: status } };
}

export async function verifyBank(deps: PayoutDeps, input: { bankCode: unknown; accountNumber: unknown }): Promise<HandlerResult> {
  // Only a contracted clinician, a few times a day: the lookup reveals who owns an account number, so it is not open to anyone signed in.
  const allowed = await deps.asUser("payout_bank_check_allowed");
  if (allowed.error) return refused(allowed.error.message);
  const bankCode = input.bankCode;
  const accountNumber = input.accountNumber;
  if (!isValidBankCode(bankCode) || typeof accountNumber !== "string" || !NUBAN.test(accountNumber)) {
    return { status: 400, body: { error: "invalid_input" } };
  }
  const banks = await deps.payment.listBanks();
  const bank = banks.ok ? banks.data.find((b) => b.code === bankCode) : undefined;
  if (!bank) return { status: 400, body: { error: "unknown_bank" } };
  const resolved = await deps.payment.resolveAccount({ accountNumber, bankCode });
  if (!resolved.ok) {
    return { status: resolved.error.code === "not_found" || resolved.error.code === "invalid_input" ? 422 : 502, body: { error: "account_not_resolved" } };
  }
  const last4 = accountNumber.slice(-4);
  const rec = await deps.asService("record_bank_resolution", {
    p_clinician: deps.userId, p_bank_code: bankCode, p_bank_name: bank.name, p_last4: last4, p_resolved_name: resolved.data.accountName,
  });
  if (rec.error) return refused(rec.error.message);
  const row = rec.data as { id: string; name_match: "verified" | "mismatch" };
  if (row.name_match !== "verified") {
    // The number is dropped here: nothing about it is kept for a mismatch.
    return { status: 200, body: { verified: false, name_match: "mismatch", resolved_name: resolved.data.accountName, last4 } };
  }
  const recipient = await deps.payment.createTransferRecipient({ name: resolved.data.accountName, accountNumber, bankCode });
  if (!recipient.ok) return { status: 502, body: { error: "recipient_failed", retryable: true } };
  const attached = await deps.asService("attach_bank_recipient", { p_account: row.id, p_recipient_code: recipient.data.recipientCode });
  if (attached.error) return refused(attached.error.message);
  return { status: 200, body: { verified: true, name_match: "verified", resolved_name: resolved.data.accountName, last4, bank_name: bank.name } };
}

export async function listBanks(deps: PayoutDeps): Promise<HandlerResult> {
  const who = await deps.asUser("my_payout_overview");
  if (who.error) return refused(who.error.message);
  const banks = await deps.payment.listBanks();
  if (!banks.ok) return { status: 502, body: { error: "banks_unavailable" } };
  return { status: 200, body: { banks: banks.data } };
}
