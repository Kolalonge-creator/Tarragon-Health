import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The fd_ tables and RPCs were applied in M1 and are not yet in the generated Database type (CLAUDE.md: a wholesale regeneration imports other
 * branches' schema, so the types are spliced in deliberately, not here). Until then every front desk read and write goes through these two
 * narrow helpers, so the one cast lives in one place and each caller states the row type it expects.
 */
type RawResult<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;
interface RawClient {
  from(table: string): { select(columns: string): { order(column: string, opts?: { ascending?: boolean }): RawResult<unknown[]> } };
  rpc(fn: string, args?: Record<string, unknown>): RawResult<unknown>;
}

const raw = (supabase: SupabaseClient): RawClient => supabase as unknown as RawClient;

export async function fdSelect<T>(supabase: SupabaseClient, table: string, columns: string, orderBy: string): Promise<{ rows: T[]; error: string | null }> {
  const { data, error } = await raw(supabase).from(table).select(columns).order(orderBy, { ascending: true });
  return { rows: (data ?? []) as T[], error: error ? error.message : null };
}

export async function fdRpc(supabase: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<{ error: string | null }> {
  const { error } = await raw(supabase).rpc(fn, args);
  return { error: error ? error.message : null };
}
