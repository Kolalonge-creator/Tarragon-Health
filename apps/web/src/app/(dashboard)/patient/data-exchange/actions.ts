"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

export type ExchangeActionResult = { ok: true } | { ok: false; error: "invalid" | "not_signed_in" | "failed" };

const grantSchema = z.object({
  source: z.string().trim().min(2).max(120),
  direction: z.enum(["import", "export", "both"]),
});

/** The person allows one named outside system. The database normalises the name and records the consent with a placeholder wording key. */
export async function grantExchangeConsentAction(input: { source: string; direction: string }): Promise<ExchangeActionResult> {
  const parsed = grantSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "not_signed_in" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("grant_external_exchange_consent", { p_source: parsed.data.source, p_direction: parsed.data.direction });
  if (error) return { ok: false, error: "failed" };
  revalidatePath("/patient/data-exchange");
  return { ok: true };
}

const idSchema = z.string().uuid();

/** The person stops allowing a system. From that moment the next import from it is refused and stores nothing. */
export async function withdrawExchangeConsentAction(id: string): Promise<ExchangeActionResult> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "not_signed_in" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_external_exchange_consent", { p_id: parsed.data });
  if (error) return { ok: false, error: "failed" };
  revalidatePath("/patient/data-exchange");
  return { ok: true };
}
