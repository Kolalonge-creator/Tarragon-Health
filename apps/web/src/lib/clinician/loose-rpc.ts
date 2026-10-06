import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The S17 queue functions (queue_next, queue_handback) are not in the generated database types yet. This is the one
 * place that calls an RPC by name without the generated signature, and the result is always parsed with Zod by the
 * caller, so a wrong shape fails loudly rather than being trusted.
 */
export type LooseRpcResult = { data: unknown; error: { message?: string | null; code?: string | null } | null };
export type LooseRpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<LooseRpcResult>;

export function looseRpc(client: SupabaseClient): LooseRpc {
  return (fn, args) => (client.rpc as unknown as LooseRpc).call(client, fn, args);
}
