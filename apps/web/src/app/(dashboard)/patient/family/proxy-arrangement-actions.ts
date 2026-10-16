"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getProposedConfig } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/server";

export type EndProxyState = { ok?: boolean; error?: boolean } | undefined;

const schema = z.object({ grantId: z.string().uuid() });

/**
 * The parent ends the access someone set up for them (v5 1.19, OQ-48). One call from their own session: the grant and its
 * categories go, the ending is recorded, and the same person cannot start a new setup for this number until the cooling-off
 * (PROPOSED config `proxy.cooling_off`) has passed. Nothing is asked of the other person and nothing needs their consent.
 */
export async function endProxyAccessAction(input: unknown): Promise<EndProxyState> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: true };
  const days = getProposedConfig<{ days: number }>("proxy.cooling_off").value.days;
  const supabase = await createClient();
  const { error } = await supabase.rpc("end_proxy_access", { p_grant: parsed.data.grantId, p_block_days: days });
  if (error) {
    Sentry.captureMessage("end_proxy_access failed", { level: "warning", tags: { pg_code: error.code ?? "none" } });
    return { error: true };
  }
  revalidatePath("/patient/privacy");
  revalidatePath("/patient/family");
  return { ok: true };
}
