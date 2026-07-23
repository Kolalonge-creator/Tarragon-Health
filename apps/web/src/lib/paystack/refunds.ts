import { paystackFetch, type PaystackResult } from "./client";

interface RefundData {
  id: number;
  status: string;
  transaction: { reference?: string } | null;
}

/**
 * Full refund of a captured one-off charge, by its transaction reference —
 * the release valve for the video-visit "payment held until a doctor
 * accepts" model (declined/expired requests refund in full). Same never-throw
 * PaystackResult contract as every other wrapper here. Paystack processes
 * refunds asynchronously; a successful call means "refund created", and the
 * refund settles on their side.
 */
export async function refundTransaction(args: {
  reference: string;
}): Promise<PaystackResult<{ refundId: number; status: string }>> {
  const result = await paystackFetch<RefundData>("/refund", {
    method: "POST",
    body: { transaction: args.reference },
  });
  if (!result.ok) return result;
  return { ok: true, data: { refundId: result.data.id, status: result.data.status } };
}
