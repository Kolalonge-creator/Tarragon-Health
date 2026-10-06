import { createClient } from "@/lib/supabase/server";
import { guardListSchema, signoffListSchema, type ConfigSignoff, type GuardStatus } from "./model";

export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

export type Loaded<T> = { ok: true; data: T } | { ok: false };

/** The guards with their conditions evaluated now. Admin and the Chief Medical Officer only (the function refuses anyone else). */
export async function loadGuards(client?: RpcClient): Promise<Loaded<GuardStatus[]>> {
  const rpc = client ?? ((await createClient()) as unknown as RpcClient);
  const { data, error } = await rpc.rpc("go_live_guard_status");
  if (error) return { ok: false };
  const parsed = guardListSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false };
}

/** The newest recorded decision for each proposed value and version. */
export async function loadSignoffs(client?: RpcClient): Promise<Loaded<ConfigSignoff[]>> {
  const rpc = client ?? ((await createClient()) as unknown as RpcClient);
  const { data, error } = await rpc.rpc("proposed_config_signoffs_current");
  if (error) return { ok: false };
  const parsed = signoffListSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false };
}
