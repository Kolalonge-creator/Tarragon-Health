import { createClient } from "@/lib/supabase/server";

/**
 * Calls an S79 database function on the signed-in user's own session. The functions are not in the generated types yet (the migration is not applied,
 * so types cannot be regenerated; splice them in when it is). Arguments are checked by the callers' zod schemas and by the database.
 */
export async function rpcLoose(fn: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> {
  const supabase = await createClient();
  const res = await supabase.rpc(fn as never, (args ?? {}) as never);
  return { data: res.data as unknown, error: res.error ? { message: res.error.message } : null };
}
