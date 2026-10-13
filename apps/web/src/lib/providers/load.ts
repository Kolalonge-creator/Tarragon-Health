import "server-only";
import { createClient } from "@/lib/supabase/server";
import { breakRowSchema, glAttentionRowSchema, type GlAttentionRow, healthRowSchema, inboxRowSchema, type BreakRow, type HealthRow, type InboxRow } from "./model";

/**
 * Loaders for the provider board. Every read is an admin-only database function or an admin-only view (RLS), so a non-admin gets an
 * error that shows as a load failure, never as an empty healthy board. These functions are new in the S14x migrations and are not in
 * the generated database types until the migrations are applied and the types are regenerated, so the calls go through one narrow
 * untyped client here and every reply is parsed with zod.
 */
type Reply = { data: unknown; error: { message: string } | null };
type Untyped = { rpc(fn: string, args?: Record<string, unknown>): PromiseLike<Reply>; from(table: string): { select(cols: string): PromiseLike<Reply> } };
const client = async (): Promise<Untyped> => (await createClient()) as unknown as Untyped;

export async function loadProviderHealth(): Promise<{ rows: HealthRow[]; failed: boolean }> {
  const { data, error } = await (await client()).from("provider_health_v").select("*");
  const parsed = healthRowSchema.array().safeParse(data);
  return error || !parsed.success ? { rows: [], failed: true } : { rows: parsed.data, failed: false };
}

export async function loadBreaks(status: string | null): Promise<{ rows: BreakRow[]; failed: boolean }> {
  const { data, error } = await (await client()).rpc("reconciliation_break_queue", { p_status: status, p_limit: 200 });
  const parsed = breakRowSchema.array().safeParse(data);
  return error || !parsed.success ? { rows: [], failed: true } : { rows: parsed.data, failed: false };
}

export async function loadInbox(provider: string | null, status: string | null): Promise<{ rows: InboxRow[]; failed: boolean }> {
  const { data, error } = await (await client()).rpc("list_provider_events", { p_provider: provider, p_status: status, p_limit: 100 });
  const parsed = inboxRowSchema.array().safeParse(data);
  return error || !parsed.success ? { rows: [], failed: true } : { rows: parsed.data, failed: false };
}

/** Payout ledger postings that failed or were skipped: finance must look at these (a closed period, or the bank returned the money first). */
export async function loadGlAttention(): Promise<{ rows: GlAttentionRow[]; failed: boolean }> {
  const { data, error } = await (await client()).rpc("list_payout_gl_attention");
  const parsed = glAttentionRowSchema.array().safeParse(data);
  return error || !parsed.success ? { rows: [], failed: true } : { rows: parsed.data, failed: false };
}
