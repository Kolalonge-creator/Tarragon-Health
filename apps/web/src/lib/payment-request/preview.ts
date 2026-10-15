import "server-only";

import { createHash } from "node:crypto";
import { parsePreview, type PaymentRequestPreview } from "@tarragon/commerce";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

/**
 * What the link page may show (S72, 19.13). Looked up on the server with the service role: the browser never calls the database function, so nobody can
 * try codes from a script against it. Two limits stack: this one per address, and the database's own per visitor. The visitor is a hash of the address, so
 * the database never holds one. Anything that cannot be read is "unknown", the same answer as a code that does not exist.
 */
export async function loadPaymentRequestPreview(code: string): Promise<PaymentRequestPreview> {
  const ip = await getClientIp();
  const limited = await rateLimit(`payreq:preview:${ip}`, { limit: 30, windowSeconds: 600 });
  if (!limited.success) return { status: "rate_limited" };
  const visitor = createHash("sha256").update(`payment-request:${ip}`).digest("hex").slice(0, 32);
  try {
    const { data, error } = await createServiceRoleClient().rpc("payment_request_preview", { p_code: code, p_visitor: visitor });
    if (error) return { status: "unknown" };
    return parsePreview(data);
  } catch {
    return { status: "unknown" };
  }
}
