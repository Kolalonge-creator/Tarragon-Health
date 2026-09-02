import { paystackFetch, type PaystackResult } from "./client";

interface RefundData {
  id: number;
  status: string;
  transaction: { reference?: string } | null;
}

/**
 * Full (or, with `amountKobo`, partial) refund of a captured one-off charge,
 * by its transaction reference — the release valve for the video-visit
 * "payment held until a doctor accepts" model (declined/expired requests
 * refund in full) and, since the Pharmacy Engine build, a pharmacy order's
 * accept/decline outcome (a partial-fulfilment accept, or a full-amount
 * decline). Same never-throw PaystackResult contract as every other wrapper
 * here. Paystack processes refunds asynchronously; a successful call means
 * "refund created", and the refund settles on their side.
 *
 * `amountKobo` is optional and additive — omitting it (every existing
 * caller) refunds the full transaction amount, unchanged from before this
 * parameter existed. Paystack's own `/refund` endpoint treats a present
 * `amount` as a partial refund and its absence as a full refund.
 */
export async function refundTransaction(args: {
  reference: string;
  amountKobo?: number;
}): Promise<PaystackResult<{ refundId: number; status: string }>> {
  const result = await paystackFetch<RefundData>("/refund", {
    method: "POST",
    body:
      args.amountKobo !== undefined
        ? { transaction: args.reference, amount: args.amountKobo }
        : { transaction: args.reference },
  });
  if (!result.ok) return result;
  return { ok: true, data: { refundId: result.data.id, status: result.data.status } };
}
