"use server";

import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@tarragon/shared";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { TOKEN_PATTERN, normaliseRxLookup, type CodeLookupNotice } from "@/lib/prescriptions/public-verification";

/**
 * T2-11b (safety case HZ-RX-06/11): a pharmacist types the Rx number and the verification code printed on the form, for when the
 * QR cannot be scanned. A match sends them to the same page the QR opens (/verify-rx/<token>), so they see the same minimal facts and
 * can record the supply the same way. The typed code never goes into a URL; only the outcome does. Rate limited per connection here,
 * and the database locks one Rx number after ten wrong codes in an hour.
 */
const inputSchema = z.object({ rxNumber: z.string().trim().min(1).max(60), code: z.string().trim().min(1).max(30) });

function back(notice: CodeLookupNotice): never {
  redirect(`/verify-rx?n=${notice}`);
}

export async function checkPrescriptionCodeAction(formData: FormData): Promise<void> {
  const parsed = inputSchema.safeParse({ rxNumber: formData.get("rxNumber"), code: formData.get("code") });
  const lookup = parsed.success ? normaliseRxLookup(parsed.data.rxNumber, parsed.data.code) : null;
  if (!lookup) back("invalid");

  const ip = await getClientIp();
  const limited = await rateLimit(`verify-rx-code:ip:${ip}`, { limit: 10, windowSeconds: 600 });
  if (!limited.success) back("rate_limited");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) back("unavailable");
  const supabase = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.rpc("verify_prescription_by_code", { p_rx_number: lookup.rxNumber, p_code: lookup.code });
  if (error) back((error.message ?? "").includes("too_many_attempts") ? "locked" : "unavailable");
  if (typeof data !== "string" || !TOKEN_PATTERN.test(data)) back("not_found");
  redirect(`/verify-rx/${data}`);
}
