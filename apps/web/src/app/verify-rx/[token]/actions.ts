"use server";

import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@tarragon/shared";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { TOKEN_PATTERN, isSupplyOutcome, type SupplyOutcome } from "@/lib/prescriptions/public-verification";

/**
 * A pharmacy records that it supplied the prescription. No login: the 64-hex token is the credential, and
 * everything the pharmacy types is self-declared (stored as such). The rules that matter (active status,
 * clinician-approved repeats, a 10 minute duplicate window, row locking) live in the database function, not
 * here; this only validates input, rate limits, and turns the outcome into a redirect back to the check.
 */

const inputSchema = z.object({
  token: z.string().regex(TOKEN_PATTERN),
  pharmacyName: z.string().trim().min(2).max(120),
  pharmacistName: z.string().trim().min(2).max(120),
  pharmacistRegistration: z.string().trim().max(40).optional(),
  confirmed: z.literal("on"),
});

function back(token: string, outcome: SupplyOutcome): never {
  redirect(`/verify-rx/${token}?result=${outcome}`);
}

export async function recordSupplyAction(formData: FormData): Promise<void> {
  const parsed = inputSchema.safeParse({
    token: formData.get("token"),
    pharmacyName: formData.get("pharmacyName"),
    pharmacistName: formData.get("pharmacistName"),
    pharmacistRegistration: formData.get("pharmacistRegistration") || undefined,
    confirmed: formData.get("confirmed"),
  });
  const rawToken = String(formData.get("token") ?? "");
  if (!parsed.success) {
    if (!TOKEN_PATTERN.test(rawToken)) redirect("/verify-rx");
    back(rawToken, "invalid");
  }
  const input = parsed.data;

  const ip = await getClientIp();
  const limited = await rateLimit(`verify-rx-record:ip:${ip}`, { limit: 10, windowSeconds: 3600 });
  if (!limited.success) back(input.token, "rate_limited");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) back(input.token, "error");
  const supabase = createClient<Database>(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.rpc("record_prescription_supply_public", {
    p_token: input.token,
    p_pharmacy_name: input.pharmacyName,
    p_pharmacist_name: input.pharmacistName,
    ...(input.pharmacistRegistration ? { p_pharmacist_registration: input.pharmacistRegistration } : {}),
  });
  const outcome = Array.isArray(data) ? data[0]?.outcome : undefined;
  if (error || !isSupplyOutcome(outcome)) back(input.token, "error");
  back(input.token, outcome as SupplyOutcome);
}
