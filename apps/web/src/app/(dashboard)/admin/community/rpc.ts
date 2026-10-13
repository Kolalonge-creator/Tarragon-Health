import { createClient } from "@/lib/supabase/server";

/** The generated types cannot express null arguments for these functions, so the calls go through this small structural type. */
export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

export async function getRpcClient(): Promise<RpcClient> {
  return (await createClient()) as unknown as RpcClient;
}
